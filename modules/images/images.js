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
    // Default 4:3 aspect ratio — image load hone pe natural size lega
    wrap.style.paddingBottom = '75%';
    wrap.style.position      = 'relative';
    wrap.style.overflow      = 'hidden';
    wrap.style.background    = '#f2f2f2';

    const imgEl    = document.createElement('img');
    imgEl.alt      = img.title || '';
    imgEl.decoding = 'async';
    imgEl.dataset.src   = src;
    imgEl.dataset.thumb = thumb;
    imgEl.classList.add('img-lazy');
    imgEl.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0;
      transition: opacity 0.2s ease;
    `;

    imgEl.onerror = function () {
      if (this.dataset.triedThumb !== '1' && thumb && thumb !== this.src) {
        this.dataset.triedThumb = '1';
        this.src = thumb;
        return;
      }
      const tile = this.closest('.img-tile');
      if (tile) tile.remove();
    };

    imgEl.onload = function () {
      // Natural aspect ratio restore karo
      const nat = this.naturalWidth && this.naturalHeight
        ? (this.naturalHeight / this.naturalWidth * 100).toFixed(2)
        : null;
      if (nat) wrap.style.paddingBottom = nat + '%';
      this.style.opacity = '1';
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
        const img = entry.target;
        // Thumbnail pehle — instant feel
        img.src = img.dataset.thumb || img.dataset.src;
        // Full image background mein swap
        if (img.dataset.src && img.dataset.src !== img.src) {
          const full = new Image();
          full.onload = () => {
            if (img.isConnected) img.src = img.dataset.src;
          };
          full.src = img.dataset.src;
        }
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

    // 2nd call sirf scroll pe — aur sirf ek baar
    _scrollIo = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      if (_offset < 1) return; // Pehli call complete hone do
      _fetchNext();
    }, { rootMargin: '400px' });

    _scrollIo.observe(_sentinel);

    // 1st call tab click pe hi — turant
    _fetchNext();
  };

  window._atkynInit_images();
}());
