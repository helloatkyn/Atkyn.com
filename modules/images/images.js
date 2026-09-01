/* modules/images/images.js — v8
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
  let _imgCache  = {};  /* url → objectUrl */

  /* ─── Lucide icon paths (inline SVG, no CDN needed) ─────────── */
  const ICONS = {
    search:    'M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0',
    moreVert:  'M12 5v.01M12 12v.01M12 19v.01',
    download:  'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    link:      'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    share:     'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
    bookmark:  'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
    x:         'M18 6L6 18M6 6l12 12',
    chevronRight: 'M9 18l6-6-6-6',
    image:     'M21 15l-5-5L5 21M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
    compass:   'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z',
    trending:  'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
    grid:      'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  };

  function _icon(name, size = 18, stroke = 'currentColor', strokeW = 1.6) {
    const d = ICONS[name] || '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
      stroke="${stroke}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round">
      <path d="${d}"/>
    </svg>`;
  }

  /* ─── Category chips data ────────────────────────────────────── */
  const CATS = [
    { name: 'Nature',       icon: 'compass'  },
    { name: 'Architecture', icon: 'grid'     },
    { name: 'Animals',      icon: 'image'    },
    { name: 'Travel',       icon: 'compass'  },
    { name: 'Technology',   icon: 'grid'     },
    { name: 'People',       icon: 'image'    },
    { name: 'Food',         icon: 'compass'  },
    { name: 'Art',          icon: 'image'    },
    { name: 'Cars',         icon: 'grid'     },
    { name: 'Fashion',      icon: 'trending' },
    { name: 'Space',        icon: 'compass'  },
    { name: 'Mountains',    icon: 'trending' },
    { name: 'Ocean',        icon: 'image'    },
    { name: 'City',         icon: 'grid'     },
    { name: 'Forest',       icon: 'compass'  },
    { name: 'Sport',        icon: 'trending' },
    { name: 'Music',        icon: 'image'    },
    { name: 'Flowers',      icon: 'image'    },
    { name: 'Interior',     icon: 'grid'     },
    { name: 'Fitness',      icon: 'trending' },
  ];

  /* ─── Suggested query cards (Unsplash fills) ─────────────────── */
  const QCARDS = [
    { label: 'Aesthetic wallpapers',  img: 'photo-1558618666-fcd25c85cd64' },
    { label: 'Minimalist design',     img: 'photo-1505118380757-91f5f5632de0' },
    { label: 'Street photography',    img: 'photo-1477959858617-67f85cf4f1df' },
    { label: 'Portrait art',          img: 'photo-1534528741775-53994a69daeb' },
    { label: 'Abstract textures',     img: 'photo-1541701494587-cb58502866ab' },
    { label: 'Golden hour',           img: 'photo-1506905925346-21bda4d32df4' },
  ];

  /* ─── Masonry gallery items ──────────────────────────────────── */
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
    return `https://images.unsplash.com/${id}?auto=format&fit=max&w=${w || 600}&q=80`;
  }

  /* ─── Dot menu SVG (3-dot vertical, lucide MoreVertical) ──────── */
  function _dotsSvg() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <circle cx="12" cy="5"  r="1" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>
    </svg>`;
  }

  /* ─── Tile builder ───────────────────────────────────────────── */
  function _buildTile(img) {
    const src   = img.img_src || img.thumbnail_src || '';
    const thumb = img.thumbnail_src || img.img_src || '';
    if (!src) return null;

    const wrap     = document.createElement('div');
    wrap.className = 'img-tile';

    const a        = document.createElement('a');
    a.href         = img.url || src;
    a.target       = '_blank';
    a.rel          = 'noopener noreferrer';
    a.style.cssText = 'display:block;text-decoration:none;';

    const imgEl        = document.createElement('img');
    imgEl.alt          = img.title || '';
    imgEl.decoding     = 'async';
    imgEl.dataset.src  = src;
    imgEl.dataset.thumb= thumb;
    imgEl.classList.add('img-lazy');

    imgEl.onload = function () {
      requestAnimationFrame(() => this.classList.add('loaded'));
    };
    imgEl.onerror = function () {
      if (this.dataset.tried !== '1' && thumb && thumb !== this.src) {
        this.dataset.tried = '1';
        this.src = thumb;
        return;
      }
      wrap.style.display = 'none';
      setTimeout(() => wrap.remove(), 200);
    };

    a.appendChild(imgEl);
    wrap.appendChild(a);

    const footer     = document.createElement('div');
    footer.className = 'img-tile-footer';

    const title      = document.createElement('span');
    title.className  = 'img-tile-title';
    const rawTitle   = (img.title || '').replace(/\s*[-|·•]\s*.*$/, '').trim();
    title.textContent = rawTitle || 'Image';

    const dots       = document.createElement('button');
    dots.className   = 'img-tile-dots';
    dots.setAttribute('aria-label', 'More options');
    dots.innerHTML   = _dotsSvg();
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

    const menu     = document.createElement('div');
    menu.className = 'img-dot-popup';
    menu.style.cssText = [
      'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);',
      'background:var(--img-popup-bg,#fff);border-radius:18px;',
      'box-shadow:0 8px 40px rgba(0,0,0,0.18);',
      'padding:8px 0;z-index:9999;min-width:220px;',
      'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;',
    ].join('');

    const actions = [
      { icon: 'download', label: 'Download image' },
      { icon: 'link',     label: 'Copy link'      },
      { icon: 'share',    label: 'Share'           },
      { icon: 'bookmark', label: 'Save to board'   },
    ];

    actions.forEach(a => {
      const row = document.createElement('button');
      row.style.cssText = [
        'display:flex;align-items:center;gap:12px;',
        'width:100%;padding:13px 18px;',
        'background:none;border:none;cursor:pointer;',
        'font-size:15px;color:var(--img-popup-text,#1a1a1a);font-weight:500;',
        'font-family:inherit;',
      ].join('');
      const iconWrap = document.createElement('span');
      iconWrap.style.cssText = 'width:24px;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
      iconWrap.innerHTML = _icon(a.icon, 18, 'var(--img-popup-text,#1a1a1a)', 1.8);
      const lbl = document.createElement('span');
      lbl.textContent = a.label;
      row.appendChild(iconWrap);
      row.appendChild(lbl);
      row.addEventListener('click', () => menu.remove());
      menu.appendChild(row);
    });

    const divider = document.createElement('div');
    divider.style.cssText = 'height:0.5px;background:#f0f0f0;margin:4px 0;';
    menu.appendChild(divider);

    const cancel = document.createElement('button');
    cancel.style.cssText = [
      'display:flex;align-items:center;gap:12px;',
      'width:100%;padding:13px 18px;',
      'background:none;border:none;cursor:pointer;',
      'font-size:15px;color:#FF3B30;font-weight:600;',
      'font-family:inherit;',
    ].join('');
    const xWrap = document.createElement('span');
    xWrap.style.cssText = 'width:24px;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    xWrap.innerHTML = _icon('x', 18, '#FF3B30', 2);
    const cancelLbl = document.createElement('span');
    cancelLbl.textContent = 'Cancel';
    cancel.appendChild(xWrap);
    cancel.appendChild(cancelLbl);
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
    const card   = document.createElement('div');
    card.className = 'img-suggestion-card';
    const lbl    = document.createElement('p');
    lbl.className = 'img-card-label';
    lbl.textContent = 'Related searches';
    card.appendChild(lbl);
    const list   = document.createElement('div');
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
    const card   = document.createElement('div');
    card.className = 'img-source-card';
    const lbl    = document.createElement('p');
    lbl.className = 'img-card-label';
    lbl.textContent = 'Top sources';
    card.appendChild(lbl);
    const seen   = new Set();
    results.filter(r => {
      if (!r.url) return false;
      try {
        const h = new URL(r.url).hostname.replace(/^www\./, '');
        if (seen.has(h)) return false;
        seen.add(h);
        return true;
      } catch { return false; }
    }).slice(0, 4).forEach(r => {
      const row    = document.createElement('a');
      row.className = 'img-source-row';
      row.href     = r.url;
      row.target   = '_blank';
      row.rel      = 'noopener noreferrer';
      const ico    = document.createElement('img');
      ico.width    = 16; ico.height = 16;
      ico.style.cssText = 'border-radius:3px;flex-shrink:0;object-fit:contain;';
      try { ico.src = `https://www.google.com/s2/favicons?sz=32&domain=${new URL(r.url).hostname}`; } catch {}
      const info   = document.createElement('div');
      info.className = 'img-source-info';
      const t      = document.createElement('span'); t.className = 'img-source-title'; t.textContent = r.title || '';
      const u      = document.createElement('span'); u.className = 'img-source-url';
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
      _colH[c] += aspect + 0.18;
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

  /* ─── Build the masonry grid container ───────────────────────── */
  function _buildGrid() {
    const g = document.createElement('div');
    g.className = 'images-grid';
    const c0 = document.createElement('div'); c0.className = 'img-col';
    const c1 = document.createElement('div'); c1.className = 'img-col';
    g.appendChild(c0);
    g.appendChild(c1);
    _grid    = g;
    _cols[0] = c0;
    _cols[1] = c1;
  }

  /* ─── Fetch from /api/images ──────────────────────────────────── */
  function _fetchSerper() {
    _loading = true;
    _page    = 1;
    fetch(`/api/images?q=${encodeURIComponent(_q)}&page=1`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        _loading = false;
        const results     = data.results       || [];
        const suggestions = data.suggestions   || [];
        const sourceRes   = data.sourceResults || [];

        const pc = document.getElementById('pageContent');
        if (!pc) return;
        pc.innerHTML = '';

        if (!results.length) {
          pc.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
              padding:80px 20px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;">
              <div style="width:56px;height:56px;border-radius:16px;background:#f3f3f3;
                display:flex;align-items:center;justify-content:center;margin-bottom:16px;">
                ${_icon('image', 28, '#aaa', 1.5)}
              </div>
              <p style="font-size:17px;font-weight:700;color:#111;margin:0 0 6px;text-align:center;">
                No images found
              </p>
              <p style="font-size:14px;color:#888;margin:0;text-align:center;">
                Try a different search term
              </p>
            </div>`;
          return;
        }

        pc.appendChild(_grid);
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
        if (!pc) return;
        pc.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;
            padding:80px 20px;font-family:-apple-system,sans-serif;">
            <p style="font-size:14px;color:#888;text-align:center;">
              Couldn't load images. Please try again.
            </p>
          </div>`;
      });
  }

  /* ─── Empty state ─────────────────────────────────────────────── */
  function _showEmptyState(pc) {

    /* Category chips */
    const chips = CATS.map(c => `
      <button class="img-es-chip" data-q="${c.name}">
        <span class="img-es-chip-icon">${_icon(c.icon, 15, 'currentColor', 1.8)}</span>
        <span class="img-es-chip-name">${c.name}</span>
      </button>`).join('');

    /* Suggested query cards */
    const qcards = QCARDS.map(q => `
      <a class="img-es-qcard" href="/?q=${encodeURIComponent(q.label)}&tab=images"
        data-q="${q.label}">
        <img class="img-es-qcard-img"
          src="${_uImg(q.img, 400)}"
          alt="${q.label}" loading="lazy" decoding="async">
        <div class="img-es-qcard-overlay"></div>
        <span class="img-es-qcard-label">${q.label}</span>
      </a>`).join('');

    /* Masonry gallery */
    const galItems = GALLERY.map(g => `
      <a class="img-es-mitem" href="/?q=${encodeURIComponent(g.label)}&tab=images"
        data-q="${g.label}">
        <img class="img-es-mimg"
          src="${_uImg(g.id, 500)}" alt="${g.label}"
          loading="lazy" decoding="async"
          style="aspect-ratio:${g.w}/${g.h}">
        <div class="img-es-mlabel">${g.label}</div>
      </a>`).join('');

    pc.innerHTML = `
      <div class="img-es" id="img-es-root">

        <!-- Sticky search bar -->
        <div class="img-es-topbar">
          <div class="img-es-searchbox">
            <span class="img-es-search-icon">
              ${_icon('search', 18, 'currentColor', 1.6)}
            </span>
            <input
              type="text"
              placeholder="Search images"
              id="img-es-input"
              autocomplete="off"
              autocorrect="off"
              spellcheck="false"
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

        <!-- Trending -->
        <div class="img-es-sec" style="padding-top:22px;">
          <span class="img-es-sec-title">Trending ideas</span>
        </div>
        <div class="img-es-qgrid">${qcards}</div>

        <!-- Popular -->
        <div class="img-es-sec" style="padding-top:22px;">
          <span class="img-es-sec-title">Popular photos</span>
        </div>
        <div class="img-es-masonry">${galItems}</div>

      </div>`;

    /* Bind chip clicks (no inline onclick) */
    pc.querySelectorAll('[data-q]').forEach(el => {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        window._atkynSearch(this.dataset.q);
      });
    });

    /* Bind search input */
    const inp = document.getElementById('img-es-input');
    if (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && this.value.trim()) {
          window._atkynSearch(this.value.trim());
        }
      });
      requestAnimationFrame(() => setTimeout(() => inp.focus(), 120));
    }
  }

  /* ─── Global search trigger ──────────────────────────────────── */
  window._atkynSearch = function (query) {
    if (!query) return;
    try { sessionStorage.setItem('atkyn_last_query', query); } catch (_) {}

    /* Try native search bar */
    const bar = document.querySelector('#cbInput, .search-input, #searchInput, input[type="search"]');
    if (bar) {
      bar.value = query;
      bar.dispatchEvent(new Event('input', { bubbles: true }));
      bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    } else {
      window.location.href = `/?q=${encodeURIComponent(query)}&tab=images`;
    }
  };

  /* ─── Init ────────────────────────────────────────────────────── */
  window._atkynInit_images = function () {
    /* ── Reset all state ── */
    _seen      = new Set();
    _cols      = [null, null];
    _colH      = [0, 0];
    _grid      = null;
    _loading   = false;
    _queue     = [];
    _page      = 1;

    if (_batchTimer) { clearTimeout(_batchTimer); _batchTimer = null; }
    if (_scrollIo)   { _scrollIo.disconnect();   _scrollIo  = null; }
    if (_lazyIo)     { _lazyIo.disconnect();      _lazyIo    = null; }
    if (_sentinel)   { _sentinel.remove();         _sentinel  = null; }

    /* ── Get current query ── */
    try { _q = sessionStorage.getItem('atkyn_last_query') || ''; } catch (_) { _q = ''; }

    const pc = document.getElementById('pageContent');
    if (!pc) return;

    /* ── Init lazy loader ── */
    _initLazyIo();

    if (!_q.trim()) {
      /* No query → show empty state */
      _showEmptyState(pc);
    } else {
      /* Has query → show skeleton + fetch */
      pc.innerHTML = `
        <div class="tab-skeleton grid">
          <div class="sk-col">
            <div class="sk-img sk-img--t"></div>
            <div class="sk-img sk-img--m"></div>
            <div class="sk-img sk-img--s"></div>
          </div>
          <div class="sk-col">
            <div class="sk-img sk-img--m"></div>
            <div class="sk-img sk-img--t"></div>
            <div class="sk-img sk-img--s"></div>
          </div>
        </div>`;
      _buildGrid();
      _fetchSerper();
    }
  };

})();
