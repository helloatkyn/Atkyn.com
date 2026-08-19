/* ═══════════════════════════════════════════════════════════════
   modules/web/web.js — Atkyn Web tab
   Fetches from /api/search (SearXNG only — zero AI calls).
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

/* ── Sitelinks builder ── */
function _buildSitelinks(sitelinks) {
  if (!Array.isArray(sitelinks) || !sitelinks.length) return '';
  const items = sitelinks.slice(0, 4).map(sl =>
    `<a class="wc-sitelink" href="${_esc(_safeUrl(sl.url))}" target="_blank" rel="noopener noreferrer">${_esc(sl.title)}</a>`
  ).join('');
  return `<div class="wc-sitelinks">${items}</div>`;
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
  const fav2 = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`;
  const thumb = r.image
    ? `<img class="wc-thumb" src="${_esc(r.image)}" loading="lazy" decoding="async" alt=""
            onerror="this.closest('.wc-thumb-wrap').remove()">`
    : '';

  const sitelinksHtml = _buildSitelinks(r.sitelinks);

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

  /* sitelinks: stop propagation so clicking a chip doesn't follow card href */
  if (sitelinksHtml) {
    a.querySelectorAll('.wc-sitelink').forEach(chip => {
      chip.addEventListener('click', e => e.stopPropagation(), { passive: false });
    });
  }

  a.querySelector('.wc-fav').addEventListener('error', function () {
    if (this.src !== fav2) { this.src = fav2; }
    else { this.closest('.wc-fav-wrap').style.display = 'none'; }
  }, { passive: true });

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

/* ── Fetch from /api/search (SearXNG, no AI) ── */
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

/* ── Autocomplete / Suggestions ── */
let _suggestTimer   = null;
let _suggestActive  = false;
let _suggestIdx     = -1;
let _suggestItems   = [];

function _getDropdown() {
  let el = document.getElementById('atkyn-suggest-drop');
  if (!el) {
    el = document.createElement('div');
    el.id = 'atkyn-suggest-drop';
    el.className = 'wc-suggest-drop';
    el.setAttribute('role', 'listbox');
    document.body.appendChild(el);
  }
  return el;
}

function _positionDropdown(input) {
  const drop = _getDropdown();
  const rect = input.getBoundingClientRect();
  drop.style.left  = rect.left  + 'px';
  drop.style.top   = (rect.top - 4) + 'px';   /* appear just above input */
  drop.style.width = rect.width + 'px';
  drop.style.transform = 'translateY(-100%)';
}

function _hideSuggestions() {
  const drop = document.getElementById('atkyn-suggest-drop');
  if (drop) { drop.innerHTML = ''; drop.classList.remove('visible'); }
  _suggestActive = false;
  _suggestIdx    = -1;
  _suggestItems  = [];
}

function _showSuggestions(suggestions, input) {
  const drop = _getDropdown();
  _suggestItems = suggestions;
  _suggestIdx   = -1;

  if (!suggestions.length) { _hideSuggestions(); return; }

  _positionDropdown(input);

  drop.innerHTML = suggestions.map((s, i) =>
    `<div class="wc-suggest-item" role="option" data-idx="${i}">
      <svg class="wc-suggest-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <span>${_esc(s)}</span>
    </div>`
  ).join('');

  drop.classList.add('visible');
  _suggestActive = true;

  drop.querySelectorAll('.wc-suggest-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      const idx = +item.dataset.idx;
      _selectSuggestion(suggestions[idx], input);
    });
  });
}

function _highlightItem(idx) {
  const drop  = document.getElementById('atkyn-suggest-drop');
  if (!drop) return;
  const items = drop.querySelectorAll('.wc-suggest-item');
  items.forEach((el, i) => el.classList.toggle('active', i === idx));
}

function _selectSuggestion(text, input) {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  _hideSuggestions();
  /* trigger search */
  const pill = document.getElementById('pill');
  if (pill) pill.classList.toggle('has-text', text.length > 0);
  /* fire search same way chatbar does */
  const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
  input.dispatchEvent(ev);
}

async function _fetchSuggestions(q, input) {
  if (!q || q.length < 2) { _hideSuggestions(); return; }
  try {
    /* SearXNG autocomplete endpoint */
    const base = window._atkynSearxBase || '';   /* set in core.js or worker */
    const url  = base
      ? `${base}/autocomplete?q=${encodeURIComponent(q)}&format=json`
      : `/api/autocomplete?q=${encodeURIComponent(q)}`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return;
    const data = await resp.json();

    /* SearXNG returns [query, [suggestions]] */
    let suggestions = [];
    if (Array.isArray(data) && Array.isArray(data[1])) {
      suggestions = data[1].slice(0, 6);
    } else if (Array.isArray(data)) {
      suggestions = data.slice(0, 6);
    }

    if (_suggestActive !== false || document.activeElement === input) {
      _showSuggestions(suggestions, input);
    }
  } catch (_) { /* silent fail */ }
}

function _attachSuggestToInput(input) {
  if (!input || input._atkynSuggestBound) return;
  input._atkynSuggestBound = true;

  input.addEventListener('input', () => {
    clearTimeout(_suggestTimer);
    const q = input.value.trim();
    if (!q) { _hideSuggestions(); return; }
    _suggestTimer = setTimeout(() => _fetchSuggestions(q, input), 200);
  });

  input.addEventListener('keydown', e => {
    if (!_suggestActive || !_suggestItems.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _suggestIdx = Math.min(_suggestIdx + 1, _suggestItems.length - 1);
      _highlightItem(_suggestIdx);
      if (_suggestIdx >= 0) input.value = _suggestItems[_suggestIdx];
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _suggestIdx = Math.max(_suggestIdx - 1, -1);
      _highlightItem(_suggestIdx);
      if (_suggestIdx >= 0) input.value = _suggestItems[_suggestIdx];
    } else if (e.key === 'Enter') {
      if (_suggestIdx >= 0) {
        e.stopImmediatePropagation();
        _selectSuggestion(_suggestItems[_suggestIdx], input);
      } else {
        _hideSuggestions();
      }
    } else if (e.key === 'Escape') {
      _hideSuggestions();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(_hideSuggestions, 150);
  });

  window.addEventListener('resize', () => {
    if (_suggestActive) _positionDropdown(input);
  });
}

/* ── Fill chatbar with current query ── */
function _syncChatbar(q) {
  const cb  = document.getElementById('cbInput');
  const pll = document.getElementById('pill');
  if (!cb || !pll) return;
  cb.value = q;
  pll.classList.toggle('has-text', q.length > 0);
  _attachSuggestToInput(cb);   /* attach suggestions to chatbar */
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
