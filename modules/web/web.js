(function () {

function _esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _safeUrl(u) {
  try { const p = new URL(u); return (p.protocol==='https:'||p.protocol==='http:') ? u : '#'; }
  catch(_) { return '#'; }
}

function _buildCard(r) {
  let host = r.url, path = r.url;
  try {
    const u = new URL(r.url);
    host = u.hostname.replace(/^www\./, '');
    path = host + u.pathname;
  } catch(_) {}

  const fav  = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`;
  const fav2 = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`;
  const thumb = r.image
    ? `<img class="wc-thumb" src="${_esc(r.image)}" loading="lazy" decoding="async" alt="" onerror="this.closest('.wc-thumb-wrap').remove()">`
    : '';

  const a = document.createElement('a');
  a.className = 'wc-card';
  a.href      = _safeUrl(r.url);
  a.target    = '_blank';
  a.rel       = 'noopener noreferrer';
  a.innerHTML = `
    <div class="wc-meta">
      <div class="wc-fav-wrap">
        <img class="wc-fav" src="${_esc(fav)}" width="16" height="16" loading="lazy" decoding="async" alt="">
      </div>
      <div class="wc-meta-text">
        <span class="wc-domain">${_esc(host)}</span>
        <span class="wc-path">${_esc(path)}</span>
      </div>
      <span class="wc-dots" aria-hidden="true">
        <svg viewBox="0 0 4 16" xmlns="http://www.w3.org/2000/svg">
          <circle cx="2" cy="2"  r="1.5"/>
          <circle cx="2" cy="8"  r="1.5"/>
          <circle cx="2" cy="14" r="1.5"/>
        </svg>
      </span>
    </div>
    <div class="wc-body">
      <div class="wc-text">
        <div class="wc-title">${_esc(r.title)}</div>
        <div class="wc-snippet">${_esc(r.snippet)}</div>
      </div>
      ${thumb ? `<div class="wc-thumb-wrap">${thumb}</div>` : ''}
    </div>`;

  const favImg = a.querySelector('.wc-fav');
  favImg.addEventListener('error', function() {
    if (this.src !== fav2) { this.src = fav2; }
    else { this.closest('.wc-fav-wrap').style.display = 'none'; }
  }, { passive: true });

  return a;
}

function _render(results) {
  const pc   = window._atkynPageContent;
  const list = document.createElement('div');
  list.className = 'wc-list';
  results.forEach(r => list.appendChild(_buildCard(r)));
  pc.innerHTML = '';
  pc.appendChild(list);
  window._atkynAnimateIn();
}

async function _fetch(q) {
  const pc = window._atkynPageContent;
  pc.innerHTML = '<div class="tab-skeleton"><div class="sk-line"></div><div class="sk-line sk-short"></div><div class="sk-line"></div><div class="sk-line sk-short"></div></div>';

  try {
    const resp = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query: q, webOnly: true }),
    });
    if (!resp.ok) throw new Error();

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let buf = '', allResults = [], rendered = false, done = false;
    const list = document.createElement('div');
    list.className = 'wc-list';

    while (!done) {
      const chunk = await reader.read();
      done = chunk.done;
      buf += done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      const lines = buf.split('\n');
      buf = done ? '' : lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { done = true; break; }
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) {
            parsed.forEach(r => list.appendChild(_buildCard(r)));
            allResults = allResults.concat(parsed);
            if (!rendered) {
              pc.innerHTML = '';
              pc.appendChild(list);
              window._atkynAnimateIn();
              rendered = true;
            }
          }
        } catch(_) {}
      }
    }

    if (allResults.length) {
      try { sessionStorage.setItem('atkyn_web_results', JSON.stringify(allResults)); } catch(_) {}
    }
    if (!rendered) pc.innerHTML = '<div class="tab-empty"><p>No results found</p></div>';

  } catch(_) {
    pc.innerHTML = '<div class="tab-empty"><p>Could not load results</p></div>';
  }
}

window._atkynInit_web = function () {
  const q      = sessionStorage.getItem('atkyn_last_query') || '';
  const cached = sessionStorage.getItem('atkyn_web_results');

  if (cached) {
    try {
      const results = JSON.parse(cached);
      if (results.length) { _render(results); return; }
    } catch(_) {}
  }

  if (q) { _fetch(q); return; }

  window._atkynPageContent.innerHTML =
    '<div class="tab-empty"><p>Search something to see web results</p></div>';
};

window._atkynInit_web();
}());
