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
  let _suggestions = [];

  let _sheetEl = null;
  let _sheetBackdrop = null;
  let _sheetOpen = false;

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

  /* ── Suggestions ──────────────────────────────────────────── */

  function _buildSuggestions(items) {
    if (!items || !items.length) return null;
    const wrap = document.createElement('div');
    wrap.className = items.length === 1 ? 'sugg-row sugg-row--single' : 'sugg-row';
    items.forEach(function (s) {
      const q = typeof s === 'string' ? s : (s.query || '');
      if (!q) return;
      const btn = document.createElement('button');
      btn.className = 'sugg-pill';
      btn.type = 'button';
      btn.textContent = q;
      btn.addEventListener('click', function () {
        sessionStorage.setItem('atkyn_last_query', q);
        window.dispatchEvent(new CustomEvent('atkyn-search', { detail: { q } }));
      });
      wrap.appendChild(btn);
    });
    return wrap.children.length ? wrap : null;
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

    const suggQueue = _suggestions.slice();
    let sectionNumber = 0;

    const takeHero = function () {
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].heroOk) return queue.splice(i, 1)[0].item;
      }
      return null;
    };

    const takeGrid = function (count) {
      const taken = [];
      while (taken.length < count && queue.length > 0) {
        taken.push(queue.splice(0, 1)[0].item);
      }
      return taken;
    };

    const SUGG_AT = [2, 5, 9, 14, 19];
    const totalSugg = suggQueue.length;
    const basePerSlot = totalSugg > 0 ? Math.floor(totalSugg / SUGG_AT.length) : 0;
    const remainder = totalSugg > 0 ? totalSugg % SUGG_AT.length : 0;
    const slotSizes = SUGG_AT.map((_, i) => basePerSlot + (i < remainder ? 1 : 0));
    let slotIndex = 0;

    const injectSuggestions = function () {
      if (!suggQueue.length || slotIndex >= slotSizes.length) return;
      const count = slotSizes[slotIndex++];
      if (!count) return;
      const slice = suggQueue.splice(0, count);
      const card = _buildSuggestions(slice);
      if (card) fragment.appendChild(card);
    };

    while (queue.length > 0) {
      if (slotIndex < SUGG_AT.length && sectionNumber === SUGG_AT[slotIndex]) injectSuggestions();

      const hasHero = queue.some(e => e.heroOk);
      const forceHero = sectionNumber === 0;
      const useHero = hasHero && (forceHero || queue.length === 1 || random() < 0.55);

      if (useHero) {
        const data = takeHero();
        if (data) {
          const section = _buildHero(data);
          if (section) fragment.appendChild(section);
        }
      } else {
        const count = queue.length >= 4 && random() < 0.45 ? 4 : Math.min(2, queue.length);
        const items = takeGrid(count);
        if (items.length) {
          const section = _buildGridSection(items);
          if (section) fragment.appendChild(section);
        }
      }

      sectionNumber++;
    }

    if (suggQueue.length) injectSuggestions();

    _gallery.replaceChildren(fragment);
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

  /* ── Fetch ────────────────────────────────────────────────── */

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

        _suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];

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
    _closeSheet();
    _seen = new Set();
    _warmQueue = [];
    _warmRunning = false;
    _suggestions = [];
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

    _initObserver();
    _fetchImages();
  };

  window._atkynInit_images();
}());
      
