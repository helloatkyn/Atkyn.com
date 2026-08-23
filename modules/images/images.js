/* modules/images.js — Images tab */
(function () {

  const MAX_CALLS = 3;

  let _seen         = new Set();
  let _offset       = 0;
  let _grid         = null;
  let _sentinel     = null;
  let _scrollIo     = null;
  let _lazyIo       = null;
  let _loading      = false;
  let _exhausted    = false;
  let _patternQueue = [];

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
    // width/height bilkul nahi — browser natural size use karega
    imgEl.dataset.src   = src;
    imgEl.dataset.thumb = thumb;
    imgEl.classList.add('img-lazy');

    imgEl.onerror = function () {
      // Thumbnail try karo
      if (this.dataset.triedThumb !== '1' && thumb && thumb !== this.src) {
        this.dataset.triedThumb = '1';
        this.src = thumb;
        return;
      }
      // Dono fail — tile completely remove, koi placeholder nahi
      const tile = this.closest('.img-tile');
      if (tile) tile.remove();
    };

    wrap.appendChild(imgEl);
    a.appendChild(wrap);
    return a;
  }

  function _appendTiles(results) {
    const fresh = results.filter(r => {
      const key = r.img_src;
      if (!key || _seen.has(key)) return false;
      _seen.add(key);
      return true;
    });

    if (!fresh.length) return 0;

    const frag = document.createDocumentFragment();
    fresh.forEach(img => {
      const tile = _buildTile(img, _nextSpan());
      if (tile) frag.appendChild(tile);
    });

    if (_sentinel?.parentNode === _grid) {
      _grid.insertBefore(frag, _sentinel);
    } else {
      _grid.appendChild(frag);
    }

    _grid.querySelectorAll('.img-lazy:not([data-ob])').forEach(img => {
      img.dataset.ob = '1';
      _lazyIo.observe(img);
    });

    return fresh.length;
  }

  function _done() {
    _exhausted = true;
    _sentinel?.remove();
    _sentinel = null;
    _scrollIo?.disconnect();
  }

  function _fetchNext(q) {
    if (_loading || _exhausted) return;
    if (_offset >= MAX_CALLS) { _done(); return; }
    _loading = true;

    fetch(`/api/images?q=${encodeURIComponent(q)}&offset=${_offset}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        _offset++;
        const results = data.results || [];

        if (!results.length) { _done(); _loading = false; return; }

        _appendTiles(results);
        _loading = false;

        if (_offset >= MAX_CALLS) {
          _done();
          return;
        }

        if (_sentinel && _scrollIo) {
          _scrollIo.unobserve(_sentinel);
          _scrollIo.observe(_sentinel);
        }
      })
      .catch(() => { _done(); _loading = false; });
  }

  window._atkynInit_images = function () {
    _seen         = new Set();
    _offset       = 0;
    _grid         = null;
    _sentinel     = null;
    _loading      = false;
    _exhausted    = false;
    _patternQueue = [];

    if (_scrollIo) { _scrollIo.disconnect(); _scrollIo = null; }
    if (_lazyIo)   { _lazyIo.disconnect();   _lazyIo   = null; }

    const q  = sessionStorage.getItem('atkyn_last_query') || '';
    const pc = document.getElementById('pageContent');

    if (!q) {
      pc.innerHTML = '<div class="tab-empty"><p>Search something to see images</p></div>';
      return;
    }

    pc.innerHTML = '<div class="tab-skeleton grid"><div class="sk-img"></div><div class="sk-img"></div><div class="sk-img"></div><div class="sk-img"></div></div>';

    // Thumbnail fast load — src seedha set, lazy nahi
    _lazyIo = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        // Pehle thumbnail dikhao, phir full swap
        img.src = img.dataset.thumb || img.dataset.src;
        img.onload = () => {
          img.classList.add('img-loaded');
          // Full src alag hai toh background mein load karo
          if (img.dataset.src !== img.src) {
            const full = new Image();
            full.onload = () => { img.src = img.dataset.src; };
            full.src = img.dataset.src;
          }
        };
        obs.unobserve(img);
      });
    }, { rootMargin: '800px' });

    _sentinel = document.createElement('div');
    _sentinel.className = 'img-sentinel';

    _grid = document.createElement('div');
    _grid.className = 'images-grid';
    _grid.appendChild(_sentinel);

    pc.innerHTML = '';
    pc.appendChild(_grid);

    _scrollIo = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      _fetchNext(q);
    }, { rootMargin: '600px' });

    _scrollIo.observe(_sentinel);

    // Pehli call turant
    _fetchNext(q);
  };

  window._atkynInit_images();
}());
