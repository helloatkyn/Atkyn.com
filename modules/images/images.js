(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────── */
  const MAX_RATIO  = 2.2;  // Skip portrait images taller than this ratio
  const PILL_SLOT  = 46;   // Height (px) per suggestion pill slot
  const MIN_GAP    = 60;   // Min column height diff before we fill with pills

  /* ── State ──────────────────────────────────────────────────── */
  const _preloaded = new Set();   // Already-preloaded srcs (avoid duplicates)
  let _seen        = new Set();   // Dedup filter for fetched results
  let _gallery     = null;        // Root gallery DOM node
  let _lazyIo      = null;        // IntersectionObserver for lazy loading
  let _galleryRo   = null;        // ResizeObserver for gap-fill recalc
  let _q           = '';          // Current search query
  let _queryToken  = 0;           // Incremented on each new search; stale responses are ignored

  let _warmQueue   = [];          // Srcs queued for background preload
  let _warmRunning = false;       // Whether warm loop is active

  let _suggestions = [];          // Wikipedia autocomplete results
  let _suggPool    = [];          // Remaining suggestions not yet used as pills
  let _resizing    = false;       // Debounce flag for resize handler

  let _sheetEl       = null;      // Bottom-sheet element
  let _sheetBackdrop = null;      // Sheet backdrop overlay
  let _sheetOpen     = false;     // Whether sheet is currently open

  const _pendingMeasure = new WeakSet(); // Grids awaiting rAF measure

  /* ── Seeded RNG ──────────────────────────────────────────────
     Deterministic per-query so layout is stable on re-render     */
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

  /* ── Helpers ─────────────────────────────────────────────────  */
  // First 4 words of a title (overlay label)
  function _shortTitle(raw) {
    return raw ? raw.trim().split(/\s+/).slice(0, 4).join(' ') : '';
  }

  // height/width ratio; null if dimensions missing
  function _ratio(data) {
    return (data.width && data.height) ? data.height / data.width : null;
  }

  // Best available image URL
  function _bestSrc(data) {
    return data.img_src || data.thumbnail_src || '';
  }

  // Fire-and-forget background preload (skip if already done)
  function _preload(src) {
    if (!src || _preloaded.has(src)) return;
    _preloaded.add(src);
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  }

  /* ── Lazy load ───────────────────────────────────────────────
     Called by the IntersectionObserver when a tile enters view.
     Attach onload/onerror BEFORE setting src to avoid race.      */
  function _loadImage(img) {
    if (!img || img.dataset.loaded === '1' || img.dataset.loading === '1') return;
    const src = img.dataset.src;
    if (!src) return;
    img.dataset.loading = '1';
    // Handlers must be set before src so no load event is missed
    img.onload = function () {
      this.dataset.loaded = '1';
      delete this.dataset.loading;
      requestAnimationFrame(() => {
        if (this.isConnected) this.classList.add('img-loaded');
      });
      // Rebalance gap-fill pills after image renders
      const grid = this.closest('.gallery-grid');
      if (grid) _scheduleMeasure(grid);
    };
    img.onerror = function () {
      const tile = this.closest('.img-tile');
      if (!tile) return;
      const parent = tile.parentElement;
      tile.remove();
      if (!parent) return;
      if (parent.classList.contains('gallery-col')) {
        const grid = parent.parentElement;
        if (grid) {
          const allEmpty = Array.from(grid.querySelectorAll('.gallery-col')).every(c => !c.children.length);
          if (allEmpty) grid.remove();
          else _scheduleMeasure(grid);
        }
      } else if (parent.classList.contains('gallery-hero')) {
        parent.remove();
      }
    };
    img.src = src;
    _preloaded.add(src);
  }

  /* ── Bottom Sheet ────────────────────────────────────────────  */
  function _ensureSheet() {
    if (_sheetEl) return;
    _sheetBackdrop = document.createElement('div');
    _sheetBackdrop.className = 'img-sheet-backdrop';
    _sheetBackdrop.addEventListener('click', _closeSheet);
    _sheetEl = document.createElement('div');
    _sheetEl.className = 'img-sheet';
    document.body.append(_sheetBackdrop, _sheetEl);
  }

  function _openSheet(data) {
    _ensureSheet();
    const src     = _bestSrc(data);
    const pageUrl = data.url || src;
    const title   = data.title || '';
    let host = '';
    try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch (_) {}

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

  /* ── Tile builder ────────────────────────────────────────────
     Creates one image card (anchor + lazy img + overlay).        */
  function _buildTile(data) {
    const src = _bestSrc(data);
    if (!src) return null;

    const r      = _ratio(data);
    const aspect = (r !== null ? r * 100 : 75).toFixed(3) + '%'; // padding-bottom trick

    const tile = document.createElement('a');
    tile.className      = 'img-tile';
    tile.href           = data.url || src;
    tile.rel            = 'noopener noreferrer';
    tile.dataset.imageSrc = src;
    tile._imageData     = data;
    tile.addEventListener('click', e => { e.preventDefault(); _openSheet(data); });

    // Aspect-ratio spacer (height 0 + padding-bottom = natural ratio)
    const spacer = document.createElement('div');
    spacer.className           = 'img-tile__spacer';
    spacer.style.paddingBottom = aspect;

    // Lazy image — src set later by observer via _loadImage()
    const image = document.createElement('img');
    image.className   = 'img-lazy';
    image.alt         = data.title || '';
    image.decoding    = 'async';
    image.dataset.src = src;
    // NOTE: onload/onerror are attached inside _loadImage() just before src is set

    spacer.appendChild(image);
    tile.appendChild(spacer);

    // Overlay: short title + "…" menu button
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
    menu.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); _openSheet(data); });
    overlay.appendChild(menu);
    tile.appendChild(overlay);

    return tile;
  }

  /* ── Suggestion pill ─────────────────────────────────────────  */
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

  /* ── Gap-fill: suggestion pills in shorter column ────────────
     After layout, if one column is significantly shorter,
     fill the gap with suggestion pills so it looks balanced.     */
  function _scheduleMeasure(grid) {
    if (_pendingMeasure.has(grid)) return; // Already scheduled
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

    const gap = Math.abs(cols[0].scrollHeight - cols[1].scrollHeight);
    if (gap < MIN_GAP) return;

    const shorter  = cols[0].scrollHeight < cols[1].scrollHeight ? cols[0] : cols[1];
    const maxPills = Math.floor(gap / PILL_SLOT);
    if (maxPills < 1) return;

    shorter.querySelectorAll('.sugg-pill--gap').forEach(el => el.remove());

    const count = Math.min(maxPills, _suggPool.length);
    _suggPool.splice(0, count).forEach(function (text) {
      const pill = _buildPill(text);
      pill.classList.add('sugg-pill--gap');
      shorter.appendChild(pill);
    });
  }

  // On resize: reset pill pool and remeasure all grids
  function _onGalleryResize() {
    if (!_gallery || _resizing) return;
    _resizing = true;
    _suggPool = _suggestions.slice();
    _gallery.querySelectorAll('.sugg-pill--gap').forEach(el => el.remove());
    _gallery.querySelectorAll('.gallery-grid').forEach(s => _scheduleMeasure(s));
    _resizing = false;
  }

  /* ── Lazy-load IntersectionObserver ─────────────────────────
     Large rootMargin (3000px) triggers load well before visible.  */
  function _initObserver() {
    if (_lazyIo) _lazyIo.disconnect();
    _lazyIo = new IntersectionObserver(function (entries, obs) {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        obs.unobserve(e.target);
        _loadImage(e.target); // Now sets handlers + src safely
      }
    }, { rootMargin: '3000px 0px' });
  }

  function _observeTile(tile) {
    if (!_lazyIo || !tile) return;
    const img = tile.querySelector('.img-lazy');
    if (img) _lazyIo.observe(img);
  }

  /* ── Layout: 2-col masonry grid ──────────────────────────────
     Always appends to the shorter column for balance.            */
  function _buildGridSection(items) {
    const section = document.createElement('div');
    section.className = 'gallery-grid';

    const cols    = [document.createElement('div'), document.createElement('div')];
    cols.forEach(c => { c.className = 'gallery-col'; section.appendChild(c); });

    const heights = [0, 0];
    let placed    = 0;

    for (const data of items) {
      const tile = _buildTile(data);
      if (!tile) continue;
      const col = heights[0] <= heights[1] ? 0 : 1;
      cols[col].appendChild(tile);
      heights[col] += _ratio(data) ?? 1.0;
      _observeTile(tile);
      placed++;
    }

    return placed ? section : null;
  }

  /* ── Layout: full-width hero ─────────────────────────────────  */
  function _buildHero(data) {
    const tile = _buildTile(data);
    if (!tile) return null;
    const section     = document.createElement('div');
    section.className = 'gallery-hero';
    section.appendChild(tile);
    _observeTile(tile);
    return section;
  }

  /* ── Main render ─────────────────────────────────────────────
     Alternates between hero (full-width) and 2-col grid rows.
     Layout pattern is seeded from the query for consistency.    */
  function _renderGallery(results) {
    const frag   = document.createDocumentFragment();
    const random = _random(_seedFromString(_q));

    // Filter out absurdly tall portraits, tag landscape items as hero-eligible
    const queue = results
      .filter(item => { const r = _ratio(item); return r === null || r <= MAX_RATIO; })
      .map(item => ({ item, heroOk: (_ratio(item) ?? 0) <= 0.8 }));

    while (queue.length > 0) {
      const hasHero = queue.some(e => e.heroOk);
      const isFirst = frag.childNodes.length === 0;
      // First item always hero if possible; then ~40% chance
      const useHero = hasHero && (isFirst || queue.length === 1 || random() < 0.40);

      if (useHero) {
        // Find first hero-eligible item
        const idx  = queue.findIndex(e => e.heroOk);
        const data = queue.splice(idx, 1)[0].item;
        const sec  = _buildHero(data);
        if (sec) frag.appendChild(sec);
      } else {
        // 2–4 items per grid row
        const want  = (queue.length >= 4 && random() < 0.4) ? 4 : Math.min(2, queue.length);
        const items = queue.splice(0, want).map(e => e.item);
        const sec   = _buildGridSection(items);
        if (sec) frag.appendChild(sec);
      }
    }

    _gallery.replaceChildren(frag);
    _suggPool = _suggestions.slice(); // Reset pill pool after full re-render
  }

  /* ── Background cache warming ────────────────────────────────
     Preloads remaining images via requestIdleCallback.           */
  function _warmCache() {
    if (_warmRunning || !_warmQueue.length) return;
    _warmRunning = true;
    const next = function () {
      if (!_warmQueue.length) { _warmRunning = false; return; }
      _preload(_warmQueue.shift());
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(next, { timeout: 150 })
        : setTimeout(next, 0);
    };
    next();
  }

  /* ── Wikipedia suggestions ───────────────────────────────────
     Fills _suggestions with related query ideas for gap pills.   */
  function _fetchSuggestions(q, token) {
    if (!q) return;
    fetch('https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&limit=10&search=' + encodeURIComponent(q))
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (data) {
        if (token !== _queryToken) return; // Stale — newer search started
        const qLow  = q.toLowerCase();
        const seen  = new Set([qLow]);
        _suggestions = (Array.isArray(data[1]) ? data[1] : []).filter(t => {
          const tl = t?.toLowerCase();
          return tl && !seen.has(tl) && seen.add(tl);
        });
        _suggPool = _suggestions.slice();
        if (_gallery) _gallery.querySelectorAll('.gallery-grid').forEach(s => _scheduleMeasure(s));
      })
      .catch(function () {
        if (token !== _queryToken) return;
        _suggestions = [];
        _suggPool    = [];
      });
  }

  /* ── Fetch images from API ───────────────────────────────────
     Deduplicates results, preloads first 8, warms rest.          */
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

        // Deduplicate against already-seen srcs
        const fresh = results.filter(item => {
          const key = _bestSrc(item);
          return key && !_seen.has(key) && _seen.add(key);
        });
        if (!fresh.length) return;

        fresh.slice(0, 8).forEach(item => _preload(_bestSrc(item))); // Immediate preload
        _warmQueue = fresh.slice(8).map(_bestSrc);                   // Rest: lazy warm

        _renderGallery(fresh);
        _warmCache();
      })
      .catch(function () {
        const page = document.getElementById('pageContent');
        if (page) page.innerHTML = '<div class="tab-empty"><p>Could not load images</p></div>';
      });
  }

  /* ── Init (called by router on tab switch) ───────────────────
     Tears down previous state, builds gallery for current query. */
  window._atkynInit_images = function () {
    if (_lazyIo)    { _lazyIo.disconnect();    _lazyIo    = null; }
    if (_galleryRo) { _galleryRo.disconnect(); _galleryRo = null; }
    _closeSheet();

    // Reset all mutable state
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

    _gallery           = document.createElement('div');
    _gallery.id        = 'gallery';
    _gallery.className = 'gallery';
    page.replaceChildren(_gallery);

    _initObserver();

    // Track gallery width changes for gap-fill recalculation
    _galleryRo = new ResizeObserver(_onGalleryResize);
    _galleryRo.observe(_gallery);

    _fetchImages();
    _fetchSuggestions(_q, token);
  };

}());
 
