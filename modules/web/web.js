/* ═══════════════════════════════════════════════════════════════
   modules/web/web.js — Atkyn Web tab
   Fetches from /api/search (SearXNG proxy — zero AI calls).
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

/* ── Infobox card (entity panel with sitelinks) ── */
function _buildInfoboxCard(box) {
  const wrap = document.createElement('div');
  wrap.className = 'wc-card';

  const linksHtml = (box.urls || []).slice(0, 6).map(s =>
    `<a class="wc-sitelink" href="${_safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">
      <span class="wc-sitelink-title">${_esc(s.title)}</span>
      <svg class="wc-sitelink-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </a>`
  ).join('');

  wrap.innerHTML = `
    <div class="wc-title" style="margin-bottom:10px">${_esc(box.title)}</div>
    ${box.content ? `<div class="wc-snippet" style="margin-bottom:4px">${_esc(box.content)}</div>` : ''}
    ${linksHtml ? `<div class="wc-sitelinks">${linksHtml}</div>` : ''}`;

  wrap.querySelectorAll('.wc-sitelink').forEach(sl => {
    sl.addEventListener('click', e => e.stopPropagation());
  });

  return wrap;
}

/* ── Regular result card ── */
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

  let imagesHtml = '';
  if (r.images?.length >= 2) {
    const imgs = r.images.slice(0, 4).map(img =>
      `<img class="wc-img-grid-item" src="${_esc(img)}" loading="lazy" decoding="async" alt=""
            onerror="this.remove()">`
    ).join('');
    imagesHtml = `<div class="wc-img-grid">${imgs}</div>`;
  }

  const a = document.createElement('a');
  a.className = 'wc-card';
  a.href      = _safeUrl(r.url);
  a.target    = '_blank';
  a.rel       = 'noopener noreferrer';
  a.innerHTML = `
    <div class="wc-meta">
      <div class="wc-fav-wrap">
        <img class="wc-fav" src="${_esc(fav)}" width="17" height="17"
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
      ${!imagesHtml && thumb ? `<div class="wc-thumb-wrap">${thumb}</div>` : ''}
    </div>
    ${imagesHtml}`;

  a.querySelector('.wc-fav').addEventListener('error', function () {
    if (this.src !== fav2) { this.src = fav2; }
    else { this.closest('.wc-fav-wrap').style.display = 'none'; }
  }, { passive: true });

  return a;
}

/* ── Related searches ── */
function _buildRelated(q, relatedSearches) {
  if (!relatedSearches?.length) return null;

  const section = document.createElement('div');
  section.className = 'wc-related';

  const title = document.createElement('div');
  title.className = 'wc-related-title';
  title.textContent = `Related to "${q}"`;
  section.appendChild(title);

  const list = document.createElement('div');
  list.className = 'wc-related-list';

  relatedSearches.forEach(query => {
    const btn = document.createElement('button');
    btn.className = 'wc-related-item';
    btn.innerHTML = `
      <svg class="wc-related-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <span>${_esc(query)}</span>
      <svg class="wc-related-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>
      </svg>`;
    btn.addEventListener('click', () => {
      const cb   = document.getElementById('cbInput');
      const pill = document.getElementById('pill');
      if (cb) { cb.value = query; pill?.classList.add('has-text'); }
      sessionStorage.setItem('atkyn_last_query', query);
      _fetch(query);
    });
    list.appendChild(btn);
  });

  section.appendChild(list);
  return section;
}

/* ── Answer banner (calculator, time, etc.) ── */
function _buildAnswerBanner(answers) {
  if (!answers?.length) return null;
  const div = document.createElement('div');
  div.className = 'wc-card';
  div.style.cssText = 'margin-bottom:2px;';
  div.innerHTML = `<div class="wc-title" style="font-size:1.4rem;margin:0">${_esc(answers[0])}</div>`;
  return div;
}

/* ── Render ── */
function _render(q, results, relatedSearches, infobox, answers) {
  const pc = window._atkynPageContent;
  pc.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'wc-list';

  if (infobox?.title) list.appendChild(_buildInfoboxCard(infobox));

  results.forEach(r => list.appendChild(_buildCard(r)));

  pc.appendChild(list);

  const related = _buildRelated(q, relatedSearches);
  if (related) pc.appendChild(related);

  window._atkynAnimateIn();
}

/* ── Fetch ── */
async function _fetch(q) {
  const pc = window._atkynPageContent;
  pc.innerHTML =
    '<div class="tab-skeleton"><div class="sk-line"></div><div class="sk-line sk-short"></div>' +
    '<div class="sk-line"></div><div class="sk-line sk-short"></div></div>';

  try {
    const resp = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();

    const results         = Array.isArray(data) ? data : (data.results         || []);
    const relatedSearches = Array.isArray(data) ? []   : (data.relatedSearches || []);
    const infobox         = Array.isArray(data) ? null : (data.infobox         || null);
    const answers         = Array.isArray(data) ? []   : (data.answers         || []);

    if (!results.length && !infobox && !answers.length) {
      pc.innerHTML = '<div class="tab-empty"><p>No results found</p></div>';
      return;
    }

    try {
      sessionStorage.setItem('atkyn_web_results',
        JSON.stringify({ q, results, relatedSearches, infobox, answers }));
    } catch (_) {}

    _render(q, results, relatedSearches, infobox, answers);

  } catch (_) {
    pc.innerHTML = '<div class="tab-empty"><p>Could not load results</p></div>';
  }
}

/* ── Sync chatbar ── */
function _syncChatbar(q) {
  const cb  = document.getElementById('cbInput');
  const pll = document.getElementById('pill');
  if (!cb || !pll) return;
  cb.value = q;
  pll.classList.toggle('has-text', q.length > 0);
}

/* ── Init ── */
function _init() {
  const q = sessionStorage.getItem('atkyn_last_query') || '';
  _syncChatbar(q);

  const cached = sessionStorage.getItem('atkyn_web_results');
  if (cached) {
    try {
      const { q: cq, results, relatedSearches, infobox, answers } = JSON.parse(cached);
      const hasRelated = Array.isArray(relatedSearches) && relatedSearches.length > 0;
      if (cq === q && (results?.length || infobox || answers?.length) && hasRelated) {
        _render(q, results || [], relatedSearches || [], infobox || null, answers || []);
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
     
