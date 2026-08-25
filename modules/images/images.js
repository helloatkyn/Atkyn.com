/* modules/images/images.js — Images tab
   [PRODUCTION READY: Parallel Loading · Aggressive Caching · 60FPS Scroll]
   v4: Google-speed loading · Bing-smooth scroll · Instant Wikipedia
*/
(function () {

  let _seen         = new Set();
  let _cols          = [null, null];
  let _colH          = [0, 0];
  let _grid          = null;
  let _lazyIo        = null;
  let _prefetchIo    = null;
  let _loading       = false;
  let _wikiLoading   = false;
  let _q             = '';
  let _renderQueue   = [];
  let _isRendering   = false;
  let _totalImages   = 0;

  // ─ Column helpers ────────────────────────────────────────────
  function _shortCol() { return _colH[0] <= _colH[1] ? 0 : 1; }

  // ── Cache helpers ─────────────────────────────────────────────
  function _getCacheKey() { return `img_cache_${_q}`; }
  
  function _getCached() {
    try {
      const cached = sessionStorage.getItem(_getCacheKey());
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < 300000) { // 5 min cache
          return data.results;
        }
      }
    } catch (_) {}
    return null;
  }
  
  function _setCache(results) {
    try {
      sessionStorage.setItem(_getCacheKey(), JSON.stringify({
        timestamp: Date.now(),
        results: results
      }));
    } catch (_) {}
  }

  // ── Tile builder (optimized) ──────────────────────────────────
  function _buildTile(img, priority = false) {
    const src   = img.img_src       || img.thumbnail_src || '';
    const thumb = img.thumbnail_src || img.img_src       || '';
    if (!src) return null;

    const a       = document.createElement('a');
    a.className   = 'img-tile';
    a.href        = img.url || src;
    a.target      = '_blank';
    a.rel         = 'noopener noreferrer';
    a.style.cssText = 'will-change:transform;transform:translateZ(0);';

    const imgEl         = document.createElement('img');
    imgEl.alt           = img.title || '';
    imgEl.decoding      = priority ? 'sync' : 'async';
    imgEl.fetchPriority = priority ? 'high' : 'low';
    imgEl.dataset.src   = src;
    imgEl.dataset.thumb = thumb;
    imgEl.classList.add('img-lazy');
    imgEl.style.cssText =
      'opacity:0;transition:opacity 0.15s ease-out;display:block;' +
      'width:100%;height:auto;border-radius:10px;will-change:opacity,transform;' +
      'content-visibility:auto;contain-intrinsic-size:300px 400px;';

    imgEl.onload = function () {
      requestAnimationFrame(() => { 
        this.style.opacity = '1';
        this.style.transform = 'translateZ(0)';
      });
    };
    
    imgEl.onerror = function () {
      if (this.dataset.triedThumb !== '1' && thumb && thumb !== this.src) {
        this.dataset.triedThumb = '1';
        this.src = thumb;
        return;
      }
      const tile = this.closest('.img-tile');
      if (tile) { 
        tile.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        tile.style.opacity = '0';
        tile.style.transform = 'scale(0.95)';
        setTimeout(() => tile.remove(), 200);
      }
    };

    a.appendChild(imgEl);
    return a;
  }

  // ── Favicon (unchanged) ───────────────────────────────────────
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

  // ── Related searches & Source cards (unchanged) ──────────────
  function _buildSuggestionCard(suggestions) {
    if (!suggestions?.length) return null;

    const card        = document.createElement('div');
    card.className    = 'img-suggestion-card';
    card.style.cssText = 'will-change:transform;transform:translateZ(0);';

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

  function _buildSourceCard(results) {
    if (!results?.length) return null;

    const card        = document.createElement('div');
    card.className    = 'img-source-card';
    card.style.cssText = 'will-change:transform;transform:translateZ(0);';

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

      const info        = document.createElement('div');
      info.className    = 'img-source-info';

      const t           = document.createElement('span');
      t.className       = 'img-source-title';
      t.textContent     = r.title || '';

      const u           = document.createElement('span');
      u.className       = 'img-source-url';
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

  // ── Smart placer (balanced columns) ───────────────────────────
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

  // ── FAST BATCH RENDERER (12 tiles per frame) ──────────────────
  function _renderBatch() {
    if (!_renderQueue.length || _isRendering) {
      _isRendering = false;
      return;
    }

    _isRendering = true;
    const batchSize = 12; // Google-level batch size
    const batch = _renderQueue.splice(0, batchSize);
    
    const fragment = document.createDocumentFragment();
    batch.forEach((img, idx) => {
      const tile = _buildTile(img, idx < 4); // First 4 = high priority
      if (tile) {
        const c = _shortCol();
        fragment.appendChild(tile);
        _cols[c].appendChild(tile);
        const aspect = (img.width && img.height) ? img.height / img.width : 0.75;
        _colH[c] += aspect;
      }
    });

    // Observe new lazy images
    _grid.querySelectorAll('.img-lazy:not([data-ob])').forEach(el => {
      el.dataset.ob = '1';
      _lazyIo.observe(el);
    });

    // Schedule next batch using requestIdleCallback for smoothness
    if (_renderQueue.length > 0) {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => _renderBatch(), { timeout: 100 });
      } else {
        setTimeout(() => { _isRendering = false; _renderBatch(); }, 16);
      }
    } else {
      _isRendering = false;
    }
  }

  function _appendResults(results, isWiki = false) {
    const fresh = results.filter(r => {
      const key = r.img_src;
      if (!key || _seen.has(key)) return false;
      _seen.add(key);
      return true;
    });
    
    if (!fresh.length) return;
    
    // Wikipedia results go to end of queue, Serper results to front
    if (isWiki) {
      _renderQueue.push(...fresh);
    } else {
      _renderQueue.unshift(...fresh);
    }
    
    if (!_isRendering) _renderBatch();
  }

  // ── PARALLEL FETCH: Serper + Wikipedia simultaneously ─────────
  function _fetchAll() {
    if (_loading) return;
    _loading = true;

    // Check cache first
    const cached = _getCached();
    if (cached) {
      _appendResults(cached);
      _loading = false;
      _fetchWiki(); // Still fetch Wikipedia for more results
      return;
    }

    // Fetch Serper
    fetch(`/api/images?q=${encodeURIComponent(_q)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        const results       = data.results       || [];
        const suggestions   = data.suggestions   || [];
        const sourceResults = data.sourceResults || [];

        if (!results.length) {
          document.getElementById('pageContent').innerHTML =
            '<div class="tab-empty"><p>No images found</p></div>';
          _loading = false;
          return;
        }

        // Cache results
        _setCache(results);
        _totalImages = results.length;
        
        // Render immediately
        _appendResults(results);
        
        // Place filler cards after initial render
        setTimeout(() => {
          _placeFiller(suggestions, sourceResults);
        }, 200);
        
        _loading = false;
      })
      .catch(() => { _loading = false; });

    // Wikipedia fetch starts IMMEDIATELY (parallel, not sequential)
    _fetchWiki();
  }

  // ── Wikipedia: Parallel 4-page fetch with timeout ─────────────
  function _fetchWiki() {
    if (_wikiLoading) return;
    _wikiLoading = true;

    const LIMIT   = 50;
    const PAGES   = 4;
    const BASE    = {
      action:       'query',
      format:       'json',
      origin:       '*',
      generator:    'search',
      gsrnamespace: '6',
      gsrsearch:    _q,
      gsrlimit:     String(LIMIT),
      prop:         'imageinfo|info',
      iiprop:       'url|dimensions|mime',
      iiurlwidth:   '800',
      redirects:    '1',
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

    const calls = Array.from({ length: PAGES }, (_, i) => {
      const p = new URLSearchParams({ ...BASE, gsroffset: String(i * LIMIT) });
      return fetch(`https://commons.wikimedia.org/w/api.php?${p}`, {
        signal: controller.signal
      })
        .then(r => r.ok ? r.json() : {})
        .catch(() => ({}));
    });

    Promise.all(calls)
      .then(responses => {
        clearTimeout(timeoutId);
        const allPages = responses.flatMap(data =>
          Object.values(data?.query?.pages || {})
        );

        const results = allPages
          .filter(p => {
            const ii   = p.imageinfo?.[0];
            if (!ii) return false;
            const mime = ii.mime || '';
            return mime.startsWith('image/jpeg') ||
                   mime.startsWith('image/png')  ||
                   mime.startsWith('image/webp') ||
                   mime.startsWith('image/gif');
          })
          .map(p => {
            const ii       = p.imageinfo[0];
            const thumbUrl = ii.thumburl || ii.url || '';
            const fullUrl  = ii.url      || thumbUrl;
            return {
              title:         (p.title || '').replace(/^File:/, ''),
              url:           p.fullurl || ii.descriptionurl || fullUrl,
              img_src:       fullUrl,
              thumbnail_src: thumbUrl,
              width:         ii.thumbwidth  || ii.width  || 0,
              height:        ii.thumbheight || ii.height || 0,
              source:        'wikipedia',
            };
          })
          .filter(img => img.width >= 100 && img.height >= 100);

        if (results.length) {
          _appendResults(results, true);
        }
      })
      .catch(() => {})
      .finally(() => {
        _wikiLoading = false;
      });
  }

  // ── AGGRESSIVE Lazy loader (2000px threshold) ─────────────────
  function _initLazyIo() {
    if (_lazyIo) _lazyIo.disconnect();
    _lazyIo = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        obs.unobserve(el);

        const thumbSrc = el.dataset.thumb || el.dataset.src;
        const fullSrc  = el.dataset.src;

        if (thumbSrc) {
          el.src = thumbSrc;
        }

        if (fullSrc && fullSrc !== thumbSrc) {
          const full    = new Image();
          full.decoding = 'async';
          full.onload   = () => {
            if (!el.isConnected) return;
            el.style.transition = 'opacity 0.12s ease-out';
            el.style.opacity = '0';
            requestAnimationFrame(() => { 
              el.src = fullSrc;
              requestAnimationFrame(() => {
                el.style.opacity = '1';
              });
            });
          };
          full.src = fullSrc;
        }
      });
    }, { rootMargin: '2000px' }); // Aggressive prefetch
  }

  // ── Prefetch observer (preload next images) ──────────────────
  function _initPrefetchIo() {
    if (_prefetchIo) _prefetchIo.disconnect();
    _prefetchIo = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target.querySelector('img');
          if (img && !img.dataset.prefetched) {
            img.dataset.prefetched = '1';
            // Prefetch full resolution
            const fullSrc = img.dataset.src;
            if (fullSrc) {
              const link = document.createElement('link');
              link.rel = 'prefetch';
              link.href = fullSrc;
              document.head.appendChild(link);
            }
          }
        }
      });
    }, { rootMargin: '800px' });
  }

  // ── Init ──────────────────────────────────────────────────────
  window._atkynInit_images = function () {
    _seen         = new Set();
    _cols         = [null, null];
    _colH         = [0, 0];
    _grid         = null;
    _loading      = false;
    _wikiLoading  = false;
    _renderQueue  = [];
    _isRendering  = false;
    _totalImages  = 0;

    _q = sessionStorage.getItem('atkyn_last_query') || '';

    const pc = document.getElementById('pageContent');

    if (!_q) {
      pc.innerHTML = '<div class="tab-empty"><p>Search something to see images</p></div>';
      return;
    }

    pc.innerHTML = `
      <div class="tab-skeleton grid">
        <div class="sk-col">
          <div class="sk-img"></div>
          <div class="sk-img sk-img--sm"></div>
          <div class="sk-img"></div>
        </div>
        <div class="sk-col">
          <div class="sk-img sk-img--sm"></div>
          <div class="sk-img"></div>
          <div class="sk-img sk-img--sm"></div>
        </div>
      </div>`;

    _initLazyIo();
    _initPrefetchIo();

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

    _fetchAll();
  };

  window._atkynInit_images();
}());
