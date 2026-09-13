/* modules/news/news.js — News tab · Google RSS + OG images */
(function () {
  'use strict';

  /* ── Config ─────────────────────────────────────────────── */
  const RSS2JSON   = 'https://api.rss2json.com/v1/api.json';
  const GOOGLE_RSS = 'https://news.google.com/rss/search?q={Q}&hl=en-IN&gl=IN&ceid=IN:en';

  /*
   * OG-proxy Worker URL — deploy workers/og-proxy.js to Cloudflare and put
   * its URL here.  The Worker fetches the article page and returns JSON:
   *   { og: "https://..." }
   * If you haven't deployed it yet set OG_PROXY = '' to skip OG fetching.
   */
  const OG_PROXY = '/api/og-proxy';   /* your CF Worker route */

  const MAX_RESULTS  = 20;
  const OG_TIMEOUT   = 4000;          /* ms — skip slow pages */
  const OG_BATCH     = 4;             /* parallel OG requests at a time */

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

  /*
   * Google RSS item.enclosure sometimes carries an image; rss2json also
   * exposes item.thumbnail.  Use those before hitting the OG proxy.
   */
  function _builtinImage(item) {
    if (item.enclosure && item.enclosure.link && /\.(jpe?g|png|webp|gif)/i.test(item.enclosure.link)) {
      return item.enclosure.link;
    }
    if (item.thumbnail && item.thumbnail.startsWith('http')) {
      return item.thumbnail;
    }
    return null;
  }

  /* ── OG image fetching ───────────────────────────────────── */
  async function _fetchOG(url) {
    if (!OG_PROXY) return null;
    try {
      const ctrl = new AbortController();
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

  /* Run OG fetches in batches so we don't hammer the proxy */
  async function _batchOG(items, cardEls) {
    for (let i = 0; i < items.length; i += OG_BATCH) {
      const slice = items.slice(i, i + OG_BATCH);
      await Promise.all(slice.map(async (item, j) => {
        const idx  = i + j;
        const card = cardEls[idx];
        if (!card) return;

        /* Already has an image from RSS feed — skip proxy */
        if (card.dataset.hasImg === '1') return;

        const ogUrl = await _fetchOG(item.link);
        if (!ogUrl) return;

        /* Inject thumb into the card */
        const img  = document.createElement('img');
        img.className   = 'news-thumb';
        img.loading     = 'lazy';
        img.decoding    = 'async';
        img.alt         = '';
        img.src         = ogUrl;
        img.onerror     = function () { this.remove(); };
        card.appendChild(img);
        card.classList.add('has-thumb');
      }));
    }
  }

  /* ── Main render ─────────────────────────────────────────── */
  window._atkynInit_news = function () {
    const q  = sessionStorage.getItem('atkyn_last_query') || '';
    const pc = window._atkynPageContent;
    if (!pc) return;

    if (!q) {
      pc.innerHTML =
        '<div class="tab-empty"><p>Search something to see news</p></div>';
      return;
    }

    /* Skeleton */
    pc.innerHTML =
      '<div class="tab-skeleton">' +
        '<div class="sk-line"></div>' +
        '<div class="sk-line sk-short"></div>' +
        '<div class="sk-line"></div>' +
        '<div class="sk-line sk-short"></div>' +
      '</div>';

    const rssUrl = GOOGLE_RSS.replace('{Q}', encodeURIComponent(q));
    const apiUrl = `${RSS2JSON}?rss_url=${encodeURIComponent(rssUrl)}&count=${MAX_RESULTS}`;

    fetch(apiUrl)
      .then(r => r.ok ? r.json() : Promise.reject('fetch-failed'))
      .then(data => {
        const items = (data.items || []).slice(0, MAX_RESULTS);
        if (!items.length) throw new Error('empty');

        const list    = document.createElement('div');
        list.className = 'news-list';

        const cardEls = [];

        items.forEach(item => {
          const card    = document.createElement('a');
          card.className = 'news-card';
          card.href      = item.link || '#';
          card.target    = '_blank';
          card.rel       = 'noopener noreferrer';

          const host    = _hostname(item.link || '');
          const ago     = _timeAgo(item.pubDate || '');
          const builtIn = _builtinImage(item);

          let thumbHtml = '';
          if (builtIn) {
            thumbHtml = `<img class="news-thumb" src="${_esc(builtIn)}" loading="lazy" decoding="async" alt="" onerror="this.parentElement.classList.remove('has-thumb');this.remove()">`;
            card.dataset.hasImg = '1';
            card.classList.add('has-thumb');
          }

          card.innerHTML = `
            <div class="news-card-body">
              <div class="news-meta">${_esc(host)}${ago ? ` · ${ago}` : ''}</div>
              <div class="news-title">${_esc(item.title || '')}</div>
              <div class="news-snippet">${_esc(item.description || item.content || '')}</div>
            </div>
            ${thumbHtml}`;

          list.appendChild(card);
          cardEls.push(card);
        });

        pc.innerHTML = '';
        pc.appendChild(list);
        if (typeof window._atkynAnimateIn === 'function') {
          window._atkynAnimateIn();
        }

        /* Fire OG fetches in the background after paint */
        requestAnimationFrame(() => {
          _batchOG(items, cardEls);
        });
      })
      .catch(() => {
        if (pc) {
          pc.innerHTML =
            '<div class="tab-empty"><p>Could not load news</p></div>';
        }
      });
  };

  window._atkynInit_news();
}());
