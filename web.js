/* modules/web.js — Web tab content */
(function() {

function _escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _safeUrl(u) {
  try { const p=new URL(u); return (p.protocol==='https:'||p.protocol==='http:') ? u : '#'; } catch(_){return '#';}
}

function _buildCard(r) {
  let hostname = r.url, pathname = r.url;
  try { const u=new URL(r.url); hostname=u.hostname.replace(/^www\./,''); pathname=hostname+new URL(r.url).pathname; } catch(_){}
  const href    = _safeUrl(r.url);
  const favicon = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`;
  const thumb   = r.image ? `<img class="web-card-thumb" src="${_escHtml(r.image)}" loading="lazy" decoding="async" alt="" onerror="this.remove()">` : '';
  const a = document.createElement('a');
  a.className = 'web-card'; a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.innerHTML = `
    <div class="web-card-body">
      <div class="web-card-text">
        <div class="web-card-title">${_escHtml(r.title)}</div>
        <div class="web-card-snippet">${_escHtml(r.snippet)}</div>
      </div>${thumb}
    </div>
    <div class="web-card-meta">
      <div class="web-card-favicon-wrap"><img class="web-card-favicon" src="${_escHtml(favicon)}" width="16" height="16" loading="lazy" decoding="async" alt="" onerror="this.closest('.web-card-favicon-wrap').style.display='none'"></div>
      <span class="web-card-domain">${_escHtml(hostname)}</span>
      <span class="web-card-sep">·</span>
      <span class="web-card-url-text">${_escHtml(pathname)}</span>
    </div>`;
  return a;
}

async function _search(q) {
  const pc = window._atkynPageContent;
  pc.innerHTML = '<div class="tab-skeleton"><div class="sk-line"></div><div class="sk-line sk-short"></div><div class="sk-line"></div><div class="sk-line"></div><div class="sk-line sk-short"></div></div>';

  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, webOnly: true }),
    });
    if (!resp.ok) throw new Error('api error');

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let buf = '', rendered = false, done = false;

    const wrap = document.createElement('div');
    wrap.className = 'web-results-list';

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
          /* results event — may come as JSON array */
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) {
            parsed.forEach(r => wrap.appendChild(_buildCard(r)));
            if (!rendered) {
              pc.innerHTML = '';
              pc.appendChild(wrap);
              window._atkynAnimateIn();
              rendered = true;
            }
          }
        } catch(_) {}
      }
    }

    if (!rendered) {
      pc.innerHTML = '<div class="tab-empty"><p>No results found</p></div>';
    }
  } catch(_) {
    pc.innerHTML = '<div class="tab-empty"><p>Could not load results</p></div>';
  }
}

/* Init — called on tab switch */
window._atkynInit_web = function() {
  const q = sessionStorage.getItem('atkyn_last_query') || '';
  if (q) _search(q);
  else {
    window._atkynPageContent.innerHTML = '<div class="tab-empty"><p>Search something to see web results</p></div>';
  }
};

window._atkynInit_web();
}());
