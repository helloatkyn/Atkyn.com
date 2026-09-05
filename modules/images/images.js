/* ═══════════════════════════════════════════════════════════════════
   images.js — Atkyn Images module
   Loaded by core.js as modules/images/images.js
   Registers window._atkynInit_images() which core calls on tab switch
════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const PAGE_SIZE = 20;

  /* ── State ── */
  let _allResults = [];
  let _page       = 0;
  let _lastQuery  = '';
  let _lightbox   = null;

  /* ════════════════════════════════
     INIT — called by core.js
  ════════════════════════════════ */
  window._atkynInit_images = function () {
    let q = '';
    try { q = sessionStorage.getItem('atkyn_last_query') || ''; } catch (_) {}

    const pc = window._atkynPageContent;
    if (!pc) return;

    /* Same query already rendered — just show it */
    if (q && q === _lastQuery && _allResults.length) {
      _mountGrid(pc);
      return;
    }

    if (!q) {
      pc.innerHTML = '<div class="img-empty"><p>Type something to search images.</p></div>';
      return;
    }

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
      /* Use same API base that the web/other modules use */
      const base = (window.ATKYN_API_BASE || '').replace(/\/$/, '');
      const url  = `${base}/api/images?q=${encodeURIComponent(q)}`;

      const res  = await fetch(url);
      if (!res.ok) throw new Error('API error ' + res.status);

      const data = await res.json();
      _allResults = (data.results || []).filter(r => r.img_src || r.thumbnail_src);

    } catch (err) {
      console.error('[Atkyn Images]', err);
      _allResults = [];
    }

    /* Guard: user may have switched tab while fetching */
    if (window._atkynPageContent !== pc && pc !== window._atkynPageContent) {
      /* still mount — core hides/shows pageContent, not swaps it */
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
    slice.forEach((item, i) => grid.appendChild(_makeCard(item, start + i)));
    _page++;
  }

  /* ════════════════════════════════
     CARD
  ════════════════════════════════ */
  function _makeCard(item, index) {
    const card = document.createElement('div');
    card.className = 'img-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', item.title || 'Image');

    /* Natural aspect ratio — no fixed height, no crop */
    const img = document.createElement('img');
    img.alt      = item.title || '';
    img.loading  = 'lazy';
    img.decoding = 'async';
    img.src      = item.thumbnail_src || item.img_src;

    /* Reserve approx space while loading to prevent layout jump */
    if (item.width && item.height) {
      const ar = item.height / item.width;
      img.style.aspectRatio = `${item.width} / ${item.height}`;
    }

    img.addEventListener('load', () => img.classList.add('loaded'));
    img.addEventListener('error', () => {
      if (img.src !== item.img_src && item.img_src) {
        img.src = item.img_src;
      } else {
        card.style.display = 'none';
      }
    });

    /* Hover title overlay */
    const overlay = document.createElement('div');
    overlay.className = 'img-overlay';
    if (item.title) {
      const t = document.createElement('span');
      t.className   = 'img-overlay-title';
      t.textContent = item.title;
      overlay.appendChild(t);
    }

    card.appendChild(img);
    card.appendChild(overlay);

    const open = () => _openLightbox(index);
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });

    return card;
  }

  /* ════════════════════════════════
     LOAD MORE
  ════════════════════════════════ */
  function _loadMoreBtn(grid) {
    const wrap = document.createElement('div');
    wrap.className = 'img-load-more';

    const btn = document.createElement('button');
    btn.className   = 'img-load-more-btn';
    btn.textContent = 'Load more images';

    btn.addEventListener('click', () => {
      _renderPage(grid);
      const remaining = _allResults.length - _page * PAGE_SIZE;
      if (remaining <= 0) wrap.style.display = 'none';
    });

    wrap.appendChild(btn);
    return wrap;
  }

  /* ════════════════════════════════
     SKELETON
  ════════════════════════════════ */
  function _showSkeleton(pc) {
    pc.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.id = 'images-tab';

    const grid = document.createElement('div');
    grid.className = 'img-grid';

    /* 10 skeleton placeholders with varying heights */
    const heights = [160,220,140,200,180,150,230,170,190,160];
    heights.forEach(h => {
      const sk = document.createElement('div');
      sk.className   = 'img-skeleton';
      sk.style.height = h + 'px';
      grid.appendChild(sk);
    });

    wrap.appendChild(grid);
    pc.appendChild(wrap);
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

    const img   = document.createElement('img');
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

  /* ════════════════════════════════
     UTILS
  ════════════════════════════════ */
  function _esc(str) {
    return String(str).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

})();
