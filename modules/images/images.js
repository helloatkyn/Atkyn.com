/* modules/images.js — Images tab */
(function () {

  const FIRST_BATCH = 24;
  const NEXT_BATCH  = 24;

  let _allResults   = [];
  let _rendered     = 0;
  let _patternQueue = [];
  let _grid         = null;
  let _sentinel     = null;
  let _loader       = null;
  let _scrollIo     = null;
  let _lazyIo       = null;
  let _loading      = false;

  const PATTERNS = [
    [2, 1, 1],
    [1, 1, 2],
    [1, 1, 1, 1],
    [2, 1, 1, 2],
    [1, 1, 2, 1, 1],
  ];

  function _nextSpan() {
    if (!_patternQueue.length) {
      const p = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
      _patternQueue = [...p];
    }
    return _patternQueue.shift();
  }

  function _buildTile(img, span) {
    const src   = img.img_src       || img.thumbnail_src || '';
    const thumb = img.thumbnail_src || img.img_src       || '';
    if (!src) return null;

    const w = img.width  || 0;
    const h = img.height || 0;

    const a = document.createElement('a');
    a.className = 'img-tile';
    if (span === 2) a.classList.add('img-tile--wide');
    a.href   = img.url || src;
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';

    const wrap = document.createElement('div');
    wrap.className = 'img-tile__wrap';

    const imgEl    = document.createElement('img');
    imgEl.alt      = img.title || '';
    imgEl.decoding = 'async';
    imgEl.dataset.src   = src;
    imgEl.dataset.thumb = thumb;
    imgEl.classList.add('img-lazy');

    if (w && h) {
      imgEl.width  = w;
      imgEl.height = h;
    }

    imgEl.onerror = function () {
      const tile = this.closest('.img-tile');
      if (this.src !== thumb && thumb && thumb !== src) {
        this.src = thumb;
      } else if (tile) {
        tile.style.transition = 'none';
        tile.style.margin     = '0';
        tile.style.padding    = '0';
        tile.style.height     = '0';
        tile.style.overflow   = 'hidden';
        tile.style.gridColumn = 'unset';
        requestAnimationFrame(() => tile.remove());
      }
    };

    wrap.appendChild(imgEl);
    a.appendChild(wrap);
    return a;
  }

  function _showLoader() {
    if (_loader) _loader.style.display = 'flex';
  }

  function _hideLoader() {
    if (_loader) _loader.style.display = 'none';
  }

  function _renderBatch(count) {
    if (_loading) return;
    _loading = true;

    const chunk = _allResults.slice(_rendered, _rendered + count);
    _hideLoader();

    if (!chunk.length) {
      _sentinel?.remove();
      _sentinel = null;
      _loading  = false;
      return;
    }

    const frag = document.createDocumentFragment();
    chunk.forEach(img => {
      const tile = _buildTile(img, _nextSpan());
      if (tile) frag.appendChild(tile);
    });

    if (_sentinel?.parentNode === _grid) {
      _grid.insertBefore(frag, _sentinel);
    } else {
      _grid.appendChild(frag);
    }

    _rendered += chunk.length;

    _grid.querySelectorAll('.img-lazy:not([data-ob])').forEach(img => {
      img.dataset.ob = '1';
      _lazyIo.observe(img);
    });

    _loading = false;

    if (_rendered >= _allResults.length) {
      _sentinel?.remove();
      _sentinel = null;
    } else {
      _showLoader();
      if (_sentinel && _scrollIo) {
        _scrollIo.unobserve(_sentinel);
        _scrollIo.observe(_sentinel);
      }
    }
  }

  window._atkynInit_images = function () {
    _allResults   = [];
    _rendered     = 0;
    _patternQueue = [];
    _grid         = null;
    _sentinel     = null;
    _loader       = null;
    _loading      = false;

    if (_scrollIo) { _scrollIo.disconnect(); _scrollIo = null; }
    if (_lazyIo)   { _lazyIo.disconnect();   _lazyIo   = null; }

    const q  = sessionStorage.getItem('atkyn_last_query') || '';
    const pc = document.getElementById('pageContent');

    if (!q) {
      pc.innerHTML = '<div class="tab-empty"><p>Search something to see images</p></div>';
      return;
    }

    pc.innerHTML = '<div class="tab-skeleton grid"><div class="sk-img"></div><div class="sk-img"></div><div class="sk-img"></div><div class="sk-img"></div></div>';

    _lazyIo = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        img.src = img.dataset.src;
        img.onload = () => img.classList.add('img-loaded');
        obs.unobserve(img);
      });
    }, { rootMargin: '600px' });

    _loader = document.createElement('div');
    _loader.className = 'img-loader';
    _loader.style.display = 'none';
    _loader.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#ddd" stroke-width="2.5"/>
        <path d="M12 2a10 10 0 0 1 10 10" stroke="#0077B5" stroke-width="2.5" stroke-linecap="round"/>
      </svg>`;

    _sentinel = document.createElement('div');
    _sentinel.className = 'img-sentinel';

    _grid = document.createElement('div');
    _grid.className = 'images-grid';
    _grid.appendChild(_sentinel);

    pc.innerHTML = '';
    pc.appendChild(_grid);
    pc.appendChild(_loader);

    _scrollIo = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      if (_loading) return;
      _renderBatch(NEXT_BATCH);
    }, { rootMargin: '400px' });

    _scrollIo.observe(_sentinel);

    fetch(`/api/images?q=${encodeURIComponent(q)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        _allResults = data.results || [];
        if (!_allResults.length) throw new Error('empty');
        _renderBatch(FIRST_BATCH);
      })
      .catch(() => {
        pc.innerHTML = '<div class="tab-empty"><p>Could not load images</p></div>';
      });
  };

  window._atkynInit_images();
}());
