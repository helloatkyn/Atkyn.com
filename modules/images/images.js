/* modules/images.js — Images tab */
(function () {

  window._atkynInit_images = function () {
    const q  = sessionStorage.getItem('atkyn_last_query') || '';
    const pc = window._atkynPageContent;

    if (!q) {
      pc.innerHTML = '<div class="tab-empty"><p>Search something to see images</p></div>';
      return;
    }

    pc.innerHTML = '<div class="tab-skeleton grid"><div class="sk-img"></div><div class="sk-img"></div><div class="sk-img"></div><div class="sk-img"></div></div>';

    fetch(`/api/images?q=${encodeURIComponent(q)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        const results = data.results || [];
        if (!results.length) throw new Error('empty');

        const grid = document.createElement('div');
        grid.className = 'images-grid';

        results.forEach(img => {
          if (!img.img_src && !img.thumbnail_src) return;

          const src    = img.img_src || img.thumbnail_src;
          const thumb  = img.thumbnail_src || img.img_src;
          const title  = img.title || '';
          const url    = img.url   || src;
          const w      = img.width  || 0;
          const h      = img.height || 0;

          /* aspect ratio se decide karo — portrait ya landscape */
          const isWide = w && h && (w / h) > 1.4;
          const isTall = w && h && (h / w) > 1.4;

          const a = document.createElement('a');
          a.className = 'img-tile';
          if (isWide) a.classList.add('img-tile--wide');
          a.href   = url;
          a.target = '_blank';
          a.rel    = 'noopener noreferrer';

          /* placeholder box — aspect ratio preserve karo, no layout shift */
          const ratio = (w && h) ? ((h / w) * 100).toFixed(2) : '75';
          const box   = document.createElement('div');
          box.className = 'img-tile__box';
          box.style.paddingBottom = ratio + '%';

          const imgEl    = document.createElement('img');
          imgEl.alt      = title;
          imgEl.loading  = 'lazy';
          imgEl.decoding = 'async';

          /* lazy load via IntersectionObserver */
          imgEl.dataset.src   = src;
          imgEl.dataset.thumb = thumb;
          imgEl.classList.add('img-lazy');

          imgEl.onerror = function () {
            /* thumb try karo pehle, phir tile hatao */
            if (this.src !== thumb && thumb !== src) {
              this.src = thumb;
            } else {
              this.closest('.img-tile')?.remove();
            }
          };

          box.appendChild(imgEl);
          a.appendChild(box);
          grid.appendChild(a);
        });

        pc.innerHTML = '';
        pc.appendChild(grid);
        window._atkynAnimateIn?.();
        _observeImages(grid);
      })
      .catch(() => {
        pc.innerHTML = '<div class="tab-empty"><p>Could not load images</p></div>';
      });
  };

  /* IntersectionObserver — lazy load */
  function _observeImages(container) {
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        img.src = img.dataset.src;
        img.classList.add('img-loaded');
        obs.unobserve(img);
      });
    }, { rootMargin: '200px' });

    container.querySelectorAll('.img-lazy').forEach(img => io.observe(img));
  }

  window._atkynInit_images();
}());
