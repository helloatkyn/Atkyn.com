/* modules/images.js — Images tab */
(function () {

  let _seen         = new Set();
  let _offset       = 0;
  let _grid         = null;
  let _sentinel     = null;
  let _scrollIo     = null;
  let _lazyIo       = null;
  let _loading      = false;
  let _exhausted    = false;
  let _patternQueue = [];
  let _q            = '';

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
    // CSS override inline — grey box aur bounce dono gone
    wrap.style.background = 'transparent';

    const imgEl         = document.createElement('img');
    imgEl.alt           = img.title || '';
    imgEl.decoding      = 'async';
    imgEl.dataset.src   = src;
    imgEl.dataset.thumb = thumb;
    imgEl.classList.add('img-lazy');
    // Inline styles — CSS se override
    imgEl.style.opacity    = '0';
    imgEl.style.transition = 'opacity 0.18s ease';
    imgEl.style.display    = 'block';
    imgEl.style.width      = '100%';
    imgEl.style.height     = 'auto';

    imgEl.onload = function () {
      this.style.opacity = '1';
    };

    imgEl.onerror = function () {
      if (this.dataset.triedThumb !== '1' && thumb && thumb !== this.src) {
        this.dataset.triedThumb = '1';
        this.src = thumb;
        return;
      }
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
    if (!fresh.length) return;

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
  }

  function _done() {
    _exhausted = true;
    _sentinel?.remove();
    _sentinel = null;
    _scrollIo?.disconnect();
  }

  function _fetchNext() {
    if (_loading || _exhausted) return;
    if (_offset >= 2) { _done(); return; }
    _loading = true;

    fetch(`/api/images?q=${encodeURIComponent(_q)}&offset=${_offset}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        _offset++;
        const results = data.results || [];
        if (!results.length) { _done(); _loading = false; return; }
        _appendTiles(results);
        _loading = false;
        if (_offset >= 2) {
          _done();
        } else if (_sentinel && _scrollIo) {
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
    _q            = sessionStorage.getItem('atkyn_last_query') || '';

    if (_scrollIo) { _scrollIo.disconnect(); _scrollIo = null; }
    if (_lazyIo)   { _lazyIo.disconnect();   _lazyIo   = null; }

    const pc = document.getElementById('pageContent');

    if (!_q) {
      pc.innerHTML = '<div class="tab-empty"><p>Search something to see images</p></div>';
      return;
    }

    pc.innerHTML = '<div class="tab-skeleton grid"><div class="sk-img"></div><div class="sk-img"></div><div class="sk-img"></div><div class="sk-img"></div></div>';

    _lazyIo = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        // Thumbnail pehle — fast feel
        el.src = el.dataset.thumb || el.dataset.src;
        // Full image background swap
        if (el.dataset.src && el.dataset.src !== el.src) {
          const full = new Image();
          full.onload = () => {
            if (el.isConnected) {
              el.src = el.dataset.src;
            }
          };
          full.src = el.dataset.src;
        }
        obs.unobserve(el);
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
      if (_offset < 1) return;
      _fetchNext();
    }, { rootMargin: '400px' });

    _scrollIo.observe(_sentinel);
    _fetchNext();
  };

  window._atkynInit_images();
}());
