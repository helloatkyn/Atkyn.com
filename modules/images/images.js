/* modules/images.js — Images tab */
(function () {

  let _seen      = new Set();
  let _cols      = [null, null];
  let _colH      = [0, 0];
  let _grid      = null;
  let _lazyIo    = null;
  let _loading   = false;
  let _exhausted = false;
  let _q         = '';

  // ── Batch renderer: 4 images at a time (2 rows of 2) ──────────────────────
  let _queue     = [];
  let _batchTimer = null;

  function _shortCol() {
    return _colH[0] <= _colH[1] ? 0 : 1;
  }

  function _buildTile(img) {
    const src   = img.img_src       || img.thumbnail_src || '';
    const thumb = img.thumbnail_src || img.img_src       || '';
    if (!src) return null;

    const a = document.createElement('a');
    a.className = 'img-tile';
    a.href      = img.url || src;
    a.target    = '_blank';
    a.rel       = 'noopener noreferrer';

    const imgEl       = document.createElement('img');
    imgEl.alt         = img.title || '';
    imgEl.decoding    = 'async';
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

  // Favicon URL helper
  function _favicon(url) {
    try {
      const host = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?sz=32&domain=${host}`;
    } catch { return ''; }
  }

  // Suggestion card — fills white gap in shorter column
  function _buildSuggestionCard(suggestions) {
    if (!suggestions || !suggestions.length) return null;

    const card = document.createElement('div');
    card.className = 'img-suggestion-card';

    const title = document.createElement('p');
    title.className = 'img-suggestion-title';
    title.textContent = 'Related searches';
    card.appendChild(title);

    suggestions.slice(0, 6).forEach(s => {
      const chip = document.createElement('a');
      chip.className = 'img-suggestion-chip';
      chip.href      = `/?q=${encodeURIComponent(s.query || s)}`;
      chip.textContent = s.query || s;
      card.appendChild(chip);
    });

    return card;
  }

  // Source card — favicon + title + url, Bing style
  function _buildSourceCard(results) {
    if (!results || !results.length) return null;

    const card = document.createElement('div');
    card.className = 'img-source-card';

    const title = document.createElement('p');
    title.className = 'img-suggestion-title';
    title.textContent = 'Top sources';
    card.appendChild(title);

    // Unique domains only, max 4
    const seen = new Set();
    const items = results.filter(r => {
      if (!r.url) return false;
      try {
        const host = new URL(r.url).hostname.replace('www.', '');
        if (seen.has(host)) return false;
        seen.add(host);
        return true;
      } catch { return false; }
    }).slice(0, 4);

    items.forEach(r => {
      const row = document.createElement('a');
      row.className = 'img-source-row';
      row.href      = r.url;
      row.target    = '_blank';
      row.rel       = 'noopener noreferrer';

      const fav = document.createElement('img');
      fav.src     = _favicon(r.url);
      fav.width   = 16;
      fav.height  = 16;
      fav.alt     = '';
      fav.style.cssText = 'border-radius:3px;flex-shrink:0;';

      const info = document.createElement('div');
      info.style.cssText = 'min-width:0;';

      const t = document.createElement('span');
      t.className   = 'img-source-title';
      t.textContent = r.title || '';

      const u = document.createElement('span');
      u.className   = 'img-source-url';
      try { u.textContent = new URL(r.url).hostname.replace('www.', ''); } catch { u.textContent = r.url; }

      info.appendChild(t);
      info.appendChild(u);
      row.appendChild(fav);
      row.appendChild(info);
      card.appendChild(row);
    });

    return card;
  }

  function _placeFiller(suggestions, sourceResults) {
    // Find shorter column after all images placed
    const c = _shortCol();
    const other = 1 - c;
    const diff = _colH[other] - _colH[c];
    // Only add filler if gap is significant (>1.5 image heights worth)
    if (diff < 1.5) return;

    // Related searches card
    const sc = _buildSuggestionCard(suggestions);
    if (sc) { _cols[c].appendChild(sc); _colH[c] += 2; }

    // Source card if still short
    if (_colH[c] < _colH[other] - 1) {
      const src = _buildSourceCard(sourceResults);
      if (src) { _cols[c].appendChild(src); _colH[c] += 2; }
    }
  }

  // Drip-render queue — 4 images every 80ms for smooth progressive load
  function _drip() {
    if (!_queue.length) {
      _batchTimer = null;
      return;
    }
    const batch = _queue.splice(0, 4);
    batch.forEach(img => {
      const tile = _buildTile(img);
      if (!tile) return;
      const c = _shortCol();
      _cols[c].appendChild(tile);
      const aspect = (img.width && img.height) ? img.height / img.width : 0.75;
      _colH[c] += aspect;
    });

    // Observe new images
    _grid.querySelectorAll('.img-lazy:not([data-ob])').forEach(el => {
      el.dataset.ob = '1';
      _lazyIo.observe(el);
    });

    _batchTimer = setTimeout(_drip, 80);
  }

  function _appendResults(results, suggestions) {
    const fresh = results.filter(r => {
      const key = r.img_src;
      if (!key || _seen.has(key)) return false;
      _seen.add(key);
      return true;
    });
    if (!fresh.length) return;

    _queue = fresh;
    _drip();

    // Place filler cards after last batch settles
    const delay = Math.ceil(fresh.length / 4) * 80 + 200;
    setTimeout(() => _placeFiller(suggestions, results), delay);
  }

  function _fetch() {
    if (_loading || _exhausted) return;
    _loading = true;

    fetch(`/api/images?q=${encodeURIComponent(_q)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        _exhausted = true;
        _loading   = false;
        const results     = data.results     || [];
        const suggestions = data.suggestions || [];
        if (!results.length) {
          document.getElementById('pageContent').innerHTML =
            '<div class="tab-empty"><p>No images found</p></div>';
          return;
        }
        _appendResults(results, suggestions);
      })
      .catch(() => { _exhausted = true; _loading = false; });
  }

  window._atkynInit_images = function () {
    _seen       = new Set();
    _cols       = [null, null];
    _colH       = [0, 0];
    _grid       = null;
    _loading    = false;
    _exhausted  = false;
    _queue      = [];
    if (_batchTimer) { clearTimeout(_batchTimer); _batchTimer = null; }
    _q          = sessionStorage.getItem('atkyn_last_query') || '';

    if (_lazyIo) { _lazyIo.disconnect(); _lazyIo = null; }

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
