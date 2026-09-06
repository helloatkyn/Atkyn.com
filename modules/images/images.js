(function () {
  'use strict';

  const HERO_MAX_RATIO = 0.75;
  const GRID_MAX_RATIO = 2.0;

  // Minimum gap before injecting pills. 48px = one pill min-height.
  // Lower threshold catches more gaps; pills stretch to fill whatever space remains.
  const MIN_GAP_PX = 48;

  const _preloaded = new Set();
  let _seen = new Set();
  let _gallery = null;
  let _lazyIo = null;
  let _q = '';
  let _warmQueue = [];
  let _warmRunning = false;
  let _suggestions = [];
  let _suggPool = [];
  let _queryToken = 0;

  let _sheetEl = null;
  let _sheetBackdrop = null;
  let _sheetOpen = false;

  let _galleryRo = null;
  let _resizing = false;
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
    img.fetchpriority = 'auto';
    img.loading = 'eager';
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
    // Cached images may fire load synchronously before this line on some browsers.
    // If complete is true but loaded is still unset, the event was missed — call directly.
    if (image.complete && image.dataset.loaded !== '1') image.onload();
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

    // Sheet shows full-res img_src; tile uses cached thumbnail_src.
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

  function _buildTile(data, eager) {
    // img_src (original full-resolution source) loads first for maximum quality.
    // thumbnail_src (Google-cached low-res) is the fallback if img_src fails.
    const srcs = [];
    if (data.img_src) srcs.push(data.img_src);
    if (data.thumbnail_src && data.thumbnail_src !== data.img_src) srcs.push(data.thumbnail_src);
    if (!srcs.length) return null;

    const src = srcs[0];

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

    if (eager) {
      // First 6 tiles load immediately — no lazy observer needed.
      image.fetchpriority = 'high';
      image.loading = 'eager';
      image.decoding = 'sync';
      // No fade-in for above-the-fold tiles — they should appear instantly.
      image.style.transition = 'none';
      image.src = src;
      _preloaded.add(src);
      image.dataset.loaded = '0'; // onload will set to '1'
    } else {
      image.dataset.src = src;
      image.dataset.srcIndex = '0';
      image.fetchpriority = 'auto';
      // opacity:0 keeps image in render pipeline so load/error fire on
      // Android WebView; avoids layout shift from visibility:hidden.
      image.style.opacity = '0';
    }

    image.onload = function () {
      // Guard against 1×1 tracking pixels or zero-dimension stubs (HTTP 200).
      if (this.naturalWidth < 2 || this.naturalHeight < 2) {
        this.onerror();
        return;
      }
      this.dataset.loaded = '1';
      // Clear any inline opacity/visibility/transition set during load phase.
      this.style.opacity = '';
      this.style.visibility = '';
      this.style.transition = '';

      // Authoritative geometry: use real naturalWidth/naturalHeight of whatever
      // URL actually loaded instead of API metadata dimensions.
      const sp = this.parentElement;
      if (sp && sp.classList.contains('img-tile__spacer')) {
        sp.style.paddingBottom = ((this.naturalHeight / this.naturalWidth) * 100).toFixed(2) + '%';
      }

      requestAnimationFrame(() => {
        if (this.isConnected) this.classList.add('img-loaded');
      });

      const gridSection = this.closest('.gallery-grid');
      if (gridSection) _scheduleMeasure(gridSection);
    };

    image.onerror = function () {
      const nextIndex = (parseInt(this.dataset.srcIndex, 10) || 0) + 1;
      if (nextIndex < srcs.length) {
        this.dataset.srcIndex = String(nextIndex);
        this.src = srcs[nextIndex];
        return;
      }

      // All sources exhausted: collapse space and remove tile.
      const sp = this.parentElement;
      if (sp && sp.classList.contains('img-tile__spacer')) {
        sp.style.paddingBottom = '0';
      }
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

  function _scheduleMeasure(gridSection) {
    if (_pendingMeasure.has(gridSection)) return;
    _pendingMeasure.add(gridSection);
    requestAnimationFrame(function () {
      _pendingMeasure.delete(gridSection);
      _measureAndFill(gridSection);
    });
  }

  function _measureAndFill(gridSection) {
    if (!gridSection.isConnected) return;

    const cols = gridSection.querySelectorAll('.gallery-col');
    if (cols.length !== 2) return;

    const colA = cols[0];
    const colB = cols[1];

    // scrollHeight gives actual content height independent of CSS grid row stretching.
    const heightA = colA.scrollHeight;
    const heightB = colB.scrollHeight;

    const gap = Math.abs(heightA - heightB);
    if (gap < MIN_GAP_PX) return;

    const shorterCol = heightA < heightB ? colA : colB;

    // Remove any stale gap-fill wrapper from a previous pass on this column.
    shorterCol.querySelectorAll('.sugg-gap-fill').forEach(function (el) { el.remove(); });

    if (!_suggPool.length) return;

    // How many pills fit if each takes its natural min-height (48px) + gap (9px).
    // We allow at most 3 pills so the column doesn't look like a suggestion list.
    const pillSlotHeight = 48 + 9;
    const maxByHeight = Math.floor(gap / pillSlotHeight);
    const count = Math.min(Math.max(maxByHeight, 1), 3, _suggPool.length);

    const taken = _suggPool.splice(0, count);

    // Wrap pills in a flex column that stretches to fill the exact gap.
    // This eliminates the white space while keeping pill count low.
    const wrapper = document.createElement('div');
    wrapper.className = 'sugg-gap-fill';
    wrapper.style.height = gap + 'px';

    taken.forEach(function (text) {
      const pill = _buildPill(text);
      pill.classList.add('sugg-pill--gap');
      wrapper.appendChild(pill);
    });

    shorterCol.appendChild(wrapper);
  }

  function _onGalleryResize() {
    if (!_gallery || _resizing) return;
    _resizing = true;

    _suggPool = _suggestions.slice();
    _gallery.querySelectorAll('.sugg-gap-fill').forEach(function (el) { el.remove(); });
    _gallery.querySelectorAll('.gallery-grid').forEach(function (section) {
      _scheduleMeasure(section);
    });

    _resizing = false;
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
    }, { rootMargin: '4000px 0px', threshold: 0 });
  }

  function _observeTile(tile) {
    if (!_lazyIo || !tile) return;
    const image = tile.querySelector('.img-lazy');
    // Eager tiles have no data-src — skip observer (they load directly).
    if (image && image.dataset.src) _lazyIo.observe(image);
  }

  /* ── Layout ───────────────────────────────────────────────── */

  // eagerCount: how many tiles across the whole gallery load immediately (no lazy).
  function _buildGridSection(items, eagerCount, placedSoFar) {
    const section = document.createElement('div');
    section.className = 'gallery-grid';

    const cols = [document.createElement('div'), document.createElement('div')];
    cols.forEach(c => { c.className = 'gallery-col'; section.appendChild(c); });

    const heights = [0, 0];
    let placed = 0;
    for (const data of items) {
      const eager = (placedSoFar + placed) < eagerCount;
      const tile = _buildTile(data, eager);
      if (!tile) continue;
      const col = heights[0] <= heights[1] ? 0 : 1;
      cols[col].appendChild(tile);
      const r = _ratio(data);
      heights[col] += r !== null ? r : 1.2;
      if (!eager) _observeTile(tile);
      placed++;
    }

    if (!placed) return null;
    return section;
  }

  function _buildHero(data, eager) {
    const tile = _buildTile(data, eager);
    if (!tile) return null;
    const section = document.createElement('div');
    section.className = 'gallery-hero';
    section.appendChild(tile);
    if (!eager) _observeTile(tile);
    return section;
  }

  function _renderGallery(results) {
    const fragment = document.createDocumentFragment();
    const random = _random(_seedFromString(_q));

    // First 6 tiles are eager (above-the-fold estimate for mobile).
    const EAGER_COUNT = 6;
    let totalPlaced = 0;

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
          const eager = totalPlaced < EAGER_COUNT;
          const section = _buildHero(data, eager);
          if (section) { fragment.appendChild(section); totalPlaced++; }
        }
      } else {
        const count = queue.length >= 4 && random() < 0.45 ? 4 : Math.min(2, queue.length);
        const items = [];
        while (items.length < count && queue.length > 0) items.push(queue.splice(0, 1)[0].item);
        if (items.length) {
          const section = _buildGridSection(items, EAGER_COUNT, totalPlaced);
          if (section) { fragment.appendChild(section); totalPlaced += items.length; }
        }
      }
    }

    _gallery.replaceChildren(fragment);
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

  /* ── Suggestions fetch (Wikipedia opensearch — no API key, CORS-enabled) ── */

  function _fetchSuggestions(q, token) {
    if (!q) return;

    const url = 'https://en.wikipedia.org/w/api.php'
      + '?action=opensearch&format=json&origin=*&limit=10&search='
      + encodeURIComponent(q);

    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('suggestions failed');
        return res.json();
      })
      .then(function (data) {
        if (token !== _queryToken) return;

        // opensearch returns [query, [titles], [descriptions], [urls]]
        const titles = Array.isArray(data[1]) ? data[1] : [];
        const qLower = q.toLowerCase();
        const seen = new Set([qLower]);
        const fresh = [];
        for (const t of titles) {
          if (!t) continue;
          const tl = t.toLowerCase();
          if (seen.has(tl)) continue;
          seen.add(tl);
          fresh.push(t);
        }

        _suggestions = fresh;
        _suggPool = fresh.slice();

        if (_gallery) {
          _gallery.querySelectorAll('.gallery-grid').forEach(function (section) {
            _scheduleMeasure(section);
          });
        }
      })
      .catch(function () {
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

        // First 6 are eagerly loaded by _buildTile; warm the rest via idle cache.
        _warmQueue = fresh.slice(6).map(function (item) {
          return item.img_src || item.thumbnail_src || '';
        });

        _renderGallery(fresh);
        _warmCache();

        // Merge Serper relatedSearches into suggestion pool (Wikipedia takes priority).
        const serperSuggs = Array.isArray(data.suggestions)
          ? data.suggestions
              .map(function (s) { return (s && s.query) ? s.query.trim() : ''; })
              .filter(Boolean)
          : [];
        if (serperSuggs.length) {
          const qLower = _q.toLowerCase();
          const existing = new Set(_suggestions.map(function (s) { return s.toLowerCase(); }));
          existing.add(qLower);
          const fresh2 = serperSuggs.filter(function (s) {
            const sl = s.toLowerCase();
            if (existing.has(sl)) return false;
            existing.add(sl);
            return true;
          });
          if (fresh2.length) {
            _suggestions = _suggestions.concat(fresh2);
            _suggPool = _suggPool.concat(fresh2);
            if (_gallery) {
              _gallery.querySelectorAll('.gallery-grid').forEach(function (section) {
                _scheduleMeasure(section);
              });
            }
          }
        }
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

    _queryToken = (_queryToken + 1) | 0;
    const token = _queryToken;

    _q = sessionStorage.getItem('atkyn_last_query') || '';

    const page = document.getElementById('pageContent');
    if (!page) return;

    if (!_q) {
      page.innerHTML = '<div class="tab-empty"><p>Search something to see images</p></div>';
      return;
    }

    _gallery = document.createElement('div');
    _gallery.className = 'images-grid';
    page.replaceChildren(_gallery);

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
