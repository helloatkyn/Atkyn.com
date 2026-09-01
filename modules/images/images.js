/* modules/images/images.js — v7
   Pinterest-style masonry · professional empty state · /api/images only
*/
(function () {

  /* ─── State ──────────────────────────────────────────────────── */
  let _seen      = new Set();
  let _cols      = [null, null];
  let _colH      = [0, 0];
  let _grid      = null;
  let _lazyIo    = null;
  let _scrollIo  = null;
  let _sentinel  = null;
  let _loading   = false;
  let _q         = '';
  let _queue     = [];
  let _batchTimer= null;
  let _imgCache  = {};  /* url → { blob, objectUrl } */

  /* ─── Category chips data ────────────────────────────────────── */
  const CATS = [
    { name: 'Nature',       emoji: '🌿' },
    { name: 'Architecture', emoji: '🏛️' },
    { name: 'Animals',      emoji: '🐾' },
    { name: 'Travel',       emoji: '✈️' },
    { name: 'Technology',   emoji: '💻' },
    { name: 'People',       emoji: '👥' },
    { name: 'Food',         emoji: '🍜' },
    { name: 'Art',          emoji: '🎨' },
    { name: 'Cars',         emoji: '🚗' },
    { name: 'Fashion',      emoji: '👗' },
    { name: 'Space',        emoji: '🚀' },
    { name: 'Mountains',    emoji: '⛰️' },
    { name: 'Ocean',        emoji: '🌊' },
    { name: 'City',         emoji: '🌆' },
    { name: 'Forest',       emoji: '🌲' },
    { name: 'Sport',        emoji: '⚽' },
    { name: 'Music',        emoji: '🎵' },
    { name: 'Flowers',      emoji: '🌸' },
    { name: 'Interior',     emoji: '🛋️' },
    { name: 'Fitness',      emoji: '💪' },
  ];

  /* ─── Suggested query cards (4-up grid with Unsplash fills) ─── */
  const QCARDS = [
    { label: 'Aesthetic wallpapers',  img: 'photo-1558618666-fcd25c85cd64' },
    { label: 'Minimalist design',     img: 'photo-1505118380757-91f5f5632de0' },
    { label: 'Street photography',    img: 'photo-1477959858617-67f85cf4f1df' },
    { label: 'Portrait art',          img: 'photo-1534528741775-53994a69daeb' },
    { label: 'Abstract textures',     img: 'photo-1541701494587-cb58502866ab' },
    { label: 'Golden hour',           img: 'photo-1506905925346-21bda4d32df4' },
  ];

  /* ─── Masonry gallery items (varied ratios) ──────────────────── */
  const GALLERY = [
    { id: 'photo-1501854140801-50d01698950b', label: 'Aerial forest',     w:1200, h:675  },
    { id: 'photo-1518020382113-a7e8fc38eac9', label: 'Golden retriever',  w:800,  h:1067 },
    { id: 'photo-1462331940025-496dfbfc7564', label: 'Galaxy',            w:1200, h:900  },
    { id: 'photo-1534528741775-53994a69daeb', label: 'Portrait',          w:800,  h:1200 },
    { id: 'photo-1494976388531-d1058494cdd8', label: 'Classic car',       w:1200, h:800  },
    { id: 'photo-1540189549336-e6e99c3679fe', label: 'Acai bowl',         w:800,  h:1000 },
    { id: 'photo-1486325212027-8081e485255e', label: 'Modern building',   w:800,  h:1200 },
    { id: 'photo-1511671782779-c97d3d27a1d4', label: 'Music studio',      w:1200, h:800  },
    { id: 'photo-1490750967868-88df5691cc42', label: 'Cherry blossoms',   w:800,  h:1067 },
    { id: 'photo-1461896836934-ffe607ba8211', label: 'Stadium',           w:1200, h:750  },
    { id: 'photo-1518770660439-4636190af475', label: 'Circuit board',     w:1200, h:800  },
    { id: 'photo-1469334031218-e382a71b716b', label: 'Fashion',           w:800,  h:1067 },
    { id: 'photo-1488646953014-85cb44e25828', label: 'Travel',            w:800,  h:1000 },
    { id: 'photo-1441974231531-c6227db76b6e', label: 'Forest path',       w:1200, h:800  },
    { id: 'photo-1529156069898-49953e39b3ac', label: 'Friends',           w:1200, h:800  },
    { id: 'photo-1464822759023-fed622ff2c3b', label: 'Mountain peak',     w:1200, h:800  },
  ];

  function _uImg(id, w) {
    return `https://images.unsplash.com/${id}?auto=format&fit=max&w=${w||600}&q=80`;
  }

  /* ─── Image caching via blob URL ──────────────────────────────── */
  function _fetchAndCache(src, imgEl) {
    if (_imgCache[src]) {
      imgEl.src = _imgCache[src];
      return;
    }
    fetch(src)
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        _imgCache[src] = url;
        imgEl.src = url;
      })
      .catch(() => { imgEl.src = src; }); /* fallback: direct load */
  }

  /* ─── Dot menu SVG ────────────────────────────────────────────── */
  function _dotsSvg() {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="3.5" r="1.4" fill="#888"/>
      <circle cx="8" cy="8"   r="1.4" fill="#888"/>
      <circle cx="8" cy="12.5" r="1.4" fill="#888"/>
    </svg>`;
  }

  /* ─── Tile builder (Pinterest card style) ────────────────────── */
  function _buildTile(img) {
    const src   = img.img_src || img.thumbnail_src || '';
    const thumb = img.thumbnail_src || img.img_src || '';
    if (!src) return null;

    const wrap       = document.createElement('div');
    wrap.className   = 'img-tile';

    const a          = document.createElement('a');
    a.href           = img.url || src;
    a.target         = '_blank';
    a.rel            = 'noopener noreferrer';
    a.style.cssText  = 'display:block;text-decoration:none;';

    const imgEl      = document.createElement('img');
    imgEl.alt        = img.title || '';
    imgEl.decoding   = 'async';
    imgEl.dataset.src = src;
    imgEl.dataset.thumb = thumb;
    imgEl.classList.add('img-lazy');

    imgEl.onload = function () {
      requestAnimationFrame(() => this.classList.add('loaded'));
    };
    imgEl.onerror = function () {
      if (this.dataset.tried !== '1' && thumb && thumb !== this.src) {
        this.dataset.tried = '1';
        this.src = thumb; return;
      }
      wrap.style.display = 'none';
      setTimeout(() => wrap.remove(), 200);
    };

    a.appendChild(imgEl);
    wrap.appendChild(a);

    /* Footer: title + 3-dot menu */
    const footer   = document.createElement('div');
    footer.className = 'img-tile-footer';

    const title    = document.createElement('span');
    title.className = 'img-tile-title';
    const rawTitle = (img.title || '').replace(/\s*[-|·•]\s*.*$/, '').trim();
    title.textContent = rawTitle || 'Image';

    const dots     = document.createElement('button');
    dots.className = 'img-tile-dots';
    dots.setAttribute('aria-label', 'More options');
    dots.innerHTML = _dotsSvg();
    dots.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      _showDotMenu(wrap, img);
    });

    footer.appendChild(title);
    footer.appendChild(dots);
    wrap.appendChild(footer);
    return wrap;
  }

  /* ─── Dot menu popup ─────────────────────────────────────────── */
  function _showDotMenu(tile, img) {
    document.querySelectorAll('.img-dot-popup').forEach(p => p.remove());
    const menu = document.createElement('div');
    menu.className = 'img-dot-popup';
    menu.style.cssText = `
      position:fixed;bottom:90px;left:50%;transform:translateX(-50%);
      background:#fff;border-radius:18px;
      box-shadow:0 8px 40px rgba(0,0,0,0.18);
      padding:8px 0;z-index:9999;min-width:220px;
      font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;
    `;
    const actions = [
      { icon: '↓', label: 'Download image' },
      { icon: '🔗', label: 'Copy link'     },
      { icon: '⤴', label: 'Share'          },
      { icon: '⊕', label: 'Save to board'  },
    ];
    actions.forEach(a => {
      const row = document.createElement('button');
      row.style.cssText = `
        display:flex;align-items:center;gap:12px;
        width:100%;padding:13px 18px;
        background:none;border:none;cursor:pointer;
        font-size:15px;color:#1a1a1a;font-weight:500;
        font-family:inherit;
      `;
      row.innerHTML = `<span style="font-size:18px;width:24px;text-align:center">${a.icon}</span>${a.label}`;
      row.addEventListener('click', () => menu.remove());
      menu.appendChild(row);
    });
    /* divider + cancel */
    const div = document.createElement('div');
    div.style.cssText = 'height:0.5px;background:#f0f0f0;margin:4px 0;';
    menu.appendChild(div);
    const cancel = document.createElement('button');
    cancel.style.cssText = `
      display:block;width:100%;padding:13px 18px;
      background:none;border:none;cursor:pointer;
      font-size:15px;color:#FF3B30;font-weight:600;text-align:left;
      font-family:inherit;
    `;
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => menu.remove());
    menu.appendChild(cancel);

    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 50);
  }

  /* ─── Column helpers ─────────────────────────────────────────── */
  function _shortCol() { return _colH[0] <= _colH[1] ? 0 : 1; }

  /* ─── Filler cards ───────────────────────────────────────────── */
  function _buildSuggCard(sugg) {
    if (!sugg?.length) return null;
    const card = document.createElement('div');
    card.className = 'img-suggestion-card';
    const lbl = document.createElement('p');
    lbl.className = 'img-card-label';
    lbl.textContent = 'Related searches';
    card.appendChild(lbl);
    const list = document.createElement('div');
    list.className = 'img-suggestion-list';
    sugg.slice(0, 6).forEach(s => {
      const q    = s.query || s;
      const chip = document.createElement('a');
      chip.className = 'img-suggestion-chip';
      chip.href = `/?q=${encodeURIComponent(q)}&tab=images`;
      chip.textContent = q;
      list.appendChild(chip);
    });
    card.appendChild(list);
    return card;
  }

  function _buildSrcCard(results) {
    if (!results?.length) return null;
    const card = document.createElement('div');
    card.className = 'img-source-card';
    const lbl = document.createElement('p');
    lbl.className = 'img-card-label';
    lbl.textContent = 'Top sources';
    card.appendChild(lbl);
    const seen = new Set();
    results.filter(r => {
      if (!r.url) return false;
      try { const h = new URL(r.url).hostname.replace(/^www\./,''); if(seen.has(h)) return false; seen.add(h); return true; } catch { return false; }
    }).slice(0, 4).forEach(r => {
      const row = document.createElement('a');
      row.className = 'img-source-row';
      row.href = r.url;
      row.target = '_blank';
      row.rel = 'noopener noreferrer';
      const ico = document.createElement('img');
      ico.width = 16; ico.height = 16;
      ico.style.cssText = 'border-radius:3px;flex-shrink:0;object-fit:contain;';
      try { ico.src = `https://www.google.com/s2/favicons?sz=32&domain=${new URL(r.url).hostname}`; } catch {}
      const info = document.createElement('div');
      info.className = 'img-source-info';
      const t = document.createElement('span'); t.className = 'img-source-title'; t.textContent = r.title||'';
      const u = document.createElement('span'); u.className = 'img-source-url';
      try { u.textContent = new URL(r.url).hostname.replace(/^www\./, ''); } catch { u.textContent = r.url; }
      info.appendChild(t); info.appendChild(u);
      row.appendChild(ico); row.appendChild(info);
      card.appendChild(row);
    });
    return card;
  }

  function _placeFiller(sugg, srcRes) {
    const c = _shortCol(), o = 1 - c;
    if (_colH[o] - _colH[c] < 1.5) return;
    const sc = _buildSuggCard(sugg);
    if (sc) { _cols[c].appendChild(sc); _colH[c] += 2; }
    if (_colH[c] < _colH[o] - 1) {
      const src = _buildSrcCard(srcRes);
      if (src) { _cols[c].appendChild(src); _colH[c] += 2; }
    }
  }

  /* ─── Sentinel for infinite scroll ──────────────────────────── */
  function _attachSentinel() {
    if (_sentinel) _sentinel.remove();
    _sentinel = document.createElement('div');
    _sentinel.className = 'img-sentinel';
    _cols[_shortCol()].appendChild(_sentinel);
    if (_scrollIo) _scrollIo.disconnect();
    _scrollIo = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      _scrollIo.disconnect();
      _fetchMore();
    }, { rootMargin: '600px' });
    _scrollIo.observe(_sentinel);
  }

  let _page = 1;
  function _fetchMore() {
    if (_loading) return;
    _loading = true;
    fetch(`/api/images?q=${encodeURIComponent(_q)}&page=${++_page}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        _loading = false;
        const results = data.results || [];
        if (results.length) {
          _appendResults(results);
          setTimeout(_attachSentinel, Math.ceil(results.length / 4) * 80 + 300);
        }
      })
      .catch(() => { _loading = false; });
  }

  /* ─── Drip renderer (batches 4 tiles every 80ms) ─────────────── */
  function _drip() {
    if (!_queue.length) { _batchTimer = null; return; }
    const batch = _queue.splice(0, 4);
    batch.forEach(img => {
      const tile = _buildTile(img);
      if (!tile) return;
      const c = _shortCol();
      _cols[c].appendChild(tile);
      const aspect = (img.width && img.height) ? img.height / img.width : 0.8;
      _colH[c] += aspect + 0.18; /* +0.18 for footer */
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
      _seen.add(key); return true;
    });
    if (!fresh.length) return;
    _queue.push(...fresh);
    if (!_batchTimer) _drip();
  }

  /* ─── Lazy loader with blob cache ────────────────────────────── */
  function _initLazyIo() {
    if (_lazyIo) _lazyIo.disconnect();
    _lazyIo = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        obs.unobserve(entry.target);
        const el  = entry.target;
        const src = el.dataset.src;
        if (!src) return;
        if (_imgCache[src]) { el.src = _imgCache[src]; return; }
        /* Fetch → cache blob → set src */
        fetch(src)
          .then(r => r.ok ? r.blob() : Promise.reject())
          .then(blob => {
            const url = URL.createObjectURL(blob);
            _imgCache[src] = url;
            el.src = url;
          })
          .catch(() => { el.src = src; });
      });
    }, { rootMargin: '1400px' });
  }

  /* ─── Fetch from /api/images ──────────────────────────────────── */
  function _fetchSerper() {
    _loading = true;
    _page = 1;
    fetch(`/api/images?q=${encodeURIComponent(_q)}&page=1`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        _loading = false;
        const results     = data.results       || [];
        const suggestions = data.suggestions   || [];
        const sourceRes   = data.sourceResults || [];

        /* Remove skeleton */
        const pc = document.getElementById('pageContent');
        pc.innerHTML = '';
        pc.appendChild(_grid);

        if (!results.length) {
          pc.innerHTML = `
            <div style="text-align:center;padding:60px 20px;font-family:-apple-system,sans-serif;">
              <div style="font-size:48px;margin-bottom:12px;">🔍</div>
              <p style="font-size:17px;font-weight:600;color:#111;margin:0 0 6px;">No images found</p>
              <p style="font-size:14px;color:#888;margin:0;">Try a different search term</p>
            </div>`;
          return;
        }
        _appendResults(results);
        const delay = Math.ceil(results.length / 4) * 80 + 300;
        setTimeout(() => {
          _placeFiller(suggestions, sourceRes);
          _attachSentinel();
        }, delay);
      })
      .catch(() => {
        _loading = false;
        const pc = document.getElementById('pageContent');
        pc.innerHTML = `<div style="text-align:center;padding:60px 20px;"><p style="color:#888;font-size:14px;">Couldn't load images. Try again.</p></div>`;
      });
  }

  /* ─── Empty state ─────────────────────────────────────────────── */
  function _showEmptyState(pc) {

    /* Category chips HTML */
    const chips = CATS.map(c => `
      <button class="img-es-chip" onclick="_atkynSearch(${JSON.stringify(c.name)})">
        <span class="img-es-chip-emoji">${c.emoji}</span>
        <span class="img-es-chip-name">${c.name}</span>
      </button>`).join('');

    /* Suggested query cards (2×3 grid) */
    const qcards = QCARDS.map(q => `
      <a class="img-es-qcard" href="/?q=${encodeURIComponent(q.label)}&tab=images">
        <img class="img-es-qcard-img" src="${_uImg(q.id, 400)}" alt="${q.label}" loading="lazy" decoding="async">
        <div class="img-es-qcard-overlay"></div>
        <span class="img-es-qcard-label">${q.label}</span>
      </a>`).join('');

    /* Masonry gallery */
    const galItems = GALLERY.map(g => `
      <a class="img-es-mitem" href="/?q=${encodeURIComponent(g.label)}&tab=images">
        <img class="img-es-mimg" src="${_uImg(g.id, 500)}" alt="${g.label}"
          loading="lazy" decoding="async" style="aspect-ratio:${g.w}/${g.h}">
        <div class="img-es-mlabel">${g.label}</div>
      </a>`).join('');

    pc.innerHTML = `
      <div class="img-es" id="img-es-root">

        <!-- Sticky search bar -->
        <div class="img-es-topbar">
          <div class="img-es-searchbox">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="8" cy="8" r="5.5" stroke="#1a1a1a" stroke-width="1.6"/>
              <path d="M12.5 12.5L16 16" stroke="#1a1a1a" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <input
              type="text"
              placeholder="Search images…"
              id="img-es-input"
              autocomplete="off"
              autocorrect="off"
              spellcheck="false"
              onkeydown="if(event.key==='Enter'&&this.value.trim())_atkynSearch(this.value.trim())"
            >
          </div>
        </div>

        <!-- Categories -->
        <div class="img-es-sec">
          <span class="img-es-sec-title">Browse categories</span>
        </div>
        <div class="img-es-cats">
          <div class="img-es-cats-row">${chips}</div>
        </div>

        <!-- Suggested searches grid -->
        <div class="img-es-sec" style="padding-top:22px;">
          <span class="img-es-sec-title">Trending ideas</span>
        </div>
        <div class="img-es-qgrid">${qcards}</div>

        <!-- Popular masonry gallery -->
        <div class="img-es-sec" style="padding-top:22px;">
          <span class="img-es-sec-title">Popular photos</span>
        </div>
        <div class="img-es-masonry">${galItems}</div>

      </div>`;

    /* Auto-focus search after paint */
    requestAnimationFrame(() => {
      const inp = document.getElementById('img-es-input');
      if (inp) setTimeout(() => inp.focus(), 120);
    });
  }

  /* Global helper: trigger a search from category/suggestion click */
  window._atkynSearch = function (query) {
    if (!query) return;
    sessionStorage.setItem('atkyn_last_query', query);
    /* Try native search bar first */
    const bar = document.querySelector('.search-input, #searchInput, input[type="search"]');
    if (bar) {
      bar.value = query;
      bar.dispatchEvent(new Event('input', { bubbles: true }));
      bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    /* Fallback: reload via URL */
    else { window.location.href = `/?q=${encodeURIComponent(query)}&tab=images`; }
  };

  /* ─── Init ────────────────────────────────────────────────────── */
  window._atkynInit_images = function () {
    /* Reset state */
    _seen = new Set(); _cols = [null, null]; _colH = [0, 0];
    _grid = null; _loading = false; _queue = []; _page = 1;
    if (_batchTimer) { clearTimeout(_batchTimer); _batchTimer = null; }
    if (_scrollIo)   { _scrollIo.disconnect(); _scrollIo = null; }
    if (_sentinel)   { _sentinel.remove(); _sentinel =
