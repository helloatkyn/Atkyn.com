(function () {
  'use strict';

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

  function _buildTile(data, isHero) {
    const src = data.img_src || data.thumbnail_src || '';
    if (!src) return null;

    const MAX_HERO  = 75;
    const MAX_GRID  = 140;

    let rawRatio = data.width && data.height
      ? (data.height / data.width * 100)
      : (isHero ? 60 : 120);

    const capped = isHero
      ? Math.min(rawRatio, MAX_HERO)
      : Math.min(rawRatio, MAX_GRID);

    const aspect = capped.toFixed(2) + '%';

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
      this.dataset.failed = '1';
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
      const tile = _buildTile(data, false);
      if (!tile) continue;
      const col = heights[0] <= heights[1] ? 0 : 1;
      cols[col].appendChild(tile);
      heights[col] += data.width && data.height ? Math.min(data.height / data.width, 1.4) : 1.2;
      _observeTile(tile);
      placed++;
    }

    if (!placed) return null;
    return section;
  }

  function _buildHero(data) {
    const tile = _buildTile(data, true);
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
    let index = 0;
    let sectionNumber = 0;

    while (index < results.length) {
      const remaining = results.length - index;
      const useHero = remaining === 1 || sectionNumber === 0 || random() < 0.65;

      if (useHero) {
        const section = _buildHero(results[index]);
        if (section) fragment.appendChild(section);
        index += 1;
      } else {
        const count = remaining >= 4 && random() < 0.45 ? 4 : Math.min(2, remaining);
        const items = results.slice(index, index + count);
        const section = _buildGridSection(items);
        if (section) fragment.appendChild(section);
        index += items.length;
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
