/* ═══════════════════════════════════════════════════════════════
   modules/web/web.js — Atkyn Web tab
   SearXNG proxy via /api/search — zero AI calls.
   Requires: core.js globals (_atkynPageContent, _atkynAnimateIn)
   ═══════════════════════════════════════════════════════════════ */

(function () {

/* ── Helpers ── */
const _esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const _safeUrl = u => {
  try { const p = new URL(u); return (p.protocol === 'https:' || p.protocol === 'http:') ? u : '#'; }
  catch (_) { return '#'; }
};

/* ── Card builder ── */
function _buildCard(r) {
  let host = '', path = '';
  try {
    const u = new URL(r.url);
    host = u.hostname.replace(/^www\./, '');
    path = (host + u.pathname).replace(/\/$/, '').substring(0, 60);
  } catch (_) { host = r.url; path = r.url; }

  const fav  = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`;
  const fav2 = `https://icons.duckduckgo.com/ip3/${host}.ico`;

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
          <circle cx="2" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/>
        </svg>
      </span>
    </div>
    <div class="wc-title">${_esc(r.title)}</div>
    <div class="wc-snippet">${_esc(r.snippet)}</div>`;

  a.querySelector('.wc-fav').addEventListener('error', function () {
    this.src !== fav2 ? (this.src = fav2) : (this.closest('.wc-fav-wrap').style.display = 'none');
  }, { once: true, passive: true });

  return a;
}

/* ── Infobox (entity panel) ── */
function _buildInfobox(box) {
  if (!box?.title) return null;

  const el = document.createElement('div');
  el.className = 'wc-infobox';
  el.innerHTML = `<div class="wc-infobox-title">${_esc(box.title)}</div>
    ${box.content ? `<div class="wc-infobox-content">${_esc(box.content)}</div>` : ''}`;

  if (box.urls?.length) {
    const links = box.urls.map(u =>
      `<a class="wc-sitelink" href="${_safeUrl(u.url)}" target="_blank" rel="noopener noreferrer">
        <span class="wc-sitelink-title">${_esc(u.title)}</span>
        <svg class="wc-sitelink-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </a>`
    ).join('');
    el.innerHTML += `<div class="wc-sitelinks">${links}</div>`;
  }

  return el;
}

/* ── Answer pill ── */
function _buildAnswers(answers) {
  if (!answers?.length) return null;
  const el = document.createElement('div');
  el.className = 'wc-answers';
  el.innerHTML = answers.map(a => `<div class="wc-answer-pill">${_esc(a)}</div>`).join('');
  return el;
}

/* ── Related searches ── */
function _buildRelated(q, relatedSearches) {
  if (!relatedSearches?.length) return null;

  const el = document.createElement('div');
  el.className = 'wc-related';
  el.innerHTML = `<div class="wc-related-title">Related to "${_esc(q)}"</div>`;

  const list = document.createElement('div');
  list.className = 'wc-related-list';

  relatedSearches.forEach(query => {
    const btn = document.createElement('button');
    btn.className = 'wc-related-item';
    btn.innerHTML = `
      <svg class="wc-related-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <span>${_esc(query)}</span>
      <svg class="wc-related-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>
      </svg>`;
    btn.addEventListener('click', () => _triggerSearch(query), { passive: true });
    list.appendChild(btn);
  });

  el.appendChild(list);
  return el;
}

/* ── Trigger new search ── */
function _triggerSearch(query) {
  const cb   = document.getElementById('cbInput');
  const pill = document.getElementById('pill');
  if (cb)   cb.value = query;
  if (pill) pill.classList.add('has-text');
  sessionStorage.setItem('atkyn_last_query', query);
  sessionStorage.removeItem('atkyn_web_results');
  _fetch(query);
}

/* ── Render ── */
function _render(q, data) {
  const frag = document.createDocumentFragment();

  const answers = _buildAnswers(data.answers);
  if (answers) frag.appendChild(answers);

  const infobox = _buildInfobox(data.infobox);
  if (infobox) frag.appendChild(infobox);

  const list = document.createElement('div');
  list.className = 'wc-list';
  data.results.forEach(r => list.appendChild(_buildCard(r)));
  frag.appendChild(list);

  const related = _buildRelated(q, data.relatedSearches);
  if (related) frag.appendChild(related);

  const pc = window._atkynPageContent;
  pc.innerHTML = '';
  pc.appendChild(frag);
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
    if (data.error) throw new Error(data.error);

    const results = Array.isArray(data) ? data : (data.results || []);
    if (!results.length) {
      pc.innerHTML = '<div class="tab-empty"><p>No results found</p></div>';
      return;
    }

    const payload = Array.isArray(data)
      ? { results, infobox: null, relatedSearches: [], answers: [] }
      : { results, infobox: data.infobox || null, relatedSearches: data.relatedSearches || [], answers: data.answers || [] };

    try { sessionStorage.setItem('atkyn_web_results', JSON.stringify({ q, ...payload })); } catch (_) {}
    _render(q, payload);

  } catch (_) {
    pc.innerHTML = '<div class="tab-empty"><p>Could not load results. Try again.</p></div>';
  }
}

/* ── Sync chatbar ── */
function _syncChatbar(q) {
  const cb   = document.getElementById('cbInput');
  const pill = document.getElementById('pill');
  if (cb)   cb.value = q;
  if (pill) pill.classList.toggle('has-text', q.length > 0);
}

/* ── Init ── */
function _init() {
  const q  = sessionStorage.getItem('atkyn_last_query') || '';
  const pc = window._atkynPageContent;
  _syncChatbar(q);

  const cached = sessionStorage.getItem('atkyn_web_results');
  if (cached) {
    try {
      const saved = JSON.parse(cached);
      if (saved.q === q && saved.results?.length) { _render(q, saved); return; }
    } catch (_) {}
  }

  if (q) { _fetch(q); return; }

  pc.innerHTML = '<div class="tab-empty"><p>Search something to see web results</p></div>';
}

window._atkynInit_web = _init;
_init();

}());
