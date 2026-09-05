/* ═══════════════════════════════════════════════════════════════════
   images.js — Atkyn Images module
   Registers window._atkynInit_images() — called by core.js on tab switch
════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const PAGE_SIZE = 20;

  let _allResults = [];
  let _page       = 0;
  let _lastQuery  = '';
  let _lightbox   = null;

  /* ════════════════════════════════
     INIT — core.js calls this on every Images tab activation
  ════════════════════════════════ */
  window._atkynInit_images = function () {
    /* Always grab latest query from sessionStorage */
    let q = '';
    try { q = sessionStorage.getItem('atkyn_last_query') || ''; } catch (_) {}

    const pc = window._atkynPageContent;
    if (!pc) return;

    /* Same query, already rendered — just re-mount (tab switch back) */
    if (q && q === _lastQuery && _allResults.length) {
      _mountGrid(pc);
      return;
    }

    if (!q) {
      pc.innerHTML = '<div class="img-empty"><p>Search something to see images.</p></div>';
      return;
    }

    /* New query — fetch */
    _lastQuery  = q;
    _allResults = [];
    _page       = 0;

    _showSkeleton(pc);
    _fetchAndRender(q, pc);
  };

  /* ════════════════════════════════
     FETCH
  ════════════════════════════════ */
  async function _fetchAndRender(q, pc) {
    try {
      const base = (window.ATKYN_API_BASE || '').replace(/\/$/, '');
      const res  = await fetch(`${base}/api/images?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('API ' + res.status);
      const data = await res.json();
      _allResults = (data.results || []).filter(r => r.img_src || r.thumbnail_src);
    } catch (err) {
      console.error('[Atkyn Images]', err);
      _allResults = [];
    }

    if (!_allResults.length) {
      pc.innerHTML = `<div class="img-empty">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <p>No images found for <strong>${_esc(q)}</strong></p>
      </div>`;
      return;
    }

    _page = 0;
    _mountGrid(pc);
  }

  /* ════════════════════════════════
     LAYOUT LOGIC
     Landscape (w > h, ar < 0.85) → full width single
     Square + Portrait (ar >= 0.85) → 2-col paired row
     Orphan at end → full width
  ════════════════════════════════ */
  function _isLandscape(item) {
    if (!item.width || !item.height) return false; /* unknown → pair */
    return (item.height / item.width) < 0.85;     /* clearly wider than tall */
  }

  /* ════════════════════════════════
     GRID MOUNT
  ════════════════════════════════ */
  function _mountGrid(pc) {
    pc.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.id = 'images-tab';

    const grid = _makeGrid();
    wrap.appendChild(grid);
    _renderPage(grid);

    if (_allResults.length > PAGE_SIZE) {
      wrap.appendChild(_loadMoreBtn(grid));
    }

    pc.appendChild(wrap);
  }

  function _makeGrid() {
    const g = document.createElement('div');
    g.className = 'img-grid';
    return g;
  }

  function _renderPage(grid) {
    const start = _page * PAGE_SIZE;
    const slice = _allResults.slice(start, start + PAGE_SIZE);
    let i = 0;

    while (i < slice.length) {
      const item    = slice[i];
      const globalI = start + i;

      if (_isLandscape(item)) {
        /* Landscape → full width */
        grid.appendChild(_makeCard(item, globalI, true));
        i++;
      } else {
        /* Square or portrait → try to pair */
        const next    = slice[i + 1];
        const nextGlI = globalI + 1;

        if (next && !_isLandscape(next)) {
          const row = document.createElement('div');
          row.className = 'img-row';
          row.appendChild(_makeCard(item, globalI, false));
          row.appendChild(_makeCard(next, nextGlI, false));
          grid.appendChild(row);
          i += 2;
        } else {
          /* Orphan — no partner, show full width */
          grid.appendChild(_makeCard(item, globalI, true));
          i++;
        }
      }
    }

    _page++;
  }

  /* ════════════════════════════════
     CARD
  ════════════════════════════════ */
  function _makeCard(item, index, isWide) {
    const card = document.createElement('div');
    card.className = 'img-card' + (isWide ? ' img-card--wide' : '');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    /* Ratio box — holds space, shimmer lives inside */
    const ratio = document.createElement('div');
    ratio.className = 'img-ratio';

    /* Compute padding from real dimensions */
    let pb;
    if (item.width && item.height) {
      pb = ((item.height / item.width) * 100).toFixed(2) + '%';
    } else {
      pb = isWide ? '56.25%' : '100%'; /* unknown square → 1:1 */
    }
    ratio.style.paddingBottom = pb;

    /* Shimmer — grey, disappears on load */
    const shimmer = document.createElement('div');
    shimmer.className = 'img-shimmer';

    const img = document.createElement('img');
    img.alt      = item.title || '';
    img.loading  = 'lazy';
    img.decoding = 'async';
    img.src      = item.thumbnail_src || item.img_src;

    img.addEventListener('load', () => {
      img.classList.add('loaded');
      shimmer.style.opacity = '0';
      shimmer.style.transition = 'opacity 0.2s';
      setTimeout(() => { shimmer.style.display = 'none'; }, 220);
    });

    img.addEventListener('error', () => {
      if (img.dataset.fallback !== '1' && item.img_src && img.src !== item.img_src) {
        img.dataset.fallback = '1';
        img.src = item.img_src;
      } else {
        card.style.display = 'none';
      }
    });

    /* Overlay */
    const overlay = document.createElement('div');
    overlay.className = 'img-overlay';
    if (item.title) {
      const t = document.createElement('span');
      t.className   = 'img-overlay-title';
      t.textContent = item.title;
      overlay.appendChild(t);
    }

    ratio.appendChild(shimmer);
    ratio.appendChild(img);
    ratio.appendChild(overlay);
    card.appendChild(ratio);

    const open = () => _openLightbox(index);
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });

    return card;
  }

  /* ════════════════════════════════
     SKELETON — grey shimmers matching real layout
  ════════════════════════════════ */
  function _showSkeleton(pc) {
    pc.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.id = 'images-tab';

    const grid = document.createElement('div');
    grid.className = 'img-grid';

    /* Pattern: wide, pair, pair, wide, pair */
    ['wide','pair','pair','wide','pair'].forEach((type, ri) => {
      if (type === 'wide') {
        const sk = document.createElement('div');
        sk.className = 'img-sk img-sk--wide';
        sk.style.animationDelay = (ri * 0.1) + 's';
        grid.appendChild(sk);
      } else {
        const row = document.createElement('div');
        row.className = 'img-row';
        [0,1].forEach(ci => {
          const sk = document.createElement('div');
          sk.className = 'img-sk img-sk--half';
          sk.style.animationDelay = (ri * 0.1 + ci * 0.15) + 's';
          row.appendChild(sk);
        });
        grid.appendChild(row);
      }
    });

    wrap.appendChild(grid);
    pc.appendChild(wrap);
  }

  /* ════════════════════════════════
     LOAD MORE
  ════════════════════════════════ */
  function _loadMoreBtn(grid) {
    const wrap = document.createElement('div');
    wrap.className = 'img-load-more';

    const btn = document.createElement('button');
    btn.className   = 'img-load-more-btn';
    btn.textContent = 'Load more';

    btn.addEventListener('click', () => {
      _renderPage(grid);
      if (_page * PAGE_SIZE >= _allResults.length) wrap.style.display = 'none';
    });

    wrap.appendChild(btn);
    return wrap;
  }

  /* ════════════════════════════════
     LIGHTBOX
  ════════════════════════════════ */
  function _openLightbox(index) {
    _closeLightbox();
    const item = _allResults[index];
    if (!item) return;

    const backdrop = document.createElement('div');
    backdrop.className = 'img-lightbox-backdrop';

    const inner = document.createElement('div');
    inner.className = 'img-lightbox-inner';

    const img = document.createElement('img');
    img.src = item.img_src || item.thumbnail_src;
    img.alt = item.title || '';
    inner.appendChild(img);

    if (item.title) {
      const cap = document.createElement('p');
      cap.className   = 'img-lightbox-title';
      cap.textContent = item.title;
      inner.appendChild(cap);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'img-lightbox-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.addEventListener('click', _closeLightbox);

    backdrop.appendChild(inner);
    backdrop.appendChild(closeBtn);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) _closeLightbox(); });

    document.addEventListener('keydown', _lbKey);
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    _lightbox = backdrop;
  }

  function _closeLightbox() {
    if (!_lightbox) return;
    _lightbox.remove();
    _lightbox = null;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', _lbKey);
  }

  function _lbKey(e) { if (e.key === 'Escape') _closeLightbox(); }

  function _esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }

})();
