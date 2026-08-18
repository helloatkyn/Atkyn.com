/* modules/images.js — Images tab content */
(function() {

window._atkynInit_images = function() {
  const q = sessionStorage.getItem('atkyn_last_query') || '';
  const pc = window._atkynPageContent;
  if (!q) {
    pc.innerHTML = '<div class="tab-empty"><p>Search something to see images</p></div>';
    return;
  }

  pc.innerHTML = '<div class="tab-skeleton grid"><div class="sk-img"></div><div class="sk-img"></div><div class="sk-img"></div><div class="sk-img"></div></div>';

  /* SearXNG image results via /api/images */
  fetch(`/api/images?q=${encodeURIComponent(q)}`)
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      const results = data.results || data || [];
      if (!results.length) throw new Error('empty');

      const grid = document.createElement('div');
      grid.className = 'images-masonry';

      results.slice(0, 30).forEach(img => {
        if (!img.img_src && !img.thumbnail_src) return;
        const src   = img.img_src || img.thumbnail_src;
        const title = img.title || '';
        const url   = img.url  || src;

        const a = document.createElement('a');
        a.className = 'img-tile';
        a.href      = url;
        a.target    = '_blank';
        a.rel       = 'noopener noreferrer';

        const imgEl = document.createElement('img');
        imgEl.src     = src;
        imgEl.alt     = title;
        imgEl.loading = 'lazy';
        imgEl.decoding = 'async';
        imgEl.onerror = function() { this.closest('.img-tile')?.remove(); };

        a.appendChild(imgEl);
        grid.appendChild(a);
      });

      pc.innerHTML = '';
      pc.appendChild(grid);
      window._atkynAnimateIn();
    })
    .catch(() => {
      pc.innerHTML = '<div class="tab-empty"><p>Could not load images</p></div>';
    });
};

window._atkynInit_images();
}());
