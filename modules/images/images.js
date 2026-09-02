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

  function _buildTile(data) {
    const src = data.img_src || data.thumbnail_src || '';
    if (!src) return null;

    const r = _ratio(data);
    const aspect = r !== null ? (r * 100).toFixed(2) + '%' : '100%';

    const tile = document.createElement('a');
    tile.className = 'img-tile';
    tile.href = data.url || src;
    tile.target = '_blank';
    tile.rel = 'noopener noreferrer';

    const spacer = document.createElement('div');
    spacer.className = 'img-tile__spacer';
    spacer.style.paddingBottom = aspect;

    const image = document.createElement('img');
    image.className = 'img-lazy';
    image.alt = data.title || '';
    image.decoding = 'async';
    image.dataset.src = src;

    image.onload = function () {
      this.dataset.loaded = '1';
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
      tile.dispatchEvent(new CustomEvent('img-menu', { bubbles: true, detail: data }));
    });

    overlay.appendChild(menu);
    tile.appendChild(overlay);
    tile.dataset.imageSrc = src;
    tile._imageData = data;

    return tile;
  }

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

    // Pre-classify: hero-fit (ratio <= 0.75), grid-fit (ratio <= 1.4), no-dims
    // Items with no dimensions go into grid pool as fallback
    const heroPool = [];
    const gridPool = [];

    for (const item of results) {
      const r = _ratio(item);
      if (r === null || r <= HERO_MAX_RATIO) {
        heroPool.push(item);
        if (r === null || r <= GRID_MAX_RATIO) gridPool.push(item);
      } else if (r <= GRID_MAX_RATIO) {
        gridPool.push(item);
      }
      // ratio > GRID_MAX_RATIO: too tall for any slot — skip entirely
    }

    // Pointers into each pool
    let hi = 0;
    let gi = 0;
    let sectionNumber = 0;

    while (hi < heroPool.length || gi < gridPool.length) {
      const heroRemaining = heroPool.length - hi;
      const gridRemaining = gridPool.length - gi;
      const total = heroRemaining + gridRemaining;

      if (total === 0) break;

      const forceHero = sectionNumber === 0;
      const useHero = heroRemaining > 0 && (forceHero || gridRemaining === 0 || random() < 0.65);

      if (useHero) {
        const data = heroPool[hi++];
        // Also advance gridPool pointer if same item is in both pools
        if (gridPool[gi] === data) gi++;
        const section = _buildHero(data);
        if (section) fragment.appendChild(section);
      } else {
        if (gridRemaining === 0) continue;
        const count = gridRemaining >= 4 && random() < 0.45 ? 4 : Math.min(2, gridRemaining);
        const items = gridPool.slice(gi, gi + count);
        gi += items.length;
        // Also advance heroPool past any items consumed from gridPool
        for (const item of items) {
          if (heroPool[hi] === item) hi++;
        }
        const section = _buildGridSection(items);
        if (section) fragment.appendChild(section);
      }

      sectionNumber++;
    }

    _gallery.replaceChildren(fragment);
  }

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

  window._atkynInit_images = function () {
    if (_lazyIo) { _lazyIo.disconnect(); _lazyIo = null; }
    _seen = new Set();
    _warmQueue = [];
    _warmRunning = false;
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
             
