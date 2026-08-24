/* modules/images.js — Images tab */
(function () {

  let _seen      = new Set();
  let _grid      = null;
  let _lazyIo    = null;
  let _loading   = false;
  let _exhausted = false;
  let _q         = '';

  // ─── Masonry: 2 column arrays, append to shorter one ───────────────────────
  let _cols = [null, null];   // [leftCol, rightCol] DOM refs
  let _colH = [0, 0];         // tracked heights (rough, via img natural aspect)

  function _shortCol() {
    return _colH[0] <= _colH[1] ? 0 : 1;
  }

  function _buildTile(img) {
    const src   = img.img_src       || img.thumbnail_src || '';
    const thumb = img.thumbnail_src || img.img_src       || '';
    if (!src) return null;

    const a = document.createElement('a');
    a.className = 'img-tile';
    a.href   = img.url || src;
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';

    const imgEl         = document.createElement('img');
    imgEl.alt           = img.title || '';
    imgEl.decoding      = 'async';
    imgEl.dataset.src   = src;
    imgEl.dataset.thumb = thumb;
    imgEl.classList.add('img-lazy');
    imgEl.style.cssText =
      'opacity:0;transition:opacity 0.2s ease;display:block;' +
      'width:100%;height:auto;border-radius:10px;will-change:opacity;';

    imgEl.onload = function () {
      requestAnimationFrame(() => { this.style.opacity = '1'; });
    };

    imgEl.onerror = function () {
      if (this.dataset.triedThumb !== '1' && thumb && thumb !== this.src) {
        this.dataset.triedThumb = '1';
        this.src = thumb;
        return;
      }
      const tile = this.closest('.img-tile');
      if (tile) { tile.style.display = 'none'; setTimeout(() => tile.remove(), 200); }
    };

    a.appendChild(imgEl);
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

    fresh.forEach(img => {
      const tile = _buildTile(img);
      if (!tile) return;

      // Append to shorter column
      const c = _shortCol();
      _cols[c].appendChild(tile);

      // Use aspect ratio from API if available, else assume square
      const aspect = (img.width && img.height) ? img.height / img.width : 1;
      _colH[c] += aspect;
    });

    // Observe new lazy images
    _grid.querySelectorAll('.img-lazy:not([data-ob])').forEach(el => {
      el.dataset.ob = '1';
      _lazyIo.observe(el);
    });
  }

  function _done() {
    _exhausted = true;
  }

  function _fetch() {
    if (_loading || _exhausted) return;
    _loading = true;

    fetch(`/api/images?q=${encodeURIComponent(_q)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        const results = data.results || [];
        _appendTiles(results);
        _done();
        _loading = false;
      })
      .catch(() => { _done(); _loading = false; });
  }

  window._atkynInit_images = function () {
    _seen      = new Set();
    _cols      = [null, null];
    _colH      = [0, 0];
    _grid      = null;
    _loading   = false;
    _exhausted = false;
    _q         = sessionStorage.getItem('atkyn_last_query') || '';

    if (_lazyIo) { _lazyIo.disconnect(); _lazyIo = null; }

    const pc = document.getElementById('pageContent');

    if (!_q) {
      pc.innerHTML = '<div class="tab-empty"><p>Search something to see images</p></div>';
      return;
    }

    pc.innerHTML = `
      <div class="tab-skeleton grid">
        <div class="sk-col"><div class="sk-img"></div><div class="sk-img sk-img--sm"></div><div class="sk-img"></div></div>
        <div class="sk-col"><div class="sk-img sk-img--sm"></div><div class="sk-img"></div><div class="sk-img sk-img--sm"></div></div>
      </div>`;

    // Lazy observer — thumb first, then full res swap
    _lazyIo = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        obs.unobserve(el);

        const thumbSrc = el.dataset.thumb || el.dataset.src;
        const fullSrc  = el.dataset.src;

        if (thumbSrc) el.src = thumbSrc;

        if (fullSrc && fullSrc !== thumbSrc) {
          const full = new Image();
          full.decoding = 'async';
          full.onload = () => {
            if (!el.isConnected) return;
            el.style.opacity = '0';
            requestAnimationFrame(() => { el.src = fullSrc; });
          };
          full.src = fullSrc;
        }
      });
    }, { rootMargin: '1200px' });

    // Masonry grid — 2 column divs
    _grid = document.createElement('div');
    _grid.className = 'images-grid';

    for (let i = 0; i < 2; i++) {
      const col = document.createElement('div');
      col.className = 'img-col';
      _grid.appendChild(col);
      _cols[i] = col;
    }

    pc.innerHTML = '';
    pc.appendChild(_grid);

    _fetch();
  };

  window._atkynInit_images();
}());
        
