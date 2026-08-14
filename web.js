/* modules/web.js — Web tab content */
(function() {

function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _safeUrl(u) { try { const p=new URL(u); return (p.protocol==='https:'||p.protocol==='http:') ? u : '#'; } catch(_){return '#';} }

function _buildCard(r) {
  let host=r.url, path=r.url;
  try { const u=new URL(r.url); host=u.hostname.replace(/^www\./,''); path=host+u.pathname; } catch(_){}
  const fav = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`;
  const thumb = r.image ? `<img class="web-card-thumb" src="${_esc(r.image)}" loading="lazy" decoding="async" alt="" onerror="this.remove()">` : '';
  const a = document.createElement('a');
  a.className='web-card'; a.href=_safeUrl(r.url); a.target='_blank'; a.rel='noopener noreferrer';
  a.innerHTML=`
    <div class="web-card-body">
      <div class="web-card-text">
        <div class="web-card-title">${_esc(r.title)}</div>
        <div class="web-card-snippet">${_esc(r.snippet)}</div>
      </div>${thumb}
    </div>
    <div class="web-card-meta">
      <div class="web-card-favicon-wrap"><img class="web-card-favicon" src="${_esc(fav)}" width="16" height="16" loading="lazy" alt="" onerror="this.closest('.web-card-favicon-wrap').style.display='none'"></div>
      <span class="web-card-domain">${_esc(host)}</span>
      <span class="web-card-sep">·</span>
      <span class="web-card-url-text">${_esc(path)}</span>
    </div>`;
  return a;
}

function _renderResults(results) {
  const pc = window._atkynPageContent;
  const wrap = document.createElement('div');
  wrap.className = 'web-results-list';
  results.forEach(r => wrap.appendChild(_buildCard(r)));
  pc.innerHTML = '';
  pc.appendChild(wrap);
  window._atkynAnimateIn();
}

async function _search(q) {
  const pc = window._atkynPageContent;
  pc.innerHTML = '<div class="tab-skeleton"><div class="sk-line"></div><div class="sk-line sk-short"></div><div class="sk-line"></div><div class="sk-line"></div></div>';
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, webOnly: true }),
    });
    if (!resp.ok) throw new Error();
    const reader=resp.body.getReader(), decoder=new TextDecoder('utf-8',{fatal:false});
    let buf='', rendered=false, done=false, allResults=[];
    const wrap=document.createElement('div'); wrap.className='web-results-list';
    while (!done) {
      const chunk=await reader.read(); done=chunk.done;
      buf += done ? decoder.decode() : decoder.decode(chunk.value,{stream:true});
      const lines=buf.split('\n'); buf=done?'':lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data=line.slice(6).trim();
        if (data==='[DONE]') { done=true; break; }
        try {
          const parsed=JSON.parse(data);
          if (Array.isArray(parsed)) {
            allResults = allResults.concat(parsed);
            parsed.forEach(r=>wrap.appendChild(_buildCard(r)));
            if (!rendered) { pc.innerHTML=''; pc.appendChild(wrap); window._atkynAnimateIn(); rendered=true; }
          }
        } catch(_) {}
      }
    }
    /* Cache for next visit */
    if (allResults.length) {
      try { sessionStorage.setItem('atkyn_web_results', JSON.stringify(allResults)); } catch(_) {}
    }
    if (!rendered) pc.innerHTML='<div class="tab-empty"><p>No results found</p></div>';
  } catch(_) { pc.innerHTML='<div class="tab-empty"><p>Could not load results</p></div>'; }
}

window._atkynInit_web = function() {
  const pc = window._atkynPageContent;
  const q  = sessionStorage.getItem('atkyn_last_query') || '';

  /* 1. Cached results from Answer tab — instant, zero API call */
  const cached = sessionStorage.getItem('atkyn_web_results');
  if (cached) {
    try {
      const results = JSON.parse(cached);
      if (results.length) { _renderResults(results); return; }
    } catch(_) {}
  }

  /* 2. No cache — fresh search if query exists */
  if (q) { _search(q); return; }

  /* 3. Nothing to show */
  pc.innerHTML = '<div class="tab-empty"><p>Search something to see web results</p></div>';
};

window._atkynInit_web();
}());
