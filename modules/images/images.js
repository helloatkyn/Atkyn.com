/* modules/images/images.js — Images tab
   v5: Bing-exact layout · HD Picsum idle state · GSAP camera animation
*/
(function () {

  let _seen      = new Set();
  let _cols      = [null, null];
  let _colH      = [0, 0];
  let _grid      = null;
  let _lazyIo    = null;
  let _scrollIo  = null;
  let _sentinel  = null;
  let _loading   = false;
  let _wikiDone  = false;
  let _q         = '';

  let _queue      = [];
  let _batchTimer = null;

  /* ── Picsum HD categories — id-based, 800px wide ── */
  const CATS = [
    { label: 'Nature',       id: 15  },
    { label: 'Architecture', id: 164 },
    { label: 'Animals',      id: 237 },
    { label: 'Travel',       id: 338 },
    { label: 'Technology',   id: 180 },
    { label: 'People',       id: 453 },
    { label: 'Food',         id: 292 },
    { label: 'Abstract',     id: 103 },
    { label: 'Cars',         id: 111 },
    { label: 'Fashion',      id: 325 },
    { label: 'Space',        id: 29  },
    { label: 'Mountains',    id: 377 },
    { label: 'Ocean',        id: 314 },
    { label: 'City',         id: 230 },
    { label: 'Forest',       id: 399 },
    { label: 'Sport',        id: 152 },
  ];

  /* ── Camera SVG (GSAP animated) ── */
  const CAMERA_SVG = `
    <svg id="img-cam-svg" viewBox="0 0 120 90" fill="none" xmlns="http://www.w3.org/2000/svg" width="120" height="90">
      <!-- body -->
      <rect id="cam-body" x="8" y="28" width="104" height="54" rx="10" fill="#0072B1" opacity="0"/>
      <!-- viewfinder bump -->
      <rect id="cam-bump" x="38" y="18" width="44" height="16" rx="6" fill="#0072B1" opacity="0"/>
      <!-- lens outer -->
      <circle id="cam-lens-o" cx="60" cy="56" r="20" fill="#fff" opacity="0"/>
      <!-- lens mid -->
      <circle id="cam-lens-m" cx="60" cy="56" r="14" fill="#0072B1" opacity="0"/>
      <!-- lens inner -->
      <circle id="cam-lens-i" cx="60" cy="56" r="8" fill="#fff" opacity="0"/>
      <!-- shutter dot -->
      <circle id="cam-shutter" cx="60" cy="56" r="3" fill="#0072B1" opacity="0"/>
      <!-- flash -->
      <rect id="cam-flash" x="16" y="36" width="14" height="9" rx="3" fill="#FFD60A" opacity="0"/>
    </svg>`;

  /* ── Empty state — Bing style with GSAP camera ── */
  function _showEmptyState(pc) {
    const chips = CATS.map(c => `
      <a class="img-es-cat" href="/?q=${encodeURIComponent(c.label)}&tab=images">
        <div class="img-es-cat-wrap">
          <img
            class="img-es-cat-img"
            src="https://picsum.photos/id/${c.id}/320/240"
            alt="${c.label}"
            loading="lazy"
            decoding="async"
          >
          <span class="img-es-cat-label">${c.label}</span>
        </div>
      </a>`).join('');

    pc.innerHTML = `
      <div class="img-es-root" id="img-es-root">
        <div class="img-es-hero">
          <div class="img-es-cam">${CAMERA_SVG}</div>
          <p class="img-es-sub">Search for any image</p>
        </div>
        <div class="img-es-section">
          <span class="img-es-section-title">Explore topics</span>
        </div>
        <div class="img-es-cats">${chips}</div>
      </div>`;

    _animateCamera();
  }

  function _animateCamera() {
    function run() {
      if (!window.gsap) { setTimeout(run, 80); return; }
      const gsap = window.gsap;
      const root = document.getElementById('img-es-root');
      if (!root) return;

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.fromTo('#cam-body',    { opacity: 0, scaleY: 0, transformOrigin: 'bottom center' },
                                { opacity: 1, scaleY: 1, duration: 0.35 })
        .fromTo('#cam-bump',    { opacity: 0, scaleY: 0, transformOrigin: 'bottom center' },
                                { opacity: 1, scaleY: 1, duration: 0.25 }, '-=0.1')
        .fromTo('#cam-flash',   { opacity: 0 }, { opacity: 1, duration: 0.2 }, '-=0.05')
        .fromTo('#cam-lens-o',  { opacity: 0, scale: 0, transformOrigin: 'center' },
                                { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(2)' }, '-=0.05')
        .fromTo('#cam-lens-m',  { opacity: 0, scale: 0, transformOrigin: 'center' },
                                { opacity: 1, scale: 1, duration: 0.25, ease: 'back.out(2)' }, '-=0.15')
        .fromTo('#cam-lens-i',  { opacity: 0, scale: 0, transformOrigin: 'center' },
                                { opacity: 1, scale: 1, duration: 0.2, ease: 'back.out(2)' }, '-=0.1')
        .fromTo('#cam-shutter', { opacity: 0, scale: 0, transformOrigin: 'center' },
                                { opacity: 1, scale: 1, duration: 0.18 }, '-=0.05');

      /* shutter blink loop */
      gsap.delayedCall(tl.duration() + 0.3, () => {
        gsap.to('#cam-shutter', {
          scale: 1.6, opacity: 0.3,
          yoyo: true, repeat: -1,
          duration: 1.1, ease: 'sine.inOut',
          transformOrigin: 'center'
        });
        /* subtle camera bob */
        gsap.to('#img-cam-svg', {
          y: -4, duration: 1.8,
          ease: 'sine.inOut', yoyo: true, repeat: -1
        });
      });

      /* section + chips stagger */
      const section = root.querySelector('.img-es-section');
      const cats    = root.querySelectorAll('.img-es-cat');
      gsap.fromTo(section,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.3, delay: tl.duration() + 0.1 }
      );
      gsap.fromTo(cats,
        { opacity: 0, y: 16, scale: 0.94 },
        { opacity: 1, y: 0, scale: 1, duration: 0.32, ease: 'power2.out',
          delay: tl.duration() + 0.18, stagger: 0.035 }
      );
    }

    if (!window.gsap) {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/gsap@3.15/dist/gsap.min.js';
      s.onload = run;
      document.head.appendChild(s);
    } else {
      run();
    }
  }

  // ── Column helpers ────────────────────────────────────────────
  function _shortCol() { return _colH[0] <= _colH[1] ? 0 : 1; }

  // ── Tile builder ──────────────────────────────────────────────
  function _buildTile(img) {
    const src   = img.img_src       || img.thumbnail_src || '';
    const thumb = img.thumbnail_src || img.img_src       || '';
    if (!src) return null;

    const a       = document.createElement('a');
    a.className   = 'img-tile';
    a.href        = img.url || src;
    a.target      = '_blank';
    a.rel         = 'noopener noreferrer';

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

  // ── Favicon ───────────────────────────────────────────────────
  function _faviconEl(url) {
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* skip */ }

    const img         = document.createElement('img');
    img.width         = 16;
    img.height        = 16;
    img.alt           = '';
    img.style.cssText = 'border-radius:3px;flex-shrink:0;object-fit:contain;';

    const services = [
      `https://www.google.com/s2/favicons?sz=64&domain=${host}`,
      `https://icons.duckduckgo.com/ip3/${host}.ico`,
      `https://favicon.im/${host}`,
    ];
    let idx = 0;

    function tryNext() {
      if (idx >= services.length) {
        const letter = (host[0] || '?').toUpperCase();
        const colors = ['#007AFF','#34C759','#FF9500','#FF3B30','#AF52DE','#5856D6'];
        const bg     = colors[letter.charCodeAt(0) % colors.length];
        img.src      = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect width='16' height='16' rx='3' fill='${encodeURIComponent(bg)}'/><text x='8' y='12' font-family='system-ui' font-size='10' font-weight='600' fill='white' text-anchor='middle'>${letter}</text></svg>`;
        img.onerror  = null;
        return;
      }
      img.src = services[idx++];
    }

    img.onerror = tryNext;
    tryNext();
    return img;
  }

  // ── Related searches card ─────────────────────────────────────
  function _buildSuggestionCard(suggestions) {
    if (!suggestions?.length) return null;
    const card        = document.createElement('div');
    card.className    = 'img-suggestion-card';
    const label       = document.createElement('p');
    label.className   = 'img-card-label';
    label.textContent = 'Related searches';
    card.appendChild(label);
    const list      = document.createElement('div');
    list.className  = 'img-suggestion-list';
    suggestions.slice(0, 6).forEach(s => {
      const q        = s.query || s;
      const chip     = document.createElement('a');
      chip.className = 'img-suggestion-chip';
      chip.href      = `/?q=${encodeURIComponent(q)}`;
      chip.textContent = q;
      list.appendChild(chip);
    });
    card.appendChild(list);
    return card;
  }

  // ── Top sources card ──────────────────────────────────────────
  function _buildSourceCard(results) {
    if (!results?.length) return null;
    const card        = document.createElement('div');
    card.className    = 'img-source-card';
    const label       = document.createElement('p');
    label.className   = 'img-card-label';
    label.textContent = 'Top sources';
    card.appendChild(label);
    const seen  = new Set();
    const items = results.filter(r => {
      if (!r.url) return false;
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, '');
        if (seen.has(host)) return false;
        seen.add(host);
        return true;
      } catch { return false; }
    }).slice(0, 4);
    items.forEach(r => {
      const row     = document.createElement('a');
      row.className = 'img-source-row';
      row.href      = r.url;
      row.target    = '_blank';
      row.rel       = 'noopener noreferrer';
      const info    = document.createElement('div');
      info.className = 'img-source-info';
      const t       = document.createElement('span');
      t.className   = 'img-source-title';
      t.textContent = r.title || '';
      const u       = document.createElement('span');
      u.className   = 'img-source-url';
      try { u.textContent = new URL(r.url).hostname.replace(/^www\./, ''); }
      catch { u.textContent = r.url; }
      info.appendChild(t);
      info.appendChild(u);
      row.appendChild(_faviconEl(r.url));
      row.appendChild(info);
      card.appendChild(row);
    });
    return card;
  }

  // ── Place filler cards ────────────────────────────────────────
  function _placeFiller(suggestions, sourceResults) {
    const c     = _shortCol();
    const other = 1 - c;
    if (_colH[other] - _colH[c] < 1.5) return;
    const sc = _buildSuggestionCard(suggestions);
    if (sc) { _cols[c].appendChild(sc); _colH[c] += 2; }
    if (_colH[c] < _colH[other] - 1) {
      const src = _buildSourceCard(sourceResults);
      if (src) { _cols[c].appendChild(src); _colH[c] += 2; }
    }
  }

  // ── Sentinel ──────────────────────────────────────────────────
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

  // ── Drip renderer ────────────────────────────────────────────
  function _drip() {
    if (!_queue.length) { _batchTimer = null; return; }
    const batch = _queue.splice(0, 4);
    batch.forEach(img => {
      const tile = _buildTile(img);
      if (!tile) return;
      const c    = _shortCol();
      _cols[c].appendChild(tile);
      const aspect = (img.width && img.height) ? img.height / img.width : 0.75;
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

  // ── Fetch #1 — Serper ─────────────────────────────────────────
  function _fetchSerper() {
    if (_loading) return;
    _loading = true;
    fetch(`/api/images?q=${encodeURIComponent(_q)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        _loading = false;
        const results       = data.results       || [];
        const suggestions   = data.suggestions   || [];
        const sourceResults = data.sourceResults || [];
        if (!results.length) {
          document.getElementById('pageContent').innerHTML =
            '<div class="tab-empty"><p>No images found</p></div>';
          return;
        }
        _appendResults(results);
        const delay = Math.ceil(results.length / 4) * 80 + 300;
        setTimeout(() => {
          _placeFiller(suggestions, sourceResults);
          _attachSentinel();
        }, delay);
      })
      .catch(() => { _loading = false; });
  }

  // ── Fetch #2 — Wikipedia Commons ─────────────────────────────
  function _fetchWiki() {
    const LIMIT = 50, PAGES = 4;
    const BASE  = {
      action: 'query', format: 'json', origin: '*',
      generator: 'search', gsrnamespace: '6', gsrsearch: _q,
      gsrlimit: String(LIMIT), prop: 'imageinfo|info',
      iiprop: 'url|dimensions|mime', iiurlwidth: '800', redirects: '1',
    };
    const calls = Array.from({ length: PAGES }, (_, i) => {
      const p = new URLSearchParams({ ...BASE, gsroffset: String(i * LIMIT) });
      return fetch(`https://commons.wikimedia.org/w/api.php?${p}`)
        .then(r => r.ok ? r.json() : {}).catch(() => ({}));
    });
    Promise.all(calls).then(responses => {
      const allPages = responses.flatMap(d => Object.values(d?.query?.pages || {}));
      const results  = allPages
        .filter(p => {
          const ii = p.imageinfo?.[0];
          if (!ii) return false;
          const m  = ii.mime || '';
          return m.startsWith('image/jpeg') || m.startsWith('image/png') ||
                 m.startsWith('image/webp') || m.startsWith('image/gif');
        })
        .map(p => {
          const ii = p.imageinfo[0];
          const t  = ii.thumburl || ii.url || '';
          const f  = ii.url      || t;
          return {
            title: (p.title || '').replace(/^File:/, ''),
            url: p.fullurl || ii.descriptionurl || f,
            img_src: f, thumbnail_src: t,
            width:  ii.thumbwidth  || ii.width  || 0,
            height: ii.thumbheight || ii.height || 0,
            source: 'wikipedia',
          };
        })
        .filter(img => img.width >= 100 && img.height >= 100);
      if (results.length) _appendResults(results);
    });
  }

  // ── Lazy loader ───────────────────────────────────────────────
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
    _seen = new Set(); _cols = [null, null]; _colH = [0, 0];
    _grid = null; _loading = false; _wikiDone = false; _queue = [];
    if (_batchTimer) { clearTimeout(_batchTimer); _batchTimer = null; }
    if (_scrollIo)   { _scrollIo.disconnect();    _scrollIo   = null; }
    if (_sentinel)   { _sentinel.remove();         _sentinel   = null; }

    _q = sessionStorage.getItem('atkyn_last_query') || '';
    const pc = document.getElementById('pageContent');

    if (!_q) { _showEmptyState(pc); return; }

    pc.innerHTML = `
      <div class="tab-skeleton grid">
        <div class="sk-col">
          <div class="sk-img"></div><div class="sk-img sk-img--sm"></div><div class="sk-img"></div>
        </div>
        <div class="sk-col">
          <div class="sk-img sk-img--sm"></div><div class="sk-img"></div><div class="sk-img sk-img--sm"></div>
        </div>
      </div>`;

    _initLazyIo();
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
    _fetchSerper();
  };

  window._atkynInit_images();
}());
                        
