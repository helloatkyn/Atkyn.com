/* modules/images/images.js — Images tab
   v6: Pixabay-style empty state · horizontal scroll cats · masonry gallery · full-res Unsplash
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

  /* ── Categories with emoji + Unsplash full-res (800px, unique IDs) ── */
  const CATS = [
    { label: 'Nature',       emoji: '🌿', unsplashId: 'photo-1470770903676-69b98201ea1c' },
    { label: 'Architecture', emoji: '🏛️', unsplashId: 'photo-1486325212027-8081e485255e' },
    { label: 'Animals',      emoji: '🐾', unsplashId: 'photo-1474511320723-9a56873867b5' },
    { label: 'Travel',       emoji: '✈️', unsplashId: 'photo-1488646953014-85cb44e25828' },
    { label: 'Technology',   emoji: '💻', unsplashId: 'photo-1518770660439-4636190af475' },
    { label: 'People',       emoji: '👥', unsplashId: 'photo-1529156069898-49953e39b3ac' },
    { label: 'Food',         emoji: '🍜', unsplashId: 'photo-1504674900247-0877df9cc836' },
    { label: 'Abstract',     emoji: '🎨', unsplashId: 'photo-1541701494587-cb58502866ab' },
    { label: 'Cars',         emoji: '🚗', unsplashId: 'photo-1494976388531-d1058494cdd8' },
    { label: 'Fashion',      emoji: '👗', unsplashId: 'photo-1469334031218-e382a71b716b' },
    { label: 'Space',        emoji: '🚀', unsplashId: 'photo-1462331940025-496dfbfc7564' },
    { label: 'Mountains',    emoji: '⛰️', unsplashId: 'photo-1464822759023-fed622ff2c3b' },
    { label: 'Ocean',        emoji: '🌊', unsplashId: 'photo-1505118380757-91f5f5632de0' },
    { label: 'City',         emoji: '🌆', unsplashId: 'photo-1477959858617-67f85cf4f1df' },
    { label: 'Forest',       emoji: '🌲', unsplashId: 'photo-1448375240586-882707db888b' },
    { label: 'Sport',        emoji: '⚽', unsplashId: 'photo-1461896836934-ffe607ba8211' },
    { label: 'Music',        emoji: '🎵', unsplashId: 'photo-1511671782779-c97d3d27a1d4' },
    { label: 'Flowers',      emoji: '🌸', unsplashId: 'photo-1490750967868-88df5691cc42' },
  ];

  /* ── Masonry gallery items — varied aspect ratios for real masonry feel ── */
  const GALLERY = [
    { unsplashId: 'photo-1506905925346-21bda4d32df4', label: 'Swiss Alps',       w: 1200, h: 800  },
    { unsplashId: 'photo-1518020382113-a7e8fc38eac9', label: 'Golden Retriever',  w: 800,  h: 1067 },
    { unsplashId: 'photo-1501854140801-50d01698950b', label: 'Aerial Forest',     w: 1200, h: 675  },
    { unsplashId: 'photo-1534528741775-53994a69daeb', label: 'Portrait',          w: 800,  h: 1200 },
    { unsplashId: 'photo-1558618666-fcd25c85cd64', label: 'Abstract Colors',     w: 1200, h: 900  },
    { unsplashId: 'photo-1494976388531-d1058494cdd8', label: 'Classic Car',       w: 1200, h: 800  },
    { unsplashId: 'photo-1540189549336-e6e99c3679fe', label: 'Food Bowl',         w: 800,  h: 1000 },
    { unsplashId: 'photo-1477959858617-67f85cf4f1df', label: 'City Lights',       w: 1200, h: 750  },
    { unsplashId: 'photo-1505118380757-91f5f5632de0', label: 'Ocean Wave',        w: 1200, h: 800  },
    { unsplashId: 'photo-1462331940025-496dfbfc7564', label: 'Galaxy',            w: 1200, h: 900  },
    { unsplashId: 'photo-1511671782779-c97d3d27a1d4', label: 'Music Studio',      w: 1200, h: 800  },
    { unsplashId: 'photo-1490750967868-88df5691cc42', label: 'Cherry Blossoms',   w: 800,  h: 1067 },
    { unsplashId: 'photo-1441974231531-c6227db76b6e', label: 'Forest Path',       w: 1200, h: 800  },
    { unsplashId: 'photo-1488646953014-85cb44e25828', label: 'Travel Map',        w: 800,  h: 1067 },
    { unsplashId: 'photo-1518770660439-4636190af475', label: 'Circuit Board',     w: 1200, h: 800  },
    { unsplashId: 'photo-1464822759023-fed622ff2c3b', label: 'Mountain Peak',     w: 1200, h: 800  },
    { unsplashId: 'photo-1486325212027-8081e485255e', label: 'Modern Building',   w: 800,  h: 1200 },
    { unsplashId: 'photo-1469334031218-e382a71b716b', label: 'Fashion Walk',      w: 800,  h: 1067 },
    { unsplashId: 'photo-1461896836934-ffe607ba8211', label: 'Stadium',           w: 1200, h: 750  },
    { unsplashId: 'photo-1529156069898-49953e39b3ac', label: 'Friends',           w: 1200, h: 800  },
  ];

  /* ── Unsplash full-res URL (800px wide, no crop, actual image) ── */
  function _unsplashUrl(id, w) {
    return `https://images.unsplash.com/${id}?auto=format&fit=max&w=${w || 800}&q=85`;
  }

  /* ── Empty state — Pixabay / Studio style ── */
  function _showEmptyState(pc) {

    /* Category chips — horizontal scroll */
    const chips = CATS.map(c => `
      <a class="img-es-cat-chip" href="/?q=${encodeURIComponent(c.label)}&tab=images">
        <span class="img-es-cat-emoji">${c.emoji}</span>
        <span class="img-es-cat-name">${c.label}</span>
      </a>`).join('');

    /* Masonry gallery items */
    const galItems = GALLERY.map(g => {
      const aspectStyle = `aspect-ratio:${g.w}/${g.h}`;
      const src = _unsplashUrl(g.unsplashId, 600);
      return `
        <a class="img-es-gitem" href="/?q=${encodeURIComponent(g.label)}&tab=images">
          <img
            class="img-es-gimg"
            src="${src}"
            alt="${g.label}"
            loading="lazy"
            decoding="async"
            style="${aspectStyle}"
          >
          <span class="img-es-gitem-label">${g.label}</span>
        </a>`;
    }).join('');

    pc.innerHTML = `
      <div class="img-es-root" id="img-es-root">

        <!-- Glass hero -->
        <div class="img-es-hero">
          <div class="img-es-hero-bg"></div>
          <div class="img-es-hero-glass">
            <svg class="img-es-hero-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="7" width="20" height="14" rx="3" fill="white" opacity="0.95"/>
              <path d="M8 7V5.5C8 4.12 9.12 3 10.5 3h3C14.88 3 16 4.12 16 5.5V7" stroke="white" stroke-width="1.6" stroke-linecap="round"/>
              <circle cx="12" cy="14" r="3.2" fill="#0077B5"/>
              <circle cx="12" cy="14" r="1.4" fill="white"/>
            </svg>
          </div>
          <h2 class="img-es-hero-title">Discover Images</h2>
          <p class="img-es-hero-sub">Search millions of high-quality photos</p>
        </div>

        <!-- CTA button -->
        <div class="img-es-cta-wrap">
          <a class="img-es-cta" href="#" onclick="document.querySelector('.search-input, #searchInput, input[type=search]')?.focus(); return false;">
            <svg class="img-es-cta-icon" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="white" stroke-width="2"/>
              <path d="M16.5 16.5L21 21" stroke="white" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Search Images
          </a>
        </div>

        <!-- Categories -->
        <div class="img-es-section">
          <span class="img-es-section-title">Browse Categories</span>
        </div>
        <div class="img-es-cats-wrap">
          <div class="img-es-cats-row">${chips}</div>
        </div>

        <!-- Masonry gallery -->
        <div class="img-es-gallery-section">
          <span class="img-es-gallery-title">Popular Photos</span>
        </div>
        <div class="img-es-gallery">${galItems}</div>

      </div>`;
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
        /* Load full-res directly — no blur thumbnail swap */
        const fullSrc = el.dataset.src;
        if (fullSrc) el.src = fullSrc;
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
     
