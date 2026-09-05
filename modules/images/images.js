(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────── */
  // Skip images that are extremely tall (portrait ratio > 2.2) — they break the 2-col layout
  const MAX_RATIO = 2.2;

  const _preloaded = new Set();
  let _seen      = new Set();
  let _gallery   = null;
  let _lazyIo    = null;
  let _q         = '';
  let _warmQueue    = [];
  let _warmRunning  = false;

  let _suggestions = [];
  let _suggPool    = [];
  let _queryToken  = 0;

  let _sheetEl       = null;
  let _sheetBackdrop = null;
  let _sheetOpen     = false;

  let _galleryRo = null;
  let _resizing  = false;
  const _pendingMeasure = new WeakSet();

  /* ── Seeded RNG (deterministic layout per query) ──────────── */
  function _seedFromString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function _random(seed) {
    let x = seed + 0x6D2B79F5;
    return function () {
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ── Helpers ──────────────────────────────────────────────── */
  function _shortTitle(raw) {
    if (!raw) return '';
    return raw.trim().split(/\s+/).slice(0, 4).join(' ');
  }

  function _ratio(data) {
    return (data.width && data.height) ? data.height / data.width : null;
  }

  // Pick highest-quality src available
  function _bestSrc(data) {
    return data.img_src || data.thumbnail_src || '';
  }

  function _preload(src) {
    if (!src || _preloaded.has(src)) return;
    _preloaded.add(src);
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  }

  function _loadImage(img) {
    if (!img || img.dataset.loaded === '1' || img.dataset.loading === '1') return;
    const src = img.dataset.src;
    if (!src) return;
    img.dataset.loading = '1';
    img.src = src;
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
    const src     = _bestSrc(data);
    const pageUrl = data.url || src;
    const title   = data.title || '';
    const host    = pageUrl ? (function () {
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
        <a class="img-sheet__btn" href="${pageUrl}" target="_blank" rel="noopener noreferrer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
          Visit
        </a>
        <a class="img-sheet__btn" href="${src}" download target="_blank" rel="noopener noreferrer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download
        </a>
      </div>`;

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
    const src = _bestSrc(data);
    if (!src) return null;

    const r      = _ratio(data);
    // padding-bottom = (h/w)*100% preserves natural aspect ratio
    const aspect = (r !== null ? r * 100 : 75).toFixed(3) + '%';

    const tile = document.createElement('a');
    tile.className   = 'img-tile';
    tile.href        = data.url || src;
    tile.rel         = 'noopener noreferrer';
    tile.dataset.imageSrc = src;
    tile._imageData  = data;

    tile.addEventListener('click', function (e) {
      e.preventDefault();
      _openSheet(data);
    });

    // Spacer: height=0 + padding-bottom trick for ratio-preserving container
    const spacer = document.createElement('div');
    spacer.className          = 'img-tile__spacer';
    spacer.style.paddingBottom = aspect;

    const image = document.createElement('img');
    image.className   = 'img-lazy';
    image.alt         = data.title || '';
    image.decoding    = 'async';
    image.dataset.src = src;

    image.onload = function () {
      this.dataset.loaded = '1';
      delete this.dataset.loading;
      requestAnimationFrame(() => {
        if (this.isConnected) this.classList.add('img-loaded');
      });
      // After load, check if this grid section needs gap-filling
      const grid = this.closest('.gallery-grid');
      if (grid) _scheduleMeasure(grid);
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
          if (allEmpty) grid.remove();
          else _scheduleMeasure(grid);
        }
      } else if (parent.classList.contains('gallery-hero')) {
        parent.remove();
      }
    };

    spacer.appendChild(image);
    tile.appendChild(spacer);

    // Overlay: title + menu button
    const overlay = document.createElement('div');
    overlay.className = 'img-tile__overlay';

    const titleText = _shortTitle(data.title);
    if (titleText) {
      const titleEl     = document.createElement('span');
      titleEl.className = 'img-tile__title';
      titleEl.textContent = titleText;
      overlay.appendChild(titleEl);
    }

    const menu     = document.createElement('button');
    menu.className = 'img-tile__menu';
    menu.type      = 'button';
    menu.setAttribute('aria-label', 'More options');
    menu.innerHTML = `<svg width="16" height="4" viewBox="0 0 16 4" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="2" cy="2" r="1.5" fill="currentColor"/><circle cx="8" cy="2" r="1.5" fill="currentColor"/><circle cx="14" cy="2" r="1.5" fill="currentColor"/></svg>`;
    menu.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      _openSheet(data);
    });
    overlay.appendChild(menu);
    tile.appendChild(overlay);

    return tile;
  }

  /* ── Suggestion pill ──────────────────────────────────────── */
  function _buildPill(q) {
    const btn     = document.createElement('button');
    btn.className = 'sugg-pill';
    btn.type      = 'button';
    btn.textContent = q;
    btn.addEventListener('click', function () {
      sessionStorage.setItem('atkyn_last_query', q);
      window.dispatchEvent(new CustomEvent('atkyn-search', { detail: { q } }));
    });
    return btn;
  }

  /* ── Whitespace measurement & suggestion injection ────────── */
  // Each pill slot ≈ 44px height + 2px gap = 46px minimum
  const PILL_SLOT = 46;
  const MIN_GAP   = 60; // ignore tiny differences

  function _scheduleMeasure(grid) {
    if (_pendingMeasure.has(grid)) return;
    _pendingMeasure.add(grid);
    requestAnimationFrame(function () {
      _pendingMeasure.delete(grid);
      _measureAndFill(grid);
    });
  }

  function _measureAndFill(grid) {
    if (!grid.isConnected) return;
    const cols = grid.querySelectorAll('.gallery-col');
    if (cols.length !== 2) return;

    const hA = cols[0].scrollHeight;
    const hB = cols[1].scrollHeight;
    const gap = Math.abs(hA - hB);
    if (gap < MIN_GAP) return;

    const shorter   = hA < hB ? cols[0] : cols[1];
    const maxPills  = Math.floor(gap / PILL_SLOT);
    if (maxPills < 1) return;

    // Remove old gap pills in this column
    shorter.querySelectorAll('.sugg-pill--gap').forEach(el => el.remove());

    const count = Math.min(maxPills, _suggPool.length);
    if (count < 1) return;

    _suggPool.splice(0, count).forEach(function (text) {
      const pill = _buildPill(text);
      pill.classList.add('sugg-pill--gap');
      shorter.appendChild(pill);
    });
  }

  function _onGalleryResize() {
    if (!_gallery || _resizing) return;
    _resizing = true;
    _suggPool = _suggestions.slice();
    _gallery.querySelectorAll('.sugg-pill--gap').forEach(el => el.remove());
    _gallery.querySelectorAll('.gallery-grid').forEach(s => _scheduleMeasure(s));
    _resizing = false;
  }

  /* ── Lazy-load observer ───────────────────────────────────── */
  function _initObserver() {
    if (_lazyIo) _lazyIo.disconnect();
    _lazyIo = new IntersectionObserver(function (entries, obs) {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        obs.unobserve(e.target);
        _loadImage(e.target);
      }
    }, { rootMargin: '3000px 0px' });
  }

  function _observeTile(tile) {
    if (!_lazyIo || !tile) return;
    const img = tile.querySelector('.img-lazy');
    if (img) _lazyIo.observe(img);
  }

  /* ── Layout builders ──────────────────────────────────────── */

  // 2-column masonry grid section
  function _buildGridSection(items) {
    const section     = document.createElement('div');
    section.className = 'gallery-grid';

    const cols    = [document.createElement('div'), document.createElement('div')];
    cols.forEach(c => { c.className = 'gallery-col'; section.appendChild(c); });

    const heights = [0, 0];
    let placed    = 0;

    for (const data of items) {
      const tile = _buildTile(data);
      if (!tile) continue;
      // Always add to the shorter column
      const col = heights[0] <= heights[1] ? 0 : 1;
      cols[col].appendChild(tile);
      const r = _ratio(data);
      heights[col] += r !== null ? r : 1.0;
      _observeTile(tile);
      placed++;
    }

    return placed ? section : null;
  }

  // Full-width hero section
  function _buildHero(data) {
    const tile = _buildTile(data);
    if (!tile) return null;
    const section     = document.createElement('div');
    section.className = 'gallery-hero';
    section.appendChild(tile);
    _observeTile(tile);
    return section;
  }

  /* ── Main render ──────────────────────────────────────────── */
  function _renderGallery(results) {
    const frag   = document.createDocumentFragment();
    const random = _random(_seedFromString(_q));

    // Filter out images that are absurdly tall
    const queue = results
      .filter(item => {
        const r = _ratio(item);
        return r === null || r <= MAX_RATIO;
      })
      .map(item => ({
        item,
        // Hero-eligible: landscape or near-square (ratio ≤ 0.8)
        heroOk: (function () {
          const r = _ratio(item);
          return r === null || r <= 0.8;
        }())
      }));

    while (queue.length > 0) {
      const hasHero   = queue.some(e => e.heroOk);
      const isFirst   = frag.childNodes.length === 0;
      // Use hero for first item if possible, then ~40% chance
      const useHero   = hasHero && (isFirst || queue.length === 1 || random() < 0.40);

      if (useHero) {
        let data = null;
        for (let i = 0; i < queue.length; i++) {
          if (queue[i].heroOk) { data = queue.splice(i, 1)[0].item; break; }
        }
        if (data) {
          const sec = _buildHero(data);
          if (sec) frag.appendChild(sec);
        }
      } else {
        // Take 2–4 items for a grid row
        const want  = (queue.length >= 4 && random() < 0.4) ? 4 : Math.min(2, queue.length);
        const items = [];
        while (items.length < want && queue.length) items.push(queue.splice(0, 1)[0].item);
        if (items.length) {
          const sec = _buildGridSection(items);
          if (sec) frag.appendChild(sec);
        }
      }
    }

    _gallery.replaceChildren(frag);
    _suggPool = _suggestions.slice();
  }

  /* ── Cache warming ────────────────────────────────────────── */
  function _warmCache() {
    if (_warmRunning || !_warmQueue.length) return;
    _warmRunning = true;
    const next = function () {
      if (!_warmQueue.length) { _warmRunning = false; return; }
      const src = _warmQueue.shift();
      if (src && !_preloaded.has(src)) _preload(src);
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(next, { timeout: 150 });
      } else {
        setTimeout(next, 0);
      }
    };
    next();
  }

  /* ── Suggestions (Wikipedia opensearch) ──────────────────── */
  function _fetchSuggestions(q, token) {
    if (!q) return;
    const url = 'https://en.wikipedia.org/w/api.php'
      + '?action=opensearch&format=json&origin=*&limit=10&search='
      + encodeURIComponent(q);

    fetch(url)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (data) {
        if (token !== _queryToken) return;
        const titles = Array.isArray(data[1]) ? data[1] : [];
        const qLow   = q.toLowerCase();
        const seen   = new Set([qLow]);
        const fresh  = [];
        for (const t of titles) {
          if (!t) continue;
          const tl = t.toLowerCase();
          if (seen.has(tl)) continue;
          seen.add(tl);
          fresh.push(t);
        }
        _suggestions = fresh;
        _suggPool    = fresh.slice();
        if (_gallery) {
          _gallery.querySelectorAll('.gallery-grid').forEach(s => _scheduleMeasure(s));
        }
      })
      .catch(function () {
        if (token !== _queryToken) return;
        _suggestions = [];
        _suggPool    = [];
      });
  }

  /* ── Fetch images ─────────────────────────────────────────── */
  function _fetchImages() {
    fetch('/api/images?q=' + encodeURIComponent(_q))
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (data) {
        const results = Array.isArray(data.results) ? data.results : [];

        if (!results.length) {
          const page = document.getElementById('pageContent');
          if (page) page.innerHTML = '<div class="tab-empty"><p>No images found</p></div>';
          return;
        }

        const fresh = [];
        for (const item of results) {
          const key = _bestSrc(item);
          if (!key || _seen.has(key)) continue;
          _seen.add(key);
          fresh.push(item);
        }
        if (!fresh.length) return;

        // Preload first 8 immediately
        fresh.slice(0, 8).forEach(item => _preload(_bestSrc(item)));
        // Rest go into warm queue
        _warmQueue = fresh.slice(8).map(item => _bestSrc(item));

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
    if (_lazyIo)    { _lazyIo.disconnect();    _lazyIo    = null; }
    if (_galleryRo) { _galleryRo.disconnect(); _galleryRo = null; }
    _closeSheet();
    _seen        = new Set();
    _warmQueue   = [];
    _warmRunning = false;
    _suggestions = [];
    _suggPool    = [];
    _resizing    = false;
    _queryToken  = (_queryToken + 1) | 0;

    const token = _queryToken;
    _q = sessionStorage.getItem('atkyn_last_query') || '';

    const page = document.getElementById('pageContent');
    if (!page) return;

    if (!_q) {
      page.innerHTML = '<div class="tab-empty"><p>Search something to see images</p></div>';
      return;
    }

    _gallery = document.createElement('div');
    _gallery.id        = 'gallery';
    _gallery.className = 'gallery';
    page.replaceChildren(_gallery);

    _initObserver();

    // Watch for width changes to re-run gap-fill logic
    _galleryRo = new ResizeObserver(function () { _onGalleryResize(); });
    _galleryRo.observe(_gallery);

    _fetchImages();
    _fetchSuggestions(_q, token);
  };

}());
