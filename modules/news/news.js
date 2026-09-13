/* modules/news/news.js — News tab · CF Worker RSS proxy + OG images */
(function () {
  'use strict';

  /* ── Config ─────────────────────────────────────────────────
   * Both endpoints are served by the same Cloudflare Worker
   * (workers/news-worker.js). Add these routes in your Pages
   * project settings or wrangler.toml:
   *   /api/news       → atkyn-news worker
   *   /api/og-proxy   → atkyn-news worker
   * ─────────────────────────────────────────────────────────── */
  const NEWS_API  = '/api/news';
  const OG_PROXY  = '/api/og-proxy';

  const MAX_RESULTS  = 20;
  const OG_TIMEOUT   = 4500;
  const OG_BATCH     = 4;

  /* ── Helpers ─────────────────────────────────────────────── */
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _timeAgo(dateStr) {
    try {
      const diff = Date.now() - new Date(dateStr).getTime();
      const m    = Math.floor(diff / 60000);
      if (m < 1)  return 'just now';
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h ago`;
      return `${Math.floor(h / 24)}d ago`;
    } catch (_) { return ''; }
  }

  function _hostname(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
  }

  /* ── OG image fetching ───────────────────────────────────── */
  async function _fetchOG(url) {
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), OG_TIMEOUT);
      const r = await fetch(
        `${OG_PROXY}?url=${encodeURIComponent(url)}`,
        { signal: ctrl.signal }
      );
      clearTimeout(timer);
      if (!r.ok) return null;
      const d = await r.json();
      return (d && d.og && d.og.startsWith('http')) ? d.og : null;
    } catch (_) { return null; }
  }

  async function _batchOG(items, cardEls) {
    for (let i = 0; i < items.length; i += OG_BATCH) {
      const slice = items.slice(i, i + OG_BATCH);
      await Promise.all(slice.map(async (item, j) => {
        const idx  = i + j;
        const card = cardEls[idx];
        if (!card || card.dataset.hasImg === '1') return;

        const ogUrl = await _fetchOG(item.url);
        if (!ogUrl) return;

        const img       = document.createElement('img');
        img.className   = 'news-thumb';
        img.loading     = 'lazy';
        img.decoding    = 'async';
        img.alt         = '';
        img.src         = ogUrl;
        img.onerror     = function () {
          this.parentElement.classList.remove('has-thumb');
          this.remove();
        };
        card.appendChild(img);
        card.classList.add('has-thumb');
      }));
    }
  }

  /* ── Card builder ────────────────────────────────────────── */
  function _buildCard(item) {
    const card    = document.createElement('a');
    card.className = 'news-card';
    card.href      = item.url || '#';
    card.target    = '_blank';
    card.rel       = 'noopener noreferrer';

    const host   = _hostname(item.url || '');
    const source = item.source || host;
    const ago    = _timeAgo(item.publishedDate || '');
    const meta   = [source, ago].filter(Boolean).join(' · ');

    card.innerHTML =
      `<div class="news-card-body">` +
        `<div class="news-meta">${_esc(meta)}</div>` +
        `<div class="news-title">${_esc(item.title || '')}</div>` +
        `<div class="news-snippet">${_esc(item.content || '')}</div>` +
      `</div>`;

    return card;
  }

  /* ── Main ────────────────────────────────────────────────── */
  window._atkynInit_news = function () {
    const q  = sessionStorage.getItem('atkyn_last_query') || '';
    const pc = window._atkynPageContent;
    if (!pc) return;

    if (!q) {
      pc.innerHTML =
        '<div class="tab-empty"><p>Search something to see news</p></div>';
      return;
    }

    pc.innerHTML =
      '<div class="tab-skeleton">' +
        '<div class="sk-line"></div>' +
        '<div class="sk-line sk-short"></div>' +
        '<div class="sk-line"></div>' +
        '<div class="sk-line sk-short"></div>' +
      '</div>';

    fetch(`${NEWS_API}?q=${encodeURIComponent(q)}`)
      .then(r => r.ok ? r.json() : Promise.reject(`status ${r.status}`))
      .then(data => {
        const items = (data.results || []).slice(0, MAX_RESULTS);
        if (!items.length) throw new Error('empty');

        const list     = document.createElement('div');
        list.className = 'news-list';
        const cardEls  = [];

        items.forEach(item => {
          const card = _buildCard(item);
          list.appendChild(card);
          cardEls.push(card);
        });

        pc.innerHTML = '';
        pc.appendChild(list);
        if (typeof window._atkynAnimateIn === 'function') {
          window._atkynAnimateIn();
        }

        /* OG images in background after paint */
        requestAnimationFrame(() => _batchOG(items, cardEls));
      })
      .catch(err => {
        console.error('[news]', err);
        if (pc) {
          pc.innerHTML =
            '<div class="tab-empty"><p>Could not load news</p></div>';
        }
      });
  };

  window._atkynInit_news();
}());
          
