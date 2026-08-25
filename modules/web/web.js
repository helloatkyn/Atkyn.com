/* ═══════════════════════════════════════════════════════════════
   modules/web/web.js — Atkyn Web tab
   SearXNG proxy via /api/search — zero AI calls.
   [PRODUCTION READY: Parallel OG Fetch · Smart Layout · Fast Cache]
   Requires: core.js globals (_atkynPageContent, _atkynAnimateIn)
   ═══════════════════════════════════════════════════════════════ */

(function () {

/* ── Helpers ─ */
const _esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const _safeUrl = u => {
  try {
    const p = new URL(u);
    return (p.protocol === 'https:' || p.protocol === 'http:') ? u : '#';
  } catch (_) { return '#'; }
};

/* ── OG Image Cache (avoid duplicate fetches) ─ */
const _ogCache = new Map();

/* ── Layout Strategy:
   0 = Full-width banner below title (rectangular)
   1 = Right-side square thumbnail (inline with snippet)
   Pattern: First 2 cards get inline (1), rest get full-width (0)
*/
const _getLayout = index => {
  if (index === 0 || index === 1) return 1; // First two: right-side square
  return 0; // Rest: full-width banner
};

/* ── Fetch OG image with caching ─ */
async function _fetchOg(url) {
  // Check cache first
  if (_ogCache.has(url)) return _ogCache.get(url);
  
  // Check sessionStorage
  try {
    const cached = sessionStorage.getItem(`og_${btoa(url)}`);
    if (cached) {
      _ogCache.set(url, cached);
      return cached;
    }
  } catch (_) {}

  // Fetch from worker (3s timeout max)
  try {
    const resp = await fetch(`/api/og?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(3000),
    });
    const data = resp.ok ? await resp.json() : null;
    const image = data?.image || null;
    
    // Cache it
    if (image) {
      _ogCache.set(url, image);
      try { sessionStorage.setItem(`og_${btoa(url)}`, image); } catch (_) {}
    }
    return image;
  } catch (_) {
    return null;
  }
}

/* ── Parallel OG Fetch for all results ── */
async function _fetchAllOgImages(results) {
  const promises = results.map(r => _fetchOg(r.url));
  return Promise.all(promises);
}

/* ── Inject image into result card ── */
function _injectOgImage(cardEl, layout, image) {
  if (!image) return;

  if (layout === 1) {
    // Right-side square thumbnail (inline with snippet)
    const snippet = cardEl.querySelector('.wc-snippet');
    if (!snippet) return;

    const row = document.createElement('div');
    row.className = 'wc-inline-row';
    row.style.display = 'flex';
    row.style.gap = '12px';
    row.style.alignItems = 'flex-start';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'wc-thumb-inline-wrap';
    thumbWrap.style.flexShrink = '0';
    thumbWrap.style.width = '80px';
    thumbWrap.style.height = '80px';
    thumbWrap.style.borderRadius = '8px';
    thumbWrap.style.overflow = 'hidden';
    thumbWrap.style.backgroundColor = 'var(--color-bg-secondary, #f5f5f5)';

    const img = document.createElement('img');
    img.className  = 'wc-thumb-inline';
    img.src        = image;
    img.loading    = 'lazy';
    img.decoding   = 'async';
    img.alt        = '';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.addEventListener('error', () => thumbWrap.remove(), { once: true });
    
    thumbWrap.appendChild(img);
    
    // Insert row before snippet, then move snippet into row
    snippet.parentNode.insertBefore(row, snippet);
    row.appendChild(snippet);
    row.appendChild(thumbWrap);

  } else {
    // Full-width banner below title (layout 0)
    const title = cardEl.querySelector('.wc-title');
    if (!title) return;

    const wrap  = document.createElement('div');
    wrap.className = 'wc-thumb-full-wrap';
    wrap.style.marginTop = '10px';
    wrap.style.borderRadius = '10px';
    wrap.style.overflow = 'hidden';
    wrap.style.backgroundColor = 'var(--color-bg-secondary, #f5f5f5)';

    const img = document.createElement('img');
    img.className  = 'wc-thumb-full';
    img.src        = image;
    img.loading    = 'lazy';
    img.decoding   = 'async';
    img.alt        = '';
    img.style.width = '100%';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.addEventListener('error', () => wrap.remove(), { once: true });
    
    wrap.appendChild(img);
    title.parentNode.insertBefore(wrap, title.nextSibling);
  }
}

/* ── Result card ── */
function _buildCard(r, index) {
  let host = '', path = '';
  try {
    const u = new URL(r.url);
    host = u.hostname.replace(/^www\./, '');
    path = (host + u.pathname).replace(/\/$/, '').substring(0, 60);
  } catch (_) {
    host = r.url;
    path = r.url;
  }

  const fav1    = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`;
  const fav2    = `https://icons.duckduckgo.com/ip3/${host}.ico`;
  const snippet = r.content || r.snippet || r.description || r.summary || '';
  const layout  = _getLayout(index);

  const a  = document.createElement('a');
  a.className = 'wc-card';
  a.href      = _safeUrl(r.url);
  a.target    = '_blank';
  a.rel       = 'noopener noreferrer';
  a.innerHTML = `
    <div class="wc-meta">
      <div class="wc-fav-wrap">
        <img class="wc-fav" src="${_esc(fav1)}" width="16" height="16" loading="lazy" decoding="async" alt="">
      </div>
      <div class="wc-meta-text">
        <span class="wc-domain">${_esc(host)}</span>
        <span class="wc-path">${_esc(path)}</span>
      </div>
      <span class="wc-dots" aria-hidden="true">
        <svg viewBox="0 0 4 16" xmlns="http://www.w3.org/2000/svg">
          <circle cx="2" cy="2" r="1.5"/>
          <circle cx="2" cy="8" r="1.5"/>
          <circle cx="2" cy="14" r="1.5"/>
        </svg>
      </span>
    </div>
    <div class="wc-title">${_esc(r.title)}</div>
    ${snippet ? `<div class="wc-snippet">${_esc(snippet)}</div>` : ''}`;

  a.querySelector('.wc-fav').addEventListener('error', function () {
    if (this.src !== fav2) { this.src = fav2; }
    else { this.closest('.wc-fav-wrap').style.display = 'none'; }
  }, { once: true, passive: true });

  return { card: a, url: r.url, layout, index };
}

/* ── Knowledge Panel (infobox) ── */
function _buildInfobox(box) {
  if (!box?.title) return null;

  const sourceUrl = box.urls?.[0]?.url || '';
  let sourceHost  = '';
  try { sourceHost = new URL(sourceUrl).hostname.replace(/^www\./, ''); } catch (_) {}

  const sourceFav = sourceHost
    ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(sourceHost)}`
    : '';

  const el = document.createElement('div');
  el.className = 'wc-kg-card';
  el.innerHTML = `
    <div class="wc-kg-top">
      <div class="wc-kg-title-wrap">
        <div class="wc-kg-title">${_esc(box.title)}</div>
      </div>
      ${box.image ? `
        <div class="wc-kg-image-box">
          <img class="wc-kg-image"
               src="${_esc(box.image)}"
               loading="lazy"
               decoding="async"
               alt="${_esc(box.title)}"
               onerror="this.closest('.wc-kg-image-box').remove()">
        </div>` : ''}
    </div>
    ${box.content ? `<div class="wc-kg-desc">${_esc(box.content)}</div>` : ''}
    ${sourceUrl ? `
      <a class="wc-kg-source" href="${_safeUrl(sourceUrl)}" target="_blank" rel="noopener noreferrer">
        ${sourceFav
          ? `<span class="wc-kg-source-fav" style="background-image:url('${_esc(sourceFav)}')"></span>`
          : ''}
        <span class="wc-kg-source-text">${_esc(sourceHost)}</span>
      </a>` : ''}
    ${box.urls?.length > 1 ? `
      <div class="wc-sitelinks">
        ${box.urls.slice(1).map(u => `
          <a class="wc-sitelink" href="${_safeUrl(u.url)}" target="_blank" rel="noopener noreferrer">
            <span class="wc-sitelink-title">${_esc(u.title)}</span>
            <svg class="wc-sitelink-arrow" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </a>`).join('')}
      </div>` : ''}`;

  return el;
}

/* ── "People also search for" section ── */
function _buildRelated(suggestions) {
  if (!suggestions?.length) return null;

  const el   = document.createElement('div');
  el.className = 'wc-related';
  el.innerHTML = '<div class="wc-related-title">People also search for</div>';

  const list = document.createElement('div');
  list.className = 'wc-related-list';

  suggestions.forEach(query => {
    const btn = document.createElement('button');
    btn.className = 'wc-related-item';
    btn.innerHTML = `
      <svg class="wc-related-icon" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <span>${_esc(query)}</span>
      <svg class="wc-related-arrow" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <line x1="7" y1="17" x2="17" y2="7"/>
        <polyline points="7 7 17 7 17 17"/>
      </svg>`;
    btn.addEventListener('click', () => _triggerSearch(query), { passive: true });
    list.appendChild(btn);
  });

  el.appendChild(list);
  return el;
}

/* ── DDG autocomplete suggestions ── */
async function _fetchSuggestions(q) {
  try {
    const resp = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok ? resp.json() : [];
  } catch (_) { return []; }
}

/* ── Trigger a new search (used by related chips) ── */
function _triggerSearch(query) {
  const cb   = document.getElementById('cbInput');
  const pill = document.getElementById('pill');
  if (cb)   cb.value = query;
  if (pill) pill.classList.add('has-text');
  sessionStorage.setItem('atkyn_last_query', query);
  sessionStorage.removeItem('atkyn_web_results');
  _fetch(query);
}

/* ── Render results with progressive image loading ── */
async function _render(q, data) {
  const pc   = window._atkynPageContent;
  const frag = document.createDocumentFragment();

  const infobox = _buildInfobox(data.infobox);
  if (infobox) frag.appendChild(infobox);

  // Hide Wikipedia results when an infobox is already shown
  const results = data.infobox
    ? data.results.filter(r => !r.url.includes('wikipedia.org'))
    : data.results;

  const list = document.createElement('div');
  list.className = 'wc-list';
  
  // Build all cards first (without images)
  const cardData = results.map((r, i) => _buildCard(r, i));
  cardData.forEach(({ card }) => list.appendChild(card));
  
  frag.appendChild(list);
  pc.innerHTML = '';
  pc.appendChild(frag);
  window._atkynAnimateIn();

  // Progressive image loading: fetch all OG images in parallel
  // but inject them as they arrive (don't wait for all)
  const imagePromises = cardData.map(({ url, layout, index, card }) => 
    _fetchOg(url).then(image => {
      if (image) _injectOgImage(card, layout, image);
    })
  );

  // Fire and forget - don't block rendering
  Promise.allSettled(imagePromises);

  // Fetch suggestions in background
  _fetchSuggestions(q).then(suggestions => {
    const related = _buildRelated(suggestions);
    if (related) pc.appendChild(related);
  });
}

/* ── Fetch search results ── */
async function _fetch(q) {
  const pc = window._atkynPageContent;
  pc.innerHTML =
    '<div class="tab-skeleton">' +
    '<div class="sk-line"></div><div class="sk-line sk-short"></div>' +
    '<div class="sk-line"></div><div class="sk-line sk-short"></div>' +
    '</div>';

  try {
    const resp = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(8000), // Reduced from 10s
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
      ? { results, infobox: null }
      : { results, infobox: data.infobox || null };

    try { sessionStorage.setItem('atkyn_web_results', JSON.stringify({ q, ...payload })); } catch (_) {}
    await _render(q, payload);

  } catch (_) {
    pc.innerHTML = '<div class="tab-empty"><p>Could not load results. Try again.</p></div>';
  }
}

/* ── Sync chatbar input with current query ── */
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
      if (saved.q === q && saved.results?.length) { 
        _render(q, saved); 
        return; 
      }
    } catch (_) {}
  }

  if (q) { _fetch(q); return; }

  pc.innerHTML = '<div class="tab-empty"><p>Search something to see web results</p></div>';
}

window._atkynInit_web = _init;
_init();

}());
