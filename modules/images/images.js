/**
 * Atkyn Images Module
 * Drop-in for modules/images/
 * Expects:
 *   - a <div id="images-tab"> in the DOM
 *   - window.IMAGES_API_URL  OR  a global fetchImageResults(q) function
 *   - Brand color already set via CSS (--brand: #0072B1)
 */

(function () {
  'use strict';

  /* ── Config ── */
  const PAGE_SIZE = 20;   // images per "page"

  /* ── State ── */
  let _allResults  = [];
  let _page        = 0;
  let _currentQ    = '';
  let _lightbox    = null;

  /* ── Entry point called from your main search handler ── */
  window.ImagesModule = {
    /**
     * Call this when the user searches and the Images tab is (or becomes) active.
     * @param {string} query
     * @param {Array}  results  — array from your backend: [{title, url, img_src, thumbnail_src, width, height}]
     */
    render(query, results) {
      _currentQ   = query;
      _allResults = results || [];
      _page       = 0;

      const tab = document.getElementById('images-tab');
      if (!tab) return;

      tab.innerHTML = '';

      if (!_allResults.length) {
        tab.appendChild(_emptyState(query));
        return;
      }

      const grid = _makeGrid();
      tab.appendChild(grid);
      _renderPage(grid);

      if (_allResults.length > PAGE_SIZE) {
        tab.appendChild(_loadMoreBtn(grid));
      }
    },

    /** Call if you lazy-load the images tab after a search already completed */
    show() {
      const tab = document.getElementById('images-tab');
      if (tab && !tab.hasChildNodes() && _allResults.length) {
        this.render(_currentQ, _allResults);
      }
    },
  };

  /* ── Grid ── */
  function _makeGrid() {
    const grid = document.createElement('div');
    grid.className = 'img-grid';
    return grid;
  }

  function _renderPage(grid) {
    const start = _page * PAGE_SIZE;
    const slice = _allResults.slice(start, start + PAGE_SIZE);
    slice.forEach((item, i) => grid.appendChild(_makeCard(item, start + i)));
    _page++;
  }

  /* ── Card ── */
  function _makeCard(item, index) {
    const card = document.createElement('div');
    card.className = 'img-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', item.title || 'Image');

    /* Skeleton placeholder height — approximate based on aspect ratio */
    const ar = (item.width && item.height) ? item.height / item.width : 0.75;
    const skH = Math.round(ar * 100);

    /* img element */
    const img = document.createElement('img');
    img.alt          = item.title || '';
    img.loading      = 'lazy';
    img.decoding     = 'async';
    img.src          = item.thumbnail_src || item.img_src;
    img.style.minHeight = skH + 'px';      /* holds space before load */

    img.addEventListener('load', () => {
      img.style.minHeight = '';
      img.classList.add('loaded');
    });
    img.addEventListener('error', () => {
      /* fallback to full-size URL */
      if (img.src !== item.img_src) {
        img.src = item.img_src;
      } else {
        card.style.display = 'none';       /* hide broken card */
      }
    });

    /* Overlay */
    const overlay = document.createElement('div');
    overlay.className = 'img-overlay';
    if (item.title) {
      const titleEl = document.createElement('span');
      titleEl.className   = 'img-overlay-title';
      titleEl.textContent = item.title;
      overlay.appendChild(titleEl);
    }

    card.appendChild(img);
    card.appendChild(overlay);

    /* Open lightbox */
    const open = () => _openLightbox(index);
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });

    return card;
  }

  /* ── Load More ── */
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

  /* ── Empty State ── */
  function _emptyState(query) {
    const el = document.createElement('div');
    el.className = 'img-empty';
    el.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
      <p>No images found for <strong>${_esc(query)}</strong></p>
    `;
    return el;
  }

  /* ── Lightbox ── */
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

    const title = document.createElement('p');
    title.className   = 'img-lightbox-title';
    title.textContent = item.title || '';

    const closeBtn = document.createElement('button');
    closeBtn.className   = 'img-lightbox-close';
    closeBtn.innerHTML   = '&#x2715;';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', _closeLightbox);

    inner.appendChild(img);
    if (item.title) inner.appendChild(title);

    backdrop.appendChild(inner);
    backdrop.appendChild(closeBtn);

    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) _closeLightbox();
    });

    document.addEventListener('keydown', _lbKeyHandler);
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    _lightbox = backdrop;
  }

  function _closeLightbox() {
    if (_lightbox) {
      _lightbox.remove();
      _lightbox = null;
      document.body.style.overflow = '';
      document.removeEventListener('keydown', _lbKeyHandler);
    }
  }

  function _lbKeyHandler(e) {
    if (e.key === 'Escape') _closeLightbox();
  }

  /* ── Utils ── */
  function _esc(str) {
    return str.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

})();
