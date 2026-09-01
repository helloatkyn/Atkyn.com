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
  try {
    const p = new URL(u);
    return (p.protocol === 'https:' || p.protocol === 'http:') ? u : '#';
  } catch (_) { return '#'; }
};

const BALLOON_GIF = 'https://cdnl.iconscout.com/lottie/premium/thumb/hot-air-balloon-animation-gif-download-7071388.gif';

/* ── Empty state HTML ── */
function _emptyHTML(type) {
  const copy = {
    idle:  { title: 'What are you looking for?',        sub: 'Type a query above to search the web',          btn: null },
    empty: { title: 'No results found',                 sub: 'Try different keywords or check your spelling',  btn: null },
    error: { title: 'Could not load results',           sub: 'Check your connection and try again',            btn: 'Try again' }
  };
  const c = copy[type];
  return `
    <div class="wc-empty" id="wc-empty-root" data-type="${type}">
      <img class="wc-empty-balloon" src="${BALLOON_GIF}" alt="" aria-hidden="true" draggable="false">
      <p class="wc-empty-title">${c.title}</p>
      <p class="wc-empty-sub">${c.sub}</p>
      ${c.btn ? `<button class="wc-empty-retry" id="wc-empty-retry">${c.btn}</button>` : ''}
    </div>`;
}

/* ── GSAP animate empty state ── */
function _animateEmpty(type) {
  function run() {
    if (!window.gsap) { setTimeout(run, 80); return; }
    const root    = document.getElementById('wc-empty-root');
    const balloon = root && root.querySelector('.wc-empty-balloon');
    const title   = root && root.querySelector('.wc-empty-title');
    const sub     = root && root.querySelector('.wc-empty-sub');
    const btn     = root && root.querySelector('.wc-empty-retry');
    if (!root || !balloon) return;

    const gsap = window.gsap;
    let floatTween = null;

    /* container fade in */
    gsap.fromTo(root,
      { opacity: 0 },
      { opacity: 1, duration: 0.4, ease: 'power2.out' }
    );

    /* balloon drops in from top */
    gsap.fromTo(balloon,
      { y: -40, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', delay: 0.1 }
    );

    /* text slides up */
    gsap.fromTo([title, sub].filter(Boolean),
      { y: 14, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.45, ease: 'power2.out', delay: 0.5, stagger: 0.1 }
    );

    if (btn) {
      gsap.fromTo(btn,
        { y: 10, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.35, ease: 'power2.out', delay: 0.75 }
      );
    }

    /* gentle float loop on balloon */
    gsap.delayedCall(0.8, () => {
      floatTween = gsap.to(balloon, {
        y: -10,
        duration: 2.2,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1
      });
    });

    /* ── Keyboard smooth fix ──
       Core.js chatArea visibility check (line 264) skips scroll
       anchor on web tab. We fix by snapping scrollHost to 0 on
       input focus so keyboard open feels smooth — no jump. */
    const cbInput    = document.getElementById('cbInput');
    const scrollHost = document.getElementById('scrollHost');

    function _onFocus() {
      if (floatTween) floatTween.pause();
      if (scrollHost) scrollHost.scrollTop = 0;
    }

    function _onBlur() {
      setTimeout(() => {
        if (floatTween) floatTween.resume();
      }, 320);
    }

    if (cbInput) {
      cbInput.addEventListener('focus', _onFocus, { passive: true });
      cbInput.addEventListener('blur',  _onBlur,  { passive: true });

      const tabBar = document.getElementById('tabBar');
      if (tabBar) {
        tabBar.addEventListener('click', () => {
          cbInput.removeEventListener('focus', _onFocus);
          cbInput.removeEventListener('blur',  _onBlur);
        }, { once: true, passive: true });
      }
    }

    /* retry button wiring */
    if (btn) {
      btn.addEventListener('click', () => {
        const q = sessionStorage.getItem('atkyn_last_query') || '';
        if (q) { sessionStorage.removeItem('atkyn_web_results'); _fetch(q); }
      }, { passive: true });
    }
  }

  if (!window.gsap) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/gsap@3.15/dist/gsap.min.js';
    s.onload = run;
    document.head.appendChild(s);
  } else {
    run();
  }
}

/* ── Fetch OG image from worker ── */
function _fetchOg(url) {
  return fetch(`/api/og?url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(6000),
  })
    .then(r => r.ok ? r.json() : null)
    .then(d => d?.image || null)
    .catch(() => null);
}

/* ── Inject image into result card — layout decided by aspect ratio ── */
function _injectOgImage(cardEl, image) {
  if (!image) return;

  const title = cardEl.querySelector('.wc-title');
  const wrap  = document.createElement('div');
  wrap.className = 'wc-thumb-full-wrap';

  const img = document.createElement('img');
  img.className = 'wc-thumb-full';
  img.src       = image;
  img.loading   = 'lazy';
  img.decoding  = 'async';
  img.alt       = '';

  wrap.appendChild(img);
  if (title?.nextSibling) {
    title.parentNode.insertBefore(wrap, title.nextSibling);
  } else if (title) {
    title.parentNode.appendChild(wrap);
  }

  img.addEventListener('load', () => {
    const ratio = img.naturalWidth / img.naturalHeight;
    if (ratio < 1.3) {
      wrap.remove();
      img.className = 'wc-thumb-inline';

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'wc-thumb-inline-wrap';
      thumbWrap.appendChild(img);

      const snippet = cardEl.querySelector('.wc-snippet');
      const row = document.createElement('div');
      row.className = 'wc-inline-row';

      if (snippet) {
        snippet.parentNode.insertBefore(row, snippet);
        row.appendChild(snippet);
      }
      row.appendChild(thumbWrap);
    }
  }, { once: true });

  img.addEventListener('error', () => wrap.remove(), { once: true });
}

/* ── Result card ── */
function _buildCard(r) {
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

  if (r.image) {
    _injectOgImage(a, r.image);
  } else {
    _fetchOg(r.url).then(img => _injectOgImage(a, img));
  }

  return a;
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

  const el = document.createElement('div');
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
      signal: AbortSignal.timeout(4000),
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

/* ── Render results into page ── */
function _render(q, data) {
  const pc   = window._atkynPageContent;
  const frag = document.createDocumentFragment();

  const infobox = _buildInfobox(data.infobox);
  if (infobox) frag.appendChild(infobox);

  const results = data.infobox
    ? data.results.filter(r => !r.url.includes('wikipedia.org'))
    : data.results;

  const list = document.createElement('div');
  list.className = 'wc-list';
  results.forEach(r => list.appendChild(_buildCard(r)));
  frag.appendChild(list);

  pc.innerHTML = '';
  pc.appendChild(frag);
  window._atkynAnimateIn();

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
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    const results = Array.isArray(data) ? data : (data.results || []);
    if (!results.length) {
      pc.innerHTML = _emptyHTML('empty');
      _animateEmpty('empty');
      return;
    }

    const payload = Array.isArray(data)
      ? { results, infobox: null }
      : { results, infobox: data.infobox || null };

    try { sessionStorage.setItem('atkyn_web_results', JSON.stringify({ q, ...payload })); } catch (_) {}
    _render(q, payload);

  } catch (_) {
    pc.innerHTML = _emptyHTML('error');
    _animateEmpty('error');
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
      if (saved.q === q && saved.results?.length) { _render(q, saved); return; }
    } catch (_) {}
  }

  if (q) { _fetch(q); return; }

  pc.innerHTML = _emptyHTML('idle');
  _animateEmpty('idle');
}

window._atkynInit_web = _init;
_init();

}());
                                       
