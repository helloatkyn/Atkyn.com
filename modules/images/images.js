/* modules/images.js — Images tab */
(function () {

  const FIRST_RENDER = 20;  // pehle sirf 20 render karo
  const BATCH        = 20;  // scroll pe 20 20

  let _allResults   = [];
  let _rendered     = 0;
  let _patternQueue = [];
  let _grid         = null;
  let _sentinel     = null;
  let _scrollIo     = null;
  let _lazyIo       = null;

  /* ── Random grid pattern ── */
  const PATTERNS = [
    [2, 1, 1],
    [1, 1, 2],
    [1, 1, 1, 1],
    [2, 1, 1, 2],
    [1, 1, 2, 1, 1],
  ];

  function _nextSpan() {
    if (!_patternQueue.length) {
      const p = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
      _patternQueue = [...p];
    }
    return _patternQueue.shift();
  }

  /* ── Build one tile ── */
  function _buildTile(img, span) {
    if (!img.img_src && !img.thumbnail_src) return null;

    const src   = img.img_src       || img.thumbnail_src;
    const thumb = img.thumbnail_src || img.img_src;
    const w     = img.width  || 0;
    const h     = img.height || 0;

    const a = document.createElement('a');
    a.className = 'img-tile';
    if (span === 2) a.classList.add('img-tile--wide');
    a.href   = img.url || src;
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';

    const ratio = (w && h) ? ((h / w) * 100).toFixed(2) : (span === 2 ? '56' : '100');
    const box   = document.createElement('div');
    box.className = 'img-tile__box';
    box.style.paddingBottom = ratio + '%';

    const imgEl     = document.createElement('img');
    imgEl.alt       = img.title || '';
    imgEl.decoding  = 'async';
    imgEl.dataset.src   = src;
    imgEl.dataset.thumb = thumb;
    imgEl.classList.add('img-lazy');

    imgEl.onerror = function () {
      if (this.src !== thumb && thumb !== src) {
        this.src = thumb;
      } else {
        this.closest('.img-tile')?.remove();
      }
    };

    box.appendChild(imgEl);
    a.appendChild(box);
    return a;
  }

  /* ── Render next BATCH from already-fetched _allResults ── */
  function _renderBatch() {
    const chunk = _allResults.slice(_rendered, _rendered + BATCH);
    if (!chunk.length) return;

    const frag = document.createDocumentFragment();
    chunk.forEach(img => {
      const tile = _buildTile(img, _nextSpan());
      if (tile) frag.appendChild(tile);
    });

    /* sentinel ke pehle insert karo */
    _grid.insertBefore(frag, _sentinel);
    _rendered += chunk.length;

    /* naye lazy images observe karo */
    _grid.querySelectorAll('.img-lazy:not([data-ob])').forEach(img => {
      img.dataset.ob = '1';
      _lazyIo.observe(img);
    });

    /* agar sab render ho gaye toh sentinel hatao */
    if (_rendered >= _allResults.length) {
      _sentinel.remove();
    }
  }

  /* ── Init ── */
  window._atkynInit_images = function () {
    _allResults   = [];
    _rendered     = 0;
    _patternQueue = [];

    const q  = sessionStorage.getItem('atkyn_last_query') || '';
    const pc = window._atkynPageContent;

    if (!q) {
      pc.innerHTML = '<div class="tab-empty"><p>Search something to see images</p></div>';
      return;
    }

    pc.innerHTML = '<div class="tab-skeleton grid"><div class="sk-img"></div><div class="sk-img"></div><div class="sk-img"></div><div class="sk-img"></div></div>';

    /* Lazy image loader */
    _lazyIo = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        img.src = img.dataset.src;
        img.onload = () => img.classList.add('img-loaded');
        obs.unobserve(img);
      });
    }, { rootMargin: '400px' });

    /* Scroll sentinel — render next batch from memory */
    _sentinel = document.createElement('div');
    _sentinel.className = 'img-sentinel';

    _scrollIo = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      _renderBatch();
    }, { rootMargin: '300px' });

    _grid = document.createElement('div');
    _grid.className = 'images-grid';
    _grid.appendChild(_sentinel);
    _scrollIo.observe(_sentinel);

    pc.innerHTML = '';
    pc.appendChild(_grid);
    window._atkynAnimateIn?.();

    /* Ek hi API call — 100 results */
    fetch(`/api/images?q=${encodeURIComponent(q)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        _allResults = data.results || [];
        if (!_allResults.length) throw new Error('empty');
        _rendered = 0;
        _renderBatch(); // pehle FIRST_RENDER
      })
      .catch(() => {
        pc.innerHTML = '<div class="tab-empty"><p>Could not load images</p></div>';
      });
  };

}());
