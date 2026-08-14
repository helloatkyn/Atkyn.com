/* modules/news.js — News tab content */
(function() {

function _escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function _timeAgo(dateStr) {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff/60000);
    if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m/60);
    if (h < 24)  return `${h}h ago`;
    return `${Math.floor(h/24)}d ago`;
  } catch(_) { return ''; }
}

window._atkynInit_news = function() {
  const q  = sessionStorage.getItem('atkyn_last_query') || '';
  const pc = window._atkynPageContent;
  if (!q) {
    pc.innerHTML = '<div class="tab-empty"><p>Search something to see news</p></div>';
    return;
  }

  pc.innerHTML = '<div class="tab-skeleton"><div class="sk-line"></div><div class="sk-line sk-short"></div><div class="sk-line"></div><div class="sk-line sk-short"></div></div>';

  fetch(`/api/news?q=${encodeURIComponent(q)}`)
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      const results = data.results || data || [];
      if (!results.length) throw new Error('empty');

      const list = document.createElement('div');
      list.className = 'news-list';

      results.slice(0, 20).forEach(item => {
        const card = document.createElement('a');
        card.className = 'news-card';
        card.href      = item.url || '#';
        card.target    = '_blank';
        card.rel       = 'noopener noreferrer';

        const thumb = item.img_src
          ? `<img class="news-thumb" src="${_escHtml(item.img_src)}" loading="lazy" decoding="async" alt="" onerror="this.remove()">`
          : '';

        let hostname = '';
        try { hostname = new URL(item.url).hostname.replace(/^www\./, ''); } catch(_) {}

        card.innerHTML = `
          <div class="news-card-body">
            <div class="news-meta">${_escHtml(hostname)}${item.publishedDate ? ` · ${_timeAgo(item.publishedDate)}` : ''}</div>
            <div class="news-title">${_escHtml(item.title || '')}</div>
            <div class="news-snippet">${_escHtml(item.content || '')}</div>
          </div>
          ${thumb}`;

        list.appendChild(card);
      });

      pc.innerHTML = '';
      pc.appendChild(list);
      window._atkynAnimateIn();
    })
    .catch(() => {
      pc.innerHTML = '<div class="tab-empty"><p>Could not load news</p></div>';
    });
};

window._atkynInit_news();
}());
