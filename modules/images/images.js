/* modules/images/images.js — Pinterest-style masonry grid */
(function () {

  let _seen      = new Set();
  let _cols      = [null, null, null];
  let _colH      = [0, 0, 0];
  let _grid      = null;
  let _lazyIo    = null;
  let _scrollIo  = null;
  let _sentinel  = null;
  let _wikiDone  = false;
  let _q         = '';
  let _queue     = [];
  let _batchTimer = null;

  // ── Column helpers ────────────────────────────────────────────
  function _shortCol() {
    return _colH.indexOf(Math.min(..._colH));
  }

  // ── Short title: max 3 words, no ellipsis suffix ──────────────
  function _shortTitle(raw) {
    if (!raw) return '';
    const words = raw.trim().split(/\s+/);
    return words.slice(0, 3).join(' ');
  }

  // ── Tile builder (Pinterest style) ───────────────────────────
  function _buildTile(img) {
    const src   = img.img_src       || img.thumbnail_src || '';
    const thumb = img.thumbnail_src || img.img_src       || '';
    if (!src) return null;

    const wrap       = document.createElement('div');
    wrap.className   = 'img-tile';

    // Image link
    const a       = document.createElement('a');
    a.href        = img.url || src;
    a.target      = '_blank';
    a.rel         = 'noopener noreferrer';
    a.className   = 'img-tile__link';

    const imgEl         = document.createElement('img');
    imgEl.alt           = img.title || '';
    imgEl.decoding      = 'async';
    imgEl.dataset.src   = src;
    imgEl.dataset.thumb = thumb;
    imgEl.classList.add('img-lazy');

    imgEl.onload = function () {
      requestAnimationFrame(() => { this.style.opacity = '1'; });
    };
    imgEl.onerror = function () {
      if (this.dataset.triedThumb !== '1' && thumb && thumb !== this.src) {
        this.dataset.triedThumb = '1';
        this.src = thumb;
        return;
      }
      wrap.remove();
    };

    a.appendChild(imgEl);
    wrap.appendChild(a);

    // Bottom row: title + 3-dot menu
    const title = _shortTitle(img.title);
    if (title) {
      const footer       = document.createElement('div');
      footer.className   = 'img-tile__footer';

      const titleEl      = document.createElement('span');
      titleEl.className  = 'img-tile__title';
      titleEl.textContent = title;

      const menu         = document.createElement('button');
      menu.className     = 'img-tile__menu';
      menu.setAttribute('aria-label', 'More options');
      menu.innerHTML     = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="3" r="1.4" fill="currentColor"/>
        <circle cx="8" cy="8" r="1.4" fill="currentColor"/>
        <circle cx="8" cy="13" r="1.4" fill="currentColor"/>
      </svg>`;

      footer.appendChild(titleEl);
      footer.appendChild(menu);
      wrap.appendChild(footer);
    }

    return wrap;
  }

  // ── Drip renderer: 6 tiles every 80ms ────────────────────────
  function _drip() {
    if (!_queue.length) { _batchTimer = null; return; }

    const batch = _queue.splice(0, 6);
    batch.forEach(img => {
      const tile = _buildTile(img);
      if (!tile) return;
      const c    = _shortCol();
      _cols[c].appendChild(tile);
      const aspect = (img.width && img.height) ? img.height / img.width : 1.2;
      _colH[c] += aspect;
    });

    _grid.querySelectorAll('.img-lazy:not([data-ob])').forEach(el => {
      el.dataset.ob = '1';
      _lazyIo.observe(el);
    });

    _batchTimer = setTimeout(_drip, 80);
  }

  function _appendResults(results) {
    const fresh = results.filter(r => {
      const key = r.img_src;
      if (!key || _seen.has(key)) return false;
      _seen.add(key);
      return true;
    });
    if (!fresh.length) return;
    _queue.push(...fresh);
    if (!_batchTimer) _drip();
  }

  // ── Sentinel — triggers Wikipedia fetch on scroll ─────────────
  function _attachSentinel() {
    if (_sentinel) _sentinel.remove();
    _sentinel           = document.createElement('div');
    _sentinel.className = 'img-sentinel';
    _cols[_shortCol()].appendChild(_sentinel);

    if (_scrollIo) _scrollIo.disconnect();
    _scrollIo = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting || _wikiDone) return;
      _wikiDone = true;
      _scrollIo.disconnect();
      _fetchWiki();
    }, { rootMargin: '400px' });
    _scrollIo.observe(_sentinel);
  }

  // ── Fetch #1 — Serper ─────────────────────────────────────────
  function _fetchSerper() {
    fetch(`/api/images?q=${encodeURIComponent(_q)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        const results = data.results || [];
        if (!results.length) {
          document.getElementById('pageContent').innerHTML =
            '<div class="tab-empty"><p>No images found</p></div>';
          return;
        }
        _appendResults(results);
        const delay = Math.ceil(results.length / 6) * 80 + 300;
        setTimeout(_attachSentinel, delay);
      })
      .catch(() => {
        document.getElementById('pageContent').innerHTML =
          '<div class="tab-empty"><p>Could not load images</p></div>';
      });
  }

  // ── Fetch #2 — Wikipedia Commons (on scroll) ──────────────────
  function _fetchWiki() {
    const LIMIT = 50;
    const BASE  = {
      action: 'query', format: 'json', origin: '*',
      generator: 'search', gsrnamespace: '6', gsrsearch: _q,
      gsrlimit: String(LIMIT), prop: 'imageinfo|info',
      iiprop: 'url|dimensions|mime', iiurlwidth: '800', redirects: '1',
    };

    const calls = Array.from({ length: 4 }, (_, i) => {
      const p = new URLSearchParams({ ...BASE, gsroffset: String(i * LIMIT) });
      return fetch(`https://commons.wikimedia.org/w/api.php?${p}`)
        .then(r => r.ok ? r.json() : {})
        .catch(() => ({}));
    });

    Promise.all(calls).then(responses => {
      const allPages = responses.flatMap(d => Object.values(d?.query?.pages || {}));
      const results = allPages
        .filter(p => {
          const ii   = p.imageinfo?.[0];
          if (!ii) return false;
          const mime = ii.mime || '';
          return /^image\/(jpeg|png|webp|gif)/.test(mime);
        })
        .map(p => {
          const ii = p.imageinfo[0];
          return {
            title:         (p.title || '').replace(/^File:/, ''),
            url:           p.fullurl || ii.descriptionurl || ii.url || '',
            img_src:       ii.url || '',
            thumbnail_src: ii.thumburl || ii.url || '',
            width:         ii.thumbwidth  || ii.width  || 0,
            height:        ii.thumbheight || ii.height || 0,
          };
        })
        .filter(img => img.width >= 100 && img.height >= 100);

      if (results.length) _appendResults(results);
    });
  }

  // ── Lazy image loader ─────────────────────────────────────────
  function _initLazyIo() {
    if (_lazyIo) _lazyIo.disconnect();
    _lazyIo = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        obs.unobserve(el);

        const thumbSrc = el.dataset.thumb || el.dataset.src;
        const fullSrc  = el.dataset.src;
        if (thumbSrc) el.src = thumbSrc;

        if (fullSrc && fullSrc !== thumbSrc) {
          const full    = new Image();
          full.decoding = 'async';
          full.onload   = () => {
            if (!el.isConnected) return;
            el.style.opacity = '0';
            requestAnimationFrame(() => { el.src = fullSrc; });
          };
          full.src = fullSrc;
        }
      });
    }, { rootMargin: '1200px' });
  }

  // ── Init ──────────────────────────────────────────────────────
  window._atkynInit_images = function () {
    _seen      = new Set();
    _cols      = [null, null, null];
    _colH      = [0, 0, 0];
    _grid      = null;
    _wikiDone  = false;
    _queue     = [];
    if (_batchTimer) { clearTimeout(_batchTimer); _batchTimer = null; }
    if (_scrollIo)   { _scrollIo.disconnect();    _scrollIo   = null; }
    if (_sentinel)   { _sentinel.remove();         _sentinel   = null; }

    _q = sessionStorage.getItem('atkyn_last_query') || '';

    const pc = document.getElementById('pageContent');

    if (!_q) {
      pc.innerHTML = '<div class="tab-empty"><p>Search something to see images</p></div>';
      return;
    }

    pc.innerHTML = `
      <div class="tab-skeleton grid">
        ${[0,1,2].map(() => `
          <div class="sk-col">
            <div class="sk-img" style="aspect-ratio:3/4"></div>
            <div class="sk-img" style="aspect-ratio:4/3"></div>
            <div class="sk-img" style="aspect-ratio:1/1"></div>
          </div>`).join('')}
      </div>`;

    _initLazyIo();

    _grid = document.createElement('div');
    _grid.className = 'images-grid';
    for (let i = 0; i < 3; i++) {
      const col = document.createElement('div');
      col.className = 'img-col';
      _grid.appendChild(col);
      _cols[i] = col;
    }

    pc.innerHTML = '';
    pc.appendChild(_grid);

    _fetchSerper();
  };

  window._atkynInit_images();
}());
          
