/* ═══════════════════════════════════════════════════════════════
   modules/web/web.js — Atkyn Web tab
   Fetches from /api/search (Serper.dev proxy — zero AI calls).
   Requires: core.js globals (_atkynPageContent, _atkynAnimateIn)
   ═══════════════════════════════════════════════════════════════ */

(function () {

/* ── Helpers ── */
function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _safeUrl(u) {
  try {
    const p = new URL(u);
    return (p.protocol === 'https:' || p.protocol === 'http:') ? u : '#';
  } catch (_) { return '#'; }
}

/* ── Card builder ── */
function _buildCard(r) {
  let host = r.url, path = r.url;
  try {
    const u = new URL(r.url);
    host = u.hostname.replace(/^www\./, '');
    path = (host + u.pathname).replace(/\/$/, '').substring(0, 60);
  } catch (_) {}

  const fav  = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`;
  const fav2 = `https://icons.duckduckgo.com/ip3/${host}.ico`;

  const thumb = r.image
    ? `<img class="wc-thumb" src="${_esc(r.image)}" loading="lazy" decoding="async" alt=""
            onerror="this.closest('.wc-thumb-wrap').remove()">`
    : '';

  let sitelinksHtml = '';
  if (r.sitelinks?.length) {
    const linksHtml = r.sitelinks.map(s =>
      `<a class="wc-sitelink" href="${_safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">
        <span class="wc-sitelink-title">${_esc(s.title)}</span>
        <svg class="wc-sitelink-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </a>`
    ).join('');
    sitelinksHtml = `<div class="wc-sitelinks">${linksHtml}</div>`;
  }

  const a = document.createElement('a');
  a.className = 'wc-card';
  a.href      = _safeUrl(r.url);
  a.target    = '_blank';
  a.rel       = 'noopener noreferrer';
  a.innerHTML = `
    <div class="wc-meta">
      <div class="wc-fav-wrap">
        <img class="wc-fav" src="${_esc(fav)}" width="16" height="16"
             loading="lazy" decoding="async" alt="">
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
    </div>
    ${sitelinksHtml}`;

  a.querySelector('.wc-fav').addEventListener('error', function () {
    if (this.src !== fav2) { this.src = fav2; }
    else { this.closest('.wc-fav-wrap').style.display = 'none'; }
  }, { passive: true });

  a.querySelectorAll('.wc-sitelink').forEach(sl => {
    sl.addEventListener('click', e => e.stopPropagation());
  });

  return a;
}

/* ── Render results ── */
function _render(q, results) {
  const pc   = window._atkynPageContent;
  const list = document.createElement('div');
  list.className = 'wc-list';
  results.forEach(r => list.appendChild(_buildCard(r)));
  pc.innerHTML = '';
  pc.appendChild(list);
  window._atkynAnimateIn();
}

/* ── Fetch from /api/search ── */
async function _fetch(q) {
  const pc = window._atkynPageContent;
  pc.innerHTML = '<div class="tab-skeleton"><div class="sk-line"></div><div class="sk-line sk-short"></div>' +
    '<div class="sk-line"></div><div class="sk-line sk-short"></div></div>';

  try {
    const resp = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const results = await resp.json();

    if (!Array.isArray(results) || !results.length) {
      pc.innerHTML = '<div class="tab-empty"><p>No results found</p></div>';
      return;
    }

    try { sessionStorage.setItem('atkyn_web_results', JSON.stringify({ q, results })); } catch (_) {}
    _render(q, results);

  } catch (_) {
    pc.innerHTML = '<div class="tab-empty"><p>Could not load results</p></div>';
  }
}

/* ── Fill chatbar with current query ── */
function _syncChatbar(q) {
  const cb  = document.getElementById('cbInput');
  const pll = document.getElementById('pill');
  if (!cb || !pll) return;
  cb.value = q;
  pll.classList.toggle('has-text', q.length > 0);
}

/* ── Init ── */
function _init() {
  const q      = sessionStorage.getItem('atkyn_last_query') || '';
  _syncChatbar(q);
  const cached = sessionStorage.getItem('atkyn_web_results');

  if (cached) {
    try {
      const { q: cq, results } = JSON.parse(cached);
      if (cq === q && Array.isArray(results) && results.length) {
        _render(q, results);
        return;
      }
    } catch (_) {}
  }

  if (q) { _fetch(q); return; }

  window._atkynPageContent.innerHTML =
    '<div class="tab-empty"><p>Search something to see web results</p></div>';
}

window._atkynInit_web = _init;
_init();

}());
