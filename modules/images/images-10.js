(function () {
  'use strict';

  const HERO_MAX_RATIO = 0.75;
  const GRID_MAX_RATIO = 1.4;

  const _preloaded = new Set();
  let _seen = new Set();
  let _gallery = null;
  let _lazyIo = null;
  let _q = '';
  let _warmQueue = [];
  let _warmRunning = false;
  let _suggestions = [];      // suggestion strings for the current query
  let _suggPool = [];         // remaining suggestions not yet placed
  let _queryToken = 0;        // incremented on each new search to cancel stale work

  let _sheetEl = null;
  let _sheetBackdrop = null;
  let _sheetOpen = false;

  // ResizeObserver watching the gallery for width changes (layout recalc only, no re-fetch)
  let _galleryRo = null;
  // Re-entry guard: true while _onGalleryResize is mutating the DOM,
  // so the ResizeObserver callback caused by that mutation is ignored.
  let _resizing = false;
  // Set of grid sections whose pending measurement has been scheduled
  const _pendingMeasure = new WeakSet();

  function _seedFromString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function _random(seed) {
    let x = seed + 0x6D2B79F5;
    return function () {
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function _shortTitle(raw) {
    if (!raw) return '';
    return raw.trim().split(/\s+/).slice(0, 3).join(' ');
  }

  function _ratio(data) {
    return data.width && data.height ? data.height / data.width : null;
  }

  function _preload(src) {
    if (!src || _preloaded.has(src)) return;
    _preloaded.add(src);
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  }

  function _loadImage(image) {
    if (!image) return;
    if (image.dataset.loaded === '1' || image.dataset.loading === '1') return;
    const src = image.dataset.src;
    if (!src) return;
    image.dataset.loading = '1';
    image.src = src;
    _preloaded.add(src);
  }

  /* ── Bottom Sheet ─────────────────────────────────────────── */

  function _ensureSheet() {
    if (_sheetEl) return;

    _sheetBackdrop = document.createElement('div');
    _sheetBackdrop.className = 'img-sheet-backdrop';
    _sheetBackdrop.addEventListener('click', _closeSheet);

    _sheetEl = document.createElement('div');
    _sheetEl.className = 'img-sheet';

    document.body.appendChild(_sheetBackdrop);
    document.body.appendChild(_sheetEl);
  }

  function _openSheet(data) {
    _ensureSheet();

    const src = data.img_src || data.thumbnail_src || '';
    const pageUrl = data.url || src;
    const title = data.title || '';
    const host = pageUrl ? (function () {
      try { return new URL(pageUrl).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
    }()) : '';

    _sheetEl.innerHTML = `
      <div class="img-sheet__handle"></div>
      <div class="img-sheet__img-wrap">
        <img class="img-sheet__img" src="${src}" alt="${title.replace(/"/g, '&quot;')}" decoding="async">
      </div>
      <div class="img-sheet__info">
        <div class="img-sheet__text">
          <span class="img-sheet__title">${title}</span>
          ${host ? `<span class="img-sheet__host">${host}</span>` : ''}
        </div>
      </div>
      <div class="img-sheet__actions">
        <a class="img-sheet__btn" href="${pageUrl}" target="_blank" rel="noopener noreferrer" aria-label="Visit site">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
          <span>Visit</span>
        </a>
        <a class="img-sheet__btn" href="${src}" download target="_blank" rel="noopener noreferrer" aria-label="Download image">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>Download</span>
        </a>
      </div>
    `;

    _sheetBackdrop.classList.add('img-sheet-backdrop--open');
    _sheetEl.classList.add('img-sheet--open');
    document.body.style.overflow = 'hidden';
    _sheetOpen = true;
  }

  function _closeSheet() {
    if (!_sheetEl || !_sheetOpen) return;
    _sheetBackdrop.classList.remove('img-sheet-backdrop--open');
    _sheetEl.classList.remove('img-sheet--open');
    document.body.style.overflow = '';
    _sheetOpen = false;
  }

  /* ── Tile ─────────────────────────────────────────────────── */

  function _buildTile(data) {
    const src = data.img_src || data.thumbnail_src || '';
    if (!src) return null;

    const r = _ratio(data);
    const aspect = r !== null ? (r * 100).toFixed(2) + '%' : '100%';

    const tile = document.createElement('a');
    tile.className = 'img-tile';
    tile.href = data.url || src;
    tile.rel = 'noopener noreferrer';

    tile.addEventListener('click', function (e) {
      e.preventDefault();
      _openSheet(data);
    });

    const spacer = document.createElement('div');
    spacer.className = 'img-tile__spacer';
    spacer.style.paddingBottom = aspect;

    const image = document.createElement('img');
    image.className = 'img-lazy';
    image.alt = data.title || '';
    image.decoding = 'async';
    image.dataset.src = src;
    image.style.visibility = 'hidden';

    image.onload = function () {
      this.dataset.loaded = '1';
      this.style.visibility = '';
      requestAnimationFrame(() => {
        if (this.isConnected) this.classList.add('img-loaded');
      });
      // After this image loads, schedule a whitespace check on the parent grid section
      const gridSection = this.closest('.gallery-grid');
      if (gridSection) _scheduleMeasure(gridSection);
    };

    image.onerror = function () {
      const t = this.closest('.img-tile');
      if (!t) return;
      const parent = t.parentElement;
      t.remove();
      if (!parent) return;
      if (parent.classList.contains('gallery-col')) {
        const grid = parent.parentElement;
        if (grid && grid.classList.contains('gallery-grid')) {
          const allEmpty = Array.from(grid.querySelectorAll('.gallery-col'))
            .every(c => c.children.length === 0);
          if (allEmpty) {
            grid.remove();
          } else {
            _scheduleMeasure(grid);
          }
        }
      } else if (parent.classList.contains('gallery-hero')) {
        parent.remove();
      }
    };

    spacer.appendChild(image);
    tile.appendChild(spacer);

    const overlay = document.createElement('div');
    overlay.className = 'img-tile__overlay';

    const title = _shortTitle(data.title);
    if (title) {
      const titleEl = document.createElement('span');
      titleEl.className = 'img-tile__title';
      titleEl.textContent = title;
      overlay.appendChild(titleEl);
    }

    const menu = document.createElement('button');
    menu.className = 'img-tile__menu';
    menu.type = 'button';
    menu.setAttribute('aria-label', 'More options');
    menu.innerHTML = `<svg width="16" height="4" viewBox="0 0 16 4" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="2" cy="2" r="1.5" fill="currentColor"/><circle cx="8" cy="2" r="1.5" fill="currentColor"/><circle cx="14" cy="2" r="1.5" fill="currentColor"/></svg>`;
    menu.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      _openSheet(data);
    });
    overlay.appendChild(menu);

    tile.appendChild(overlay);
    tile.dataset.imageSrc = src;
    tile._imageData = data;

    return tile;
  }

  /* ── Suggestion pill ──────────────────────────────────────── */

  function _buildPill(q) {
    const btn = document.createElement('button');
    btn.className = 'sugg-pill';
    btn.type = 'button';
    btn.textContent = q;
    btn.addEventListener('click', function () {
      sessionStorage.setItem('atkyn_last_query', q);
      window.dispatchEvent(new CustomEvent('atkyn-search', { detail: { q } }));
    });
    return btn;
  }

  /* ── Whitespace measurement & suggestion injection ────────── */

  // Schedule a deferred layout measurement for a grid section.
  // Uses a WeakSet to coalesce multiple rapid calls for the same element within
  // a single animation frame. The entry is deleted inside the callback so that
  // subsequent image loads or resizes on the same section can schedule again.
  function _scheduleMeasure(gridSection) {
    if (_pendingMeasure.has(gridSection)) return;
    _pendingMeasure.add(gridSection);
    requestAnimationFrame(function () {
      _pendingMeasure.delete(gridSection);
      _measureAndFill(gridSection);
    });
  }

  // Measure the actual rendered height of a suggestion pill candidate in the
  // context of a specific column width. Creates a temporary off-screen pill,
  // appends it to the column (so it inherits column width), measures it, removes it.
  // Returns { pillH, colGap } where colGap is the flex gap between siblings.
  function _measurePillDimensions(col, text) {
    // Measure the CSS column gap (flex gap between children).
    // getComputedStyle returns the gap value; fall back to 9 if unavailable.
    const cs = window.getComputedStyle(col);
    const colGap = parseFloat(cs.rowGap || cs.gap || '9') || 9;

    // Build a temp pill with the actual text so wrapping is accounted for.
    const temp = document.createElement('button');
    temp.className = 'sugg-pill sugg-pill--gap';
    temp.type = 'button';
    temp.textContent = text || 'suggestion';
    // Position off-screen but in flow so it gets the column width
    temp.style.visibility = 'hidden';
    temp.style.pointerEvents = 'none';
    col.appendChild(temp);

    const pillH = temp.getBoundingClientRect().height || temp.offsetHeight || 48;

    col.removeChild(temp);

    return { pillH, colGap };
  }

  // Measure actual rendered heights of both columns in a gallery-grid section.
  // Removes previously injected pills first (so gap is measured clean), then
  // iteratively inserts pills until no more fit or the pool is empty.
  function _measureAndFill(gridSection) {
    if (!gridSection.isConnected) return;

    const cols = gridSection.querySelectorAll('.gallery-col');
    if (cols.length !== 2) return;

    const colA = cols[0];
    const colB = cols[1];

    // Step 1: remove previously injected pills from BOTH columns first,
    // so scrollHeight reflects only image content.
    colA.querySelectorAll('.sugg-pill--gap').forEach(function (el) { el.remove(); });
    colB.querySelectorAll('.sugg-pill--gap').forEach(function (el) { el.remove(); });

    // Step 2: measure column content heights after cleanup.
    // scrollHeight gives true content height unaffected by CSS grid row-stretching.
    const heightA = colA.scrollHeight;
    const heightB = colB.scrollHeight;

    const rawGap = Math.abs(heightA - heightB);
    const shorterCol = heightA <= heightB ? colA : colB;

    // Step 3: if pool is empty there's nothing to do.
    if (!_suggPool.length) return;

    // Step 4: measure a candidate pill's real rendered dimensions using the
    // first suggestion text (actual wrapping in the actual column width).
    const { pillH, colGap } = _measurePillDimensions(shorterCol, _suggPool[0]);

    // Step 5: the first pill slot costs pillH + colGap (flex gap above it,
    // since the column already has image tiles as prior siblings).
    // Each subsequent pill costs the same: pillH + colGap.
    // We need rawGap >= (pillH + colGap) for at least one pill to fit.
    const slotCost = pillH + colGap;

    if (rawGap < slotCost) return; // not even one pill fits

    // Step 6: iteratively insert pills, re-measuring remaining space after each.
    // This handles variable pill heights (text wrapping) correctly.
    let remaining = rawGap;

    while (remaining >= slotCost && _suggPool.length > 0) {
      const text = _suggPool[0]; // peek — only splice after confirming it fits

      // Re-measure with actual next candidate text (it may wrap differently)
      const dims = _measurePillDimensions(shorterCol, text);
      const thisCost = dims.pillH + dims.colGap;

      if (remaining < thisCost) break;

      // It fits — consume from pool and insert
      _suggPool.shift();
      const pill = _buildPill(text);
      pill.classList.add('sugg-pill--gap');
      shorterCol.appendChild(pill);

      remaining -= thisCost;
    }
  }

  // When the gallery width changes (resize/orientation), re-measure every grid section.
  // No new API call — just layout recalc using the still-valid _suggestions array.
  // _resizing guards against the ResizeObserver re-firing due to our own DOM mutations
  // (adding/removing .sugg-pill--gap nodes changes the gallery's scrollHeight).
  // Guard is released AFTER all scheduled rAF callbacks complete, not synchronously,
  // to prevent the RO → rAF pill insertion → RO feedback loop.
  function _onGalleryResize() {
    if (!_gallery || _resizing) return;
    _resizing = true;

    // Reset pool from the master suggestions list
    _suggPool = _suggestions.slice();

    // Remove all previously gap-injected pills
    _gallery.querySelectorAll('.sugg-pill--gap').forEach(function (el) { el.remove(); });

    // Re-measure every grid section
    _gallery.querySelectorAll('.gallery-grid').forEach(function (section) {
      _scheduleMeasure(section);
    });

    // Release guard one rAF AFTER the measure callbacks have run.
    // _scheduleMeasure itself uses one rAF, so two nested rAFs here
    // guarantees we release only after all pill insertions are done.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        _resizing = false;
      });
    });
  }

  /* ── Observer ─────────────────────────────────────────────── */

  function _initObserver() {
    if (_lazyIo) _lazyIo.disconnect();
    _lazyIo = new IntersectionObserver(function (entries, observer) {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        _loadImage(entry.target);
      }
    }, { rootMargin: '3000px 0px' });
  }

  function _observeTile(tile) {
    if (!_lazyIo || !tile) return;
    const image = tile.querySelector('.img-lazy');
    if (image) _lazyIo.observe(image);
  }

  /* ── Layout ───────────────────────────────────────────────── */

  function _buildGridSection(items) {
    const section = document.createElement('div');
    section.className = 'gallery-grid';

    const cols = [document.createElement('div'), document.createElement('div')];
    cols.forEach(c => { c.className = 'gallery-col'; section.appendChild(c); });

    const heights = [0, 0];
    let placed = 0;
    for (const data of items) {
      const tile = _buildTile(data);
      if (!tile) continue;
      const col = heights[0] <= heights[1] ? 0 : 1;
      cols[col].appendChild(tile);
      const r = _ratio(data);
      heights[col] += r !== null ? r : 1.2;
      _observeTile(tile);
      placed++;
    }

    if (!placed) return null;
    return section;
  }

  function _buildHero(data) {
    const tile = _buildTile(data);
    if (!tile) return null;
    const section = document.createElement('div');
    section.className = 'gallery-hero';
    section.appendChild(tile);
    _observeTile(tile);
    return section;
  }

  function _renderGallery(results) {
    const fragment = document.createDocumentFragment();
    const random = _random(_seedFromString(_q));

    const queue = [];
    for (const item of results) {
      const r = _ratio(item);
      if (r !== null && r > GRID_MAX_RATIO) continue;
      queue.push({ item, heroOk: r === null || r <= HERO_MAX_RATIO });
    }

    while (queue.length > 0) {
      const hasHero = queue.some(e => e.heroOk);
      const forceHero = fragment.childNodes.length === 0;
      const useHero = hasHero && (forceHero || queue.length === 1 || random() < 0.55);

      if (useHero) {
        const data = (function () {
          for (let i = 0; i < queue.length; i++) {
            if (queue[i].heroOk) return queue.splice(i, 1)[0].item;
          }
          return null;
        }());
        if (data) {
          const section = _buildHero(data);
          if (section) fragment.appendChild(section);
        }
      } else {
        const count = queue.length >= 4 && random() < 0.45 ? 4 : Math.min(2, queue.length);
        const items = [];
        while (items.length < count && queue.length > 0) items.push(queue.splice(0, 1)[0].item);
        if (items.length) {
          const section = _buildGridSection(items);
          if (section) fragment.appendChild(section);
        }
      }
    }

    _gallery.replaceChildren(fragment);

    // Seed the suggestion pool from the fetched suggestions.
    // Grid section measurement will draw from this pool as images load.
    _suggPool = _suggestions.slice();
  }

  /* ── Cache warm ───────────────────────────────────────────── */

  function _warmCache() {
    if (_warmRunning || !_warmQueue.length) return;
    _warmRunning = true;

    const next = function () {
      if (!_warmQueue.length) { _warmRunning = false; return; }
      const src = _warmQueue.shift();
      if (src && !_preloaded.has(src)) _preload(src);
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(next, { timeout: 100 });
      } else {
        requestAnimationFrame(next);
      }
    };

    next();
  }

  /* ── Suggestions fetch (frontend-only) ──────────────────────
     Provider: DuckDuckGo /ac/ autocomplete.
       Endpoint: https://duckduckgo.com/ac/?q={query}&kl=in-en
       CORS:     Access-Control-Allow-Origin: * (no credentials needed)
       Response: array of objects → [{"phrase":"claude ai"}, ...]
       No API key. No backend. No proxy. No secrets.
  ─────────────────────────────────────────────────────────────── */

  // Per-query session cache so repeated identical queries don't re-fetch.
  const _suggCache = Object.create(null);

  // Extract phrase strings from a DDG /ac/ response array.
  // DDG returns: [{"phrase":"claude ai"}, {"phrase":"claude monet"}, ...]
  // Defensively handles any item that is already a plain string.
  function _extractDDGPhrases(data) {
    if (!Array.isArray(data)) return [];
    const phrases = [];
    for (const item of data) {
      if (typeof item === 'string') {
        phrases.push(item);
      } else if (item && typeof item === 'object' && typeof item.phrase === 'string') {
        phrases.push(item.phrase);
      }
    }
    return phrases;
  }

  // Deduplicate, filter empties, remove exact original query, cap at 12.
  function _cleanSuggestions(rawList, q) {
    const qLower = q.toLowerCase();
    const seen = new Set([qLower]);
    const fresh = [];
    for (const t of rawList) {
      if (typeof t !== 'string') continue;
      const trimmed = t.trim();
      if (!trimmed) continue;
      const tl = trimmed.toLowerCase();
      if (seen.has(tl)) continue;
      seen.add(tl);
      fresh.push(trimmed);
      if (fresh.length >= 12) break;
    }
    return fresh;
  }

  // Apply a fetched suggestion list: update state and trigger placement.
  // Schedules an immediate rAF pass for already-painted sections, plus a
  // deferred 1.5 s pass to catch sections whose images were still loading
  // when suggestions first arrived (scrollHeight would have been ~0 then).
  function _applySuggestions(fresh, token) {
    if (token !== _queryToken) return;
    _suggestions = fresh;
    _suggPool = fresh.slice();
    if (!_gallery || !fresh.length) return;

    // Immediate pass
    _gallery.querySelectorAll('.gallery-grid').forEach(function (section) {
      _scheduleMeasure(section);
    });

    // Deferred pass — images that were loading at suggestion-fetch time
    // will have loaded by now and scrollHeight will be accurate.
    setTimeout(function () {
      if (token !== _queryToken) return;
      if (!_gallery) return;
      _gallery.querySelectorAll('.gallery-grid').forEach(function (section) {
        _scheduleMeasure(section);
      });
    }, 1500);
  }

  function _fetchSuggestions(q, token) {
    if (!q) return;

    // Serve from cache if available (one request per query)
    if (_suggCache[q]) {
      _applySuggestions(_suggCache[q], token);
      return;
    }

    // DuckDuckGo autocomplete — CORS-open, no credentials required.
    // Returns: [{"phrase":"suggestion1"}, {"phrase":"suggestion2"}, ...]
    const ddgUrl = 'https://duckduckgo.com/ac/?q=' + encodeURIComponent(q) + '&kl=in-en';

    fetch(ddgUrl)
      .then(function (res) {
        if (!res.ok) throw new Error('ddg-fail');
        return res.json();
      })
      .then(function (data) {
        if (token !== _queryToken) return;
        // Extract phrase strings from DDG object array, then clean.
        const phrases = _extractDDGPhrases(data);
        const fresh = _cleanSuggestions(phrases, q);
        if (fresh.length) {
          _suggCache[q] = fresh;
          _applySuggestions(fresh, token);
        } else {
          // DDG returned an empty or unparseable response — clear pool silently.
          if (token !== _queryToken) return;
          _suggestions = [];
          _suggPool = [];
        }
      })
      .catch(function () {
        // DDG unreachable or returned error — images continue normally.
        if (token !== _queryToken) return;
        _suggestions = [];
        _suggPool = [];
      });
  }

  /* ── Fetch images ─────────────────────────────────────────── */

  function _fetchImages() {
    fetch('/api/images?q=' + encodeURIComponent(_q))
      .then(function (res) {
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then(function (data) {
        const results = Array.isArray(data.results) ? data.results : [];

        if (!results.length) {
          const page = document.getElementById('pageContent');
          if (page) page.innerHTML = '<div class="tab-empty"><p>No images found</p></div>';
          return;
        }

        const fresh = [];
        for (const item of results) {
          const key = item.img_src || item.thumbnail_src || '';
          if (!key || _seen.has(key)) continue;
          _seen.add(key);
          fresh.push(item);
        }

        if (!fresh.length) return;

        fresh.slice(0, 6).forEach(function (item) {
          _preload(item.img_src || item.thumbnail_src || '');
        });

        _warmQueue = fresh.slice(6).map(function (item) {
          return item.img_src || item.thumbnail_src || '';
        });

        _renderGallery(fresh);
        _warmCache();
      })
      .catch(function () {
        const page = document.getElementById('pageContent');
        if (page) page.innerHTML = '<div class="tab-empty"><p>Could not load images</p></div>';
      });
  }

  /* ── Init ─────────────────────────────────────────────────── */

  window._atkynInit_images = function () {
    if (_lazyIo) { _lazyIo.disconnect(); _lazyIo = null; }
    if (_galleryRo) { _galleryRo.disconnect(); _galleryRo = null; }
    _closeSheet();
    _seen = new Set();
    _warmQueue = [];
    _warmRunning = false;
    _suggestions = [];
    _suggPool = [];
    _resizing = false;

    // Increment token to invalidate any in-flight suggestion request
    _queryToken = (_queryToken + 1) | 0;
    const token = _queryToken;

    _q = sessionStorage.getItem('atkyn_last_query') || '';

    const page = document.getElementById('pageContent');
    if (!page) return;

    if (!_q) {
      page.innerHTML = '<div class="tab-empty"><p>Search something to see images</p></div>';
      return;
    }

    page.innerHTML = `
      <div class="tab-skeleton grid">
        <div class="sk-col">
          <div class="sk-img" style="padding-bottom:72%"></div>
          <div class="sk-img" style="padding-bottom:125%"></div>
          <div class="sk-img" style="padding-bottom:82%"></div>
        </div>
        <div class="sk-col">
          <div class="sk-img" style="padding-bottom:110%"></div>
          <div class="sk-img" style="padding-bottom:76%"></div>
          <div class="sk-img" style="padding-bottom:118%"></div>
        </div>
      </div>
    `;

    _gallery = document.createElement('div');
    _gallery.className = 'images-grid';
    page.replaceChildren(_gallery);

    // Watch gallery width changes for layout recalc (no new API calls)
    if (typeof ResizeObserver !== 'undefined') {
      _galleryRo = new ResizeObserver(function () {
        _onGalleryResize();
      });
      _galleryRo.observe(_gallery);
    }

    _initObserver();
    _fetchImages();
    _fetchSuggestions(_q, token);
  };

  window._atkynInit_images();
}());
