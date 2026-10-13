/* ==========================================================================
   Images tab
   Gallery layout, bottom sheet, result cache, gap-fill suggestions
   --------------------------------------------------------------------------
   Public hooks
     window._atkynInit_images()        mount the tab (called by core.js)
     window._atkynLeave_images()       tab left: abort work, free the DOM (core.js)
     window._atkynPrefetch_images(q)   optional: warm the cache before the tab
                                       opens (call it right after a search)
   ========================================================================== */

(function () {
  'use strict';

  /* --------------------------------------------------------------------------
     Config
     -------------------------------------------------------------------------- */

  const HERO_MAX_RATIO = 0.75;
  const GRID_MAX_RATIO = 2.0;

  const EAGER_COUNT = 6;            // above-the-fold tiles, loaded immediately
  const EAGER_HIGH = 4;             // of those, how many get fetchpriority=high
  const WARM_AHEAD = 12;            // idle-preload this many tiles after the eager ones
  const LAZY_MARGIN = '1800px 0px'; // start loading this far before a tile is visible

  const TAB_KEY = 'images';         // data-tab / module name used by core.js

  const PILL_MIN_H = 48;            // one pill min-height (keep equal to --im-pill-min in images.css)
  const PILL_MAX_PER_GAP = 3;       // never let a column turn into a suggestion list
  const DEFAULT_GAP = 9;            // fallback when the column gap can't be read
  const SUGG_POOL_MAX = 12;

  const CACHE_TTL = 30 * 60 * 1000; // 30 min
  const CACHE_MAX = 16;             // entries kept in sessionStorage (LRU)
  const STORE_KEY = 'atkyn_img_cache_v1';

  const IMAGES_TIMEOUT = 12000;
  const WIKI_TIMEOUT = 4000;

  /* --------------------------------------------------------------------------
     State
     -------------------------------------------------------------------------- */

  // Lives on window so the cache survives the router re-evaluating this script
  // on every tab change (that was the cause of the repeated re-search).
  const _shared = window.__atkynImages || (window.__atkynImages = {
    mem: new Map(),        // "img:<q>" / "wiki:<q>" -> entry
    inflight: new Map(),   // same keys -> Promise (de-dupes concurrent requests)
    preloaded: new Set()
  });

  let _gallery = null;
  let _lazyIo = null;
  let _galleryRo = null;
  let _pageMo = null;

  let _q = '';
  let _qKey = '';
  let _queryToken = 0;

  let _serperSuggs = [];
  let _wikiSuggs = [];
  let _suggPool = [];

  let _warmQueue = [];
  let _warmRunning = false;

  const _dirty = new Set();
  let _passQueued = false;
  let _lastWidth = 0;
  let _resizeTimer = 0;

  let _sheetEl = null;
  let _sheetBackdrop = null;
  let _sheetOpen = false;
  let _sheetToken = 0;
  let _prevOverflow = '';

  /* --------------------------------------------------------------------------
     Helpers
     -------------------------------------------------------------------------- */

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
    return data.width > 0 && data.height > 0 ? data.height / data.width : null;
  }

  function _esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Only http(s) URLs are ever used for images or links.
  function _safeUrl(u) {
    if (typeof u !== 'string') return '';
    u = u.trim();
    return /^https?:\/\//i.test(u) ? u : '';
  }

  // Image hosts that still serve http break on https pages (mixed content).
  function _imgUrl(u) {
    u = _safeUrl(u);
    if (u && location.protocol === 'https:' && u.slice(0, 7).toLowerCase() === 'http://') {
      u = 'https://' + u.slice(7);
    }
    return u;
  }

  function _cssUrl(u) {
    return 'url("' + u.replace(/["'()\\\s]/g, function (c) {
      return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    }) + '")';
  }

  function _norm(s) {
    return String(s || '')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function _cacheKey(q) {
    return String(q || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function _getLastQuery() {
    try { return (sessionStorage.getItem('atkyn_last_query') || '').trim(); } catch (_) { return ''; }
  }

  function _setLastQuery(q) {
    try { sessionStorage.setItem('atkyn_last_query', q); } catch (_) { /* private mode */ }
  }

  function _preload(src) {
    if (!src || _shared.preloaded.has(src)) return;
    if (_shared.preloaded.size > 600) _shared.preloaded.clear();
    _shared.preloaded.add(src);
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.setAttribute('fetchpriority', 'low');
    img.src = src;
  }

  /* --------------------------------------------------------------------------
     Cache (memory + sessionStorage, LRU, TTL)
     -------------------------------------------------------------------------- */

  function _storeRead() {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      const obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === 'object' ? obj : {};
    } catch (_) {
      return {};
    }
  }

  function _storeWrite(obj) {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(obj)); return true; } catch (_) { return false; }
  }

  function _cacheGet(id) {
    let entry = _shared.mem.get(id);
    if (!entry) {
      entry = _storeRead()[id];
      if (entry) _shared.mem.set(id, entry);
    }
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) {
      _shared.mem.delete(id);
      return null;
    }
    return entry;
  }

  function _cachePut(id, entry) {
    _shared.mem.set(id, entry);
    if (_shared.mem.size > CACHE_MAX * 2) {
      _shared.mem.delete(_shared.mem.keys().next().value);
    }

    const store = _storeRead();
    store[id] = entry;
    const ids = Object.keys(store).sort(function (a, b) { return store[b].ts - store[a].ts; });
    ids.slice(CACHE_MAX).forEach(function (k) { delete store[k]; });

    if (!_storeWrite(store)) {
      // Quota hit: keep only the newest few and try once more.
      ids.slice(3).forEach(function (k) { delete store[k]; });
      _storeWrite(store);
    }
  }

  /* --------------------------------------------------------------------------
     Network: images (+ Serper related searches) and Wikipedia suggestions
     -------------------------------------------------------------------------- */

  function _fetchJson(url, timeoutMs, extra) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : 0;
    const opts = Object.assign({}, extra || {});
    if (ctrl) opts.signal = ctrl.signal;

    return fetch(url, opts)
      .then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.json();
      })
      .finally(function () { clearTimeout(timer); });
  }

  function _cleanItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const img = _imgUrl(raw.img_src);
    const thumb = _imgUrl(raw.thumbnail_src);
    if (!img && !thumb) return null;
    return {
      img_src: img,
      thumbnail_src: thumb,
      url: _safeUrl(raw.url),
      title: typeof raw.title === 'string' ? raw.title : '',
      width: Number(raw.width) || 0,
      height: Number(raw.height) || 0
    };
  }

  function _extractRelated(data) {
    const raw = data && (data.suggestions || data.relatedSearches || data.related);
    if (!Array.isArray(raw)) return [];
    return raw
      .map(function (s) { return typeof s === 'string' ? s : (s && (s.query || s.title)) || ''; })
      .map(function (s) { return String(s).trim(); })
      .filter(Boolean);
  }

  function _requestImages(q) {
    const id = 'img:' + _cacheKey(q);

    const hit = _cacheGet(id);
    if (hit) return Promise.resolve(hit);
    if (_shared.inflight.has(id)) return _shared.inflight.get(id);

    const p = _fetchJson('/api/images?q=' + encodeURIComponent(q), IMAGES_TIMEOUT, { priority: 'high' })
      .then(function (data) {
        const seen = new Set();
        const results = [];
        (Array.isArray(data && data.results) ? data.results : []).forEach(function (raw) {
          const item = _cleanItem(raw);
          if (!item) return;
          const k = item.img_src || item.thumbnail_src;
          if (seen.has(k)) return;
          seen.add(k);
          results.push(item);
        });

        const entry = { ts: Date.now(), results: results, serper: _extractRelated(data) };
        if (results.length) _cachePut(id, entry);   // never cache empty answers
        return entry;
      })
      .finally(function () { _shared.inflight.delete(id); });

    _shared.inflight.set(id, p);
    return p;
    }
                 // Wikipedia opensearch: no API key, CORS-enabled. Used only as a fallback source.
  function _requestWiki(q) {
    const id = 'wiki:' + _cacheKey(q);

    const hit = _cacheGet(id);
    if (hit) return Promise.resolve(hit.titles);
    if (_shared.inflight.has(id)) return _shared.inflight.get(id);

    const url = 'https://en.wikipedia.org/w/api.php'
      + '?action=opensearch&format=json&origin=*&limit=12&search=' + encodeURIComponent(q);

    const p = _fetchJson(url, WIKI_TIMEOUT)
      .then(function (data) {
        // opensearch returns [query, [titles], [descriptions], [urls]]
        const titles = Array.isArray(data && data[1])
          ? data[1].filter(function (t) { return typeof t === 'string'; })
          : [];
        _cachePut(id, { ts: Date.now(), titles: titles });
        return titles;
      })
      .catch(function () { return []; })
      .finally(function () { _shared.inflight.delete(id); });

    _shared.inflight.set(id, p);
    return p;
  }

  /* --------------------------------------------------------------------------
     Suggestions: ranking + de-dupe
     Order: Serper related searches first (real "people also search" queries),
     Wikipedia titles only fill the rest and must share a word with the query.
     -------------------------------------------------------------------------- */

  function _buildSuggestions(q, serper, wiki) {
    const qNorm = _norm(q);
    const qTokens = new Set(qNorm.split(' ').filter(Boolean));
    const seen = new Set([qNorm]);
    const out = [];

    function accept(text, needOverlap) {
      const t = String(text || '').replace(/\s+/g, ' ').trim();
      if (t.length < 2 || t.length > 48) return;
      if (/\(disambiguation\)$/i.test(t)) return;
      if (/^(list|lists|index|outline|category|template) ?(of|:)/i.test(t)) return;

      const n = _norm(t);
      if (!n || seen.has(n)) return;

      if (needOverlap) {
        const words = n.split(' ');
        let shared = false;
        for (let i = 0; i < words.length; i++) {
          if (qTokens.has(words[i])) { shared = true; break; }
        }
        if (!shared) return;
      }

      seen.add(n);
      out.push(t);
    }

    serper.forEach(function (s) { accept(s, false); });
    wiki.forEach(function (s) { accept(s, true); });
    return out.slice(0, SUGG_POOL_MAX);
  }

  // Rebuild the ranked list, keep already-placed pills where they are, and
  // re-measure sections that may now get (more) suggestions.
  function _syncSuggestions() {
    const ranked = _buildSuggestions(_q, _serperSuggs, _wikiSuggs);

    const taken = new Set();
    if (_gallery) {
      _gallery.querySelectorAll('.gallery-grid').forEach(function (section) {
        (section._sugg || []).forEach(function (t) { taken.add(t); });
      });
    }
    _suggPool = ranked.filter(function (t) { return !taken.has(t); });

    if (_gallery) {
      _gallery.querySelectorAll('.gallery-grid').forEach(function (section) {
        if (section._open <= 0) _scheduleMeasure(section);
      });
    }
  }

  /* --------------------------------------------------------------------------
     Bottom sheet
     -------------------------------------------------------------------------- */

  function _ensureSheet() {
    if (_sheetEl) return;

    _sheetBackdrop = document.createElement('div');
    _sheetBackdrop.className = 'img-sheet-backdrop';
    _sheetBackdrop.addEventListener('click', _closeSheet);

    _sheetEl = document.createElement('div');
    _sheetEl.className = 'img-sheet';
    _sheetEl.setAttribute('role', 'dialog');
    _sheetEl.setAttribute('aria-modal', 'true');

    document.body.appendChild(_sheetBackdrop);
    document.body.appendChild(_sheetEl);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _sheetOpen) _closeSheet();
    });
  }

  function _openSheet(data) {
    _ensureSheet();

    // Full-res first; the cached thumbnail shows instantly while it loads.
    const full = data.img_src || data.thumbnail_src || '';
    const thumb = data.thumbnail_src && data.thumbnail_src !== full ? data.thumbnail_src : '';
    const pageUrl = _safeUrl(data.url) || full;
    const title = data.title || '';

    let host = '';
    try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch (_) { /* no host */ }

    _sheetEl.innerHTML = `
      <div class="img-sheet__handle"></div>
      <div class="img-sheet__img-wrap">
        <img class="img-sheet__img" src="${_esc(thumb || full)}" alt="${_esc(title)}" decoding="async" referrerpolicy="no-referrer">
      </div>
      <div class="img-sheet__info">
        <div class="img-sheet__text">
          <span class="img-sheet__title">${_esc(title)}</span>
          ${host ? `<span class="img-sheet__host">${_esc(host)}</span>` : ''}
        </div>
      </div>
      <div class="img-sheet__actions">
        <a class="img-sheet__btn" href="${_esc(pageUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Visit site">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
          <span>Visit</span>
        </a>
        <a class="img-sheet__btn" href="${_esc(full)}" download target="_blank" rel="noopener noreferrer" aria-label="Download image">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>Download</span>
        </a>
      </div>
    `;

    // Swap the thumbnail for the full-res image once it has actually loaded.
    const token = ++_sheetToken;
    const view = _sheetEl.querySelector('.img-sheet__img');
    if (thumb && full && view) {
      const hi = new Image();
      hi.decoding = 'async';
      hi.referrerPolicy = 'no-referrer';
      hi.onload = function () {
        if (_sheetOpen && token === _sheetToken) view.src = full;
      };
      hi.src = full;
    }

    _sheetBackdrop.classList.add('img-sheet-backdrop--open');
    _sheetEl.classList.add('img-sheet--open');
    if (!_sheetOpen) _prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    _sheetOpen = true;
  }

  function _closeSheet() {
    if (!_sheetEl || !_sheetOpen) return;
    _sheetToken++;
    _sheetBackdrop.classList.remove('img-sheet-backdrop--open');
    _sheetEl.classList.remove('img-sheet--open');
    document.body.style.overflow = _prevOverflow;
    _sheetOpen = false;
  }

  /* --------------------------------------------------------------------------
     Tile
     -------------------------------------------------------------------------- */

  // Tiny cached thumbnail painted under the full-res image: instant first paint,
  // then the original-resolution image fades in on top.
  function _applyPlaceholder(spacer, thumb) {
    if (!spacer || !thumb || spacer.style.backgroundImage) return;
    spacer.style.backgroundImage = _cssUrl(thumb);
    spacer.style.backgroundSize = 'cover';
    spacer.style.backgroundPosition = 'center';
  }

  function _clearPlaceholderLater(spacer) {
    setTimeout(function () {
      if (spacer) spacer.style.backgroundImage = '';
    }, 450);
  }

  // A tile counts as "settled" once its image loaded or finally failed.
  // A grid section is only measured for gap-fill after all its tiles settled.
  function _settleTile(image) {
    if (image.dataset.settled === '1') return;
    image.dataset.settled = '1';
    const section = image.closest('.gallery-grid');
    if (!section) return;
    section._open = Math.max(0, section._open - 1);
    if (section._open === 0) _scheduleMeasure(section);
  }

  function _loadImage(image) {
    if (!image) return;
    if (image.dataset.loaded === '1' || image.dataset.loading === '1') return;
    const src = image.dataset.src;
    if (!src) return;
    image.dataset.loading = '1';
    _applyPlaceholder(image.parentElement, image.dataset.thumb);
    image.src = src;
    _shared.preloaded.add(src);
  }

  function _buildTile(data, idx) {
    // img_src (original, full resolution) first; thumbnail_src is the fallback.
    const srcs = [];
    if (data.img_src) srcs.push(data.img_src);
    if (data.thumbnail_src && data.thumbnail_src !== data.img_src) srcs.push(data.thumbnail_src);
    if (!srcs.length) return null;

    const src = srcs[0];
    const thumb = srcs.length > 1 ? srcs[1] : '';
    const eager = idx < EAGER_COUNT;

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
    image.referrerPolicy = 'no-referrer';
    if (thumb) image.dataset.thumb = thumb;
    image.dataset.srcIndex = '0';

    image.onload = function () {
      // Guard against 1x1 tracking pixels or zero-dimension stubs (HTTP 200).
      if (this.naturalWidth < 2 || this.naturalHeight < 2) {
        this.onerror();
        return;
      }
      this.dataset.loaded = '1';
      this.style.opacity = '';
      this.style.visibility = '';
      this.style.transition = '';

      // Authoritative geometry: real natural size of whatever URL actually loaded.
      const sp = this.parentElement;
      if (sp && sp.classList.contains('img-tile__spacer')) {
        sp.style.paddingBottom = ((this.naturalHeight / this.naturalWidth) * 100).toFixed(2) + '%';
        _clearPlaceholderLater(sp);
      }

      requestAnimationFrame(() => {
        if (this.isConnected) this.classList.add('img-loaded');
      });

      _settleTile(this);
    };

    image.onerror = function () {
      const nextIndex = (parseInt(this.dataset.srcIndex, 10) || 0) + 1;
      if (nextIndex < srcs.length) {
        this.dataset.srcIndex = String(nextIndex);
        this.src = srcs[nextIndex];
        return;
      }

      // All sources exhausted: collapse space and remove the tile.
      _settleTile(this);

      const sp = this.parentElement;
      if (sp && sp.classList.contains('img-tile__spacer')) sp.style.paddingBottom = '0';

      const t = this.closest('.img-tile');
      if (!t) return;
      const parent = t.parentElement;
      t.remove();
      if (!parent) return;

      if (parent.classList.contains('gallery-col')) {
        const grid = parent.parentElement;
        if (grid && grid.classList.contains('gallery-grid')) {
          const allEmpty = Array.from(grid.querySelectorAll('.gallery-col'))
            .every(function (c) { return c.children.length === 0; });
          if (allEmpty) {
            _releaseTexts(grid);
            grid._dead = true;
            grid.remove();
          } else {
            _scheduleMeasure(grid);
          }
        }
      } else if (parent.classList.contains('gallery-hero')) {
        parent.remove();
      }
    };

    if (eager) {
      // Above-the-fold: no lazy observer, no fade-in.
      image.setAttribute('fetchpriority', idx < EAGER_HIGH ? 'high' : 'auto');
      image.style.transition = 'none';
      _applyPlaceholder(spacer, thumb);
      image.src = src;
      _shared.preloaded.add(src);
    } else {
      image.dataset.src = src;
      // opacity:0 keeps the image in the render pipeline so load/error fire on
      // Android WebView, and avoids the layout shift of visibility:hidden.
      image.style.opacity = '0';
    }

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
    menu.innerHTML = '<svg width="16" height="4" viewBox="0 0 16 4" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="2" cy="2" r="1.5" fill="currentColor"/><circle cx="8" cy="2" r="1.5" fill="currentColor"/><circle cx="14" cy="2" r="1.5" fill="currentColor"/></svg>';
    menu.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      _openSheet(data);
    });
    overlay.appendChild(menu);

    tile.appendChild(overlay);
    tile.dataset.imageSrc = src;   // hook for external CSS/JS; unused in this file

    return tile;
        }
    /* --------------------------------------------------------------------------
     Suggestion pill
     -------------------------------------------------------------------------- */

  function _buildPill(q) {
    const btn = document.createElement('button');
    btn.className = 'sugg-pill';
    btn.type = 'button';
    btn.textContent = q;
    btn.addEventListener('click', function () {
      _setLastQuery(q);
      window.dispatchEvent(new CustomEvent('atkyn-search', { detail: { q: q } }));
    });
    return btn;
  }

  /* --------------------------------------------------------------------------
     Gap-fill: measure the shorter column, then stretch pills into the gap
     One batched pass per frame: clear -> read -> write (no layout thrash).
     -------------------------------------------------------------------------- */

  function _releaseTexts(section) {
    const mine = section._sugg;
    if (!mine) return;
    while (mine.length) _suggPool.unshift(mine.pop());
  }

  function _takeFor(section, n) {
    const mine = section._sugg || (section._sugg = []);
    while (mine.length < n && _suggPool.length) mine.push(_suggPool.shift());
    while (mine.length > n) _suggPool.unshift(mine.pop());
    return mine.slice();
  }

  // Content height measured from the last tile, so it stays correct even when
  // the grid stretches both columns to the same row height.
  function _colHeight(col) {
    const last = col.lastElementChild;
    if (!last) return 0;
    return last.getBoundingClientRect().bottom - col.getBoundingClientRect().top;
  }

  function _colGap(col) {
    const cs = getComputedStyle(col);
    let g = parseFloat(cs.rowGap);
    if (!isFinite(g) && col.lastElementChild) {
      g = parseFloat(getComputedStyle(col.lastElementChild).marginBottom);
    }
    return isFinite(g) && g >= 0 ? g : DEFAULT_GAP;
  }

  function _scheduleMeasure(section) {
    _dirty.add(section);
    if (_passQueued) return;
    _passQueued = true;
    requestAnimationFrame(_runPass);
  }

  function _planFill(section) {
    const cols = section.querySelectorAll(':scope > .gallery-col');
    if (cols.length !== 2 || !cols[0].children.length || !cols[1].children.length) {
      _releaseTexts(section);
      return null;
    }

    const hA = _colHeight(cols[0]);
    const hB = _colHeight(cols[1]);
    const shorter = hA < hB ? cols[0] : cols[1];
    const g = _colGap(shorter);
    const H = Math.floor(Math.abs(hA - hB) - g);   // wrapper height that closes the gap

    if (H < PILL_MIN_H) { _releaseTexts(section); return null; }

    const available = (section._sugg ? section._sugg.length : 0) + _suggPool.length;
    if (!available) return null;

    let n = Math.min(PILL_MAX_PER_GAP, Math.max(1, Math.round(H / 80)), available);
    while (n > 1 && (H - (n - 1) * g) / n < PILL_MIN_H) n--;

    return { section: section, col: shorter, H: H, g: g, n: n };
  }

  function _applyFill(plan) {
    const texts = _takeFor(plan.section, plan.n);
    if (!texts.length) return;

    const wrap = document.createElement('div');
    wrap.className = 'sugg-gap-fill';
    wrap.style.height = plan.H + 'px';   // only the height is dynamic; the rest lives in images.css

    texts.forEach(function (text) {
      const pill = _buildPill(text);
      pill.classList.add('sugg-pill--gap');
      wrap.appendChild(pill);
    });

    plan.col.appendChild(wrap);
  }

  function _runPass() {
    _passQueued = false;

    const sections = Array.from(_dirty).filter(function (s) {
      return s.isConnected && !s._dead && s._open <= 0;
    });
    _dirty.clear();
    if (!sections.length) return;

    // Top of the page gets the best-ranked suggestions.
    sections.sort(function (a, b) {
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    sections.forEach(function (s) {                       // 1. clear (assignments stay)
      s.querySelectorAll('.sugg-gap-fill').forEach(function (el) { el.remove(); });
    });
    const plans = sections.map(_planFill).filter(Boolean); // 2. read
    plans.forEach(_applyFill);                            // 3. write
  }

  function _onGalleryResize() {
    if (!_gallery) return;
    const w = Math.round(_gallery.clientWidth);
    if (Math.abs(w - _lastWidth) < 2) return;   // ignore height-only changes (our own pills)
    _lastWidth = w;

    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function () {
      if (!_gallery) return;
      _gallery.querySelectorAll('.gallery-grid').forEach(function (section) {
        if (section._open <= 0) _scheduleMeasure(section);
      });
    }, 150);
  }

  /* --------------------------------------------------------------------------
     Lazy-load observer
     -------------------------------------------------------------------------- */

  function _initObserver() {
    if (_lazyIo) { _lazyIo.disconnect(); _lazyIo = null; }
    if (typeof IntersectionObserver === 'undefined') return;

    _lazyIo = new IntersectionObserver(function (entries, observer) {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        _loadImage(entry.target);
      }
    }, { rootMargin: LAZY_MARGIN, threshold: 0 });
  }

  function _observeTile(tile) {
    if (!tile) return;
    const image = tile.querySelector('.img-lazy');
    // Eager tiles have no data-src and load directly.
    if (!image || !image.dataset.src) return;
    if (_lazyIo) _lazyIo.observe(image);
    else _loadImage(image);   // very old WebView without IntersectionObserver
  }

  /* --------------------------------------------------------------------------
     Layout
     -------------------------------------------------------------------------- */

  function _buildGridSection(items, startIdx) {
    const section = document.createElement('div');
    section.className = 'gallery-grid';

    const cols = [document.createElement('div'), document.createElement('div')];
    cols.forEach(function (c) { c.className = 'gallery-col'; section.appendChild(c); });

    const heights = [0, 0];
    let placed = 0;
    for (const data of items) {
      const tile = _buildTile(data, startIdx + placed);
      if (!tile) continue;
      const col = heights[0] <= heights[1] ? 0 : 1;
      cols[col].appendChild(tile);
      const r = _ratio(data);
      heights[col] += r !== null ? r : 1.2;
      _observeTile(tile);
      placed++;
    }

    if (!placed) return null;
    section._open = placed;     // tiles still loading; gap-fill waits for 0
    section._sugg = [];
    return section;
  }

  function _buildHero(data, idx) {
    const tile = _buildTile(data, idx);
    if (!tile) return null;
    const section = document.createElement('div');
    section.className = 'gallery-hero';
    section.appendChild(tile);
    _observeTile(tile);
    return section;
  }

  function _renderGallery(results) {
    const fragment = document.createDocumentFragment();
    const random = _random(_seedFromString(_qKey));
    let totalPlaced = 0;

    const queue = [];
    for (const item of results) {
      const r = _ratio(item);
      if (r !== null && r > GRID_MAX_RATIO) continue;
      queue.push({ item: item, heroOk: r === null || r <= HERO_MAX_RATIO });
    }

    while (queue.length > 0) {
      const hasHero = queue.some(function (e) { return e.heroOk; });
      const forceHero = fragment.childNodes.length === 0;
      const useHero = hasHero && (forceHero || queue.length === 1 || random() < 0.55);

      if (useHero) {
        let data = null;
        for (let i = 0; i < queue.length; i++) {
          if (queue[i].heroOk) { data = queue.splice(i, 1)[0].item; break; }
        }
        if (data) {
          const section = _buildHero(data, totalPlaced);
          if (section) { fragment.appendChild(section); totalPlaced++; }
        }
      } else {
        const count = queue.length >= 4 && random() < 0.45 ? 4 : Math.min(2, queue.length);
        const items = [];
        while (items.length < count && queue.length > 0) items.push(queue.splice(0, 1)[0].item);
        if (items.length) {
          const section = _buildGridSection(items, totalPlaced);
          if (section) { fragment.appendChild(section); totalPlaced += items.length; }
        }
      }
    }

    _gallery.replaceChildren(fragment);
  }

  /* --------------------------------------------------------------------------
     Idle cache warm (skipped on Data Saver / slow connections)
     -------------------------------------------------------------------------- */

  function _warmCache(results) {
    const conn = navigator.connection;
    if (conn && (conn.saveData || /2g$/.test(conn.effectiveType || ''))) return;

    _warmQueue = results.slice(EAGER_COUNT, EAGER_COUNT + WARM_AHEAD).map(function (item) {
      return item.img_src || item.thumbnail_src || '';
    });
    if (_warmRunning || !_warmQueue.length) return;
    _warmRunning = true;

    const next = function () {
      if (!_warmQueue.length) { _warmRunning = false; return; }
      _preload(_warmQueue.shift());
      if (typeof requestIdleCallback === 'function') requestIdleCallback(next, { timeout: 150 });
      else requestAnimationFrame(next);
    };
    next();
  }

  /* --------------------------------------------------------------------------
     Mount guards
     Async work (fetches, timers, observers) must never write into #pageContent
     after the person left the Images tab; that is what made Images show up
     inside Web/Answer and the other way round.
     -------------------------------------------------------------------------- */

  // core.js says whose view belongs in #pageContent. Without it (older core) we never block.
  function _tabOwnsPage() {
    const owner = window._atkynPageOwner;
    return typeof owner !== 'function' || owner() === TAB_KEY;
  }

  // True only while this exact query's gallery is still the one on screen.
  function _isMounted(token) {
    return token === _queryToken && !!_gallery && _gallery.isConnected && _tabOwnsPage();
  }

  // Another tab replaced our content: stop everything for good.
  function _evict() {
    _queryToken = (_queryToken + 1) | 0;
    _teardown();
    _gallery = null;
  }

  function _watchMount(page) {
    if (_pageMo) { _pageMo.disconnect(); _pageMo = null; }
    if (typeof MutationObserver === 'undefined') return;
    _pageMo = new MutationObserver(function () {
      if (_gallery && !_gallery.isConnected) _evict();
    });
    _pageMo.observe(page, { childList: true });
  }

  /* --------------------------------------------------------------------------
     Mount / teardown
     -------------------------------------------------------------------------- */

  function _showMessage(page, text, withRetry) {
    _gallery = null;
    if (_pageMo) { _pageMo.disconnect(); _pageMo = null; }
    const box = document.createElement('div');
    box.className = 'tab-empty';

    const p = document.createElement('p');
    p.textContent = text;
    box.appendChild(p);

    if (withRetry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-empty__retry';
      btn.textContent = 'Retry';
      btn.addEventListener('click', function () { window._atkynInit_images(); });
      box.appendChild(btn);
    }
    page.replaceChildren(box);
  }

  function _teardown() {
    if (_lazyIo) { _lazyIo.disconnect(); _lazyIo = null; }
    if (_galleryRo) { _galleryRo.disconnect(); _galleryRo = null; }
    if (_pageMo) { _pageMo.disconnect(); _pageMo = null; }
    clearTimeout(_resizeTimer);
    _closeSheet();
    _dirty.clear();
    _warmQueue = [];
    _warmRunning = false;
    _serperSuggs = [];
    _wikiSuggs = [];
    _suggPool = [];
    _lastWidth = 0;
  }

  function _mountResults(entry, token) {
    if (!_isMounted(token)) return;

    if (!entry.results.length) {
      _showMessage(_gallery.parentElement, 'No images found', false);
      return;
    }

    _serperSuggs = entry.serper || [];
    _initObserver();
    _renderGallery(entry.results);
    _syncSuggestions();
    _warmCache(entry.results);
  }

  window._atkynInit_images = function () {
    if (!_tabOwnsPage()) return;   // late script load / stray call while another tab is active

    const page = document.getElementById('pageContent');
    const q = _getLastQuery();
    const key = _cacheKey(q);

    // Same query is already rendered and still mounted: nothing to do.
    if (page && key && _gallery && _gallery.isConnected && page.contains(_gallery) && key === _qKey) return;

    _teardown();
    _queryToken = (_queryToken + 1) | 0;
    const token = _queryToken;

    _q = q;
    _qKey = key;

    if (!page) return;

    if (!q) {
      _showMessage(page, 'Search something to see images', false);
      return;
    }

    _gallery = document.createElement('div');
    _gallery.className = 'images-grid';
    page.replaceChildren(_gallery);
    _watchMount(page);

    if (typeof ResizeObserver !== 'undefined') {
      _galleryRo = new ResizeObserver(_onGalleryResize);
      _galleryRo.observe(_gallery);
    }

    // Images and Wikipedia suggestions start in parallel; cached results render at once.
    _requestImages(q)
      .then(function (entry) { _mountResults(entry, token); })
      .catch(function () {
        if (_isMounted(token)) _showMessage(_gallery.parentElement, 'Could not load images', true);
      });

    _requestWiki(q).then(function (titles) {
      if (!_isMounted(token)) return;
      _wikiSuggs = titles;
      _syncSuggestions();
    });
  };

  // core.js calls this the moment the tab is left: stop all work, free the DOM.
  window._atkynLeave_images = function () {
    const old = _gallery;
    _evict();
    if (old) old.replaceChildren();
  };

  // Call right after a search to make the Images tab instant later.
  window._atkynPrefetch_images = function (q) {
    q = String(q || '').trim();
    if (!q) return;
    _requestImages(q).catch(function () { /* silent */ });
    _requestWiki(q);
  };

  window._atkynInit_images();
}());
      
