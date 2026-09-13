/* modules/news/news.js — News tab · SearXNG public instance (baresearch.org) */
(function () {
  'use strict';

  /*
   * SearXNG instance — baresearch.org
   * 100% uptime, A+ TLS, A+ CSP, no rate-limit issues on public traffic.
   * Swap URL if this instance ever goes down (check searx.space for alternatives).
   * We use ?format=json&categories=news so we get structured JSON directly —
   * no proxy, no API key, no CORS issue (SearXNG sets CORS headers).
   */
  const SEARX     = 'https://baresearch.org/search';
  const MAX       = 20;
  const OG_PROXY  = '/api/og-proxy';   /* workers/news-worker.js route */
  const OG_TO     = 4500;
  const OG_BATCH  = 4;

  /* ── helpers ──────────────────────────────────────────────── */
  function _esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _timeAgo(dateStr) {
    try {
      const d = new Date(dateStr);
      if (isNaN(d)) return '';
      const diff = Date.now() - d.getTime();
      const m = Math.floor(diff / 60000);
      if (m < 1)  return 'just now';
      if (m < 60) return m + 'm ago';
      const h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h / 24) + 'd ago';
    } catch (_) { return ''; }
  }

  function _hostname(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch (_) { return ''; }
  }

  /* ── OG proxy (background) ────────────────────────────────── */
  async function _fetchOG(url) {
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), OG_TO);
      const r = await fetch(OG_PROXY + '?url=' + encodeURIComponent(url),
        { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) return null;
      const d = await r.json();
      return (d && d.og && d.og.startsWith('http')) ? d.og : null;
    } catch (_) { return null; }
  }

  async function _batchOG(results, cardEls) {
    for (var i = 0; i < results.length; i += OG_BATCH) {
      await Promise.all(
        results.slice(i, i + OG_BATCH).map(function(item, j) {
          var idx  = i + j;
          var card = cardEls[idx];
          if (!card || card.dataset.hasImg === '1') return Promise.resolve();
          return _fetchOG(item.url).then(function(og) {
            if (!og) return;
            var img       = document.createElement('img');
            img.className = 'news-thumb';
            img.loading   = 'lazy';
            img.decoding  = 'async';
            img.alt       = '';
            img.src       = og;
            img.onerror   = function() {
              this.parentElement.classList.remove('has-thumb');
              this.remove();
            };
            card.appendChild(img);
            card.classList.add('has-thumb');
          });
        })
      );
    }
  }

  /* ── card ─────────────────────────────────────────────────── */
  function _buildCard(item) {
    var card       = document.createElement('a');
    card.className = 'news-card';
    card.href      = item.url || '#';
    card.target    = '_blank';
    card.rel       = 'noopener noreferrer';

    var host   = _hostname(item.url || '');
    var source = item.publishedDate ? '' : '';
    /* SearXNG returns item.parsed_url[1] as hostname, but url is reliable */
    var pub    = item.publishedDate || item.pubDate || '';
    var ago    = _timeAgo(pub);
    var meta   = [host, ago].filter(Boolean).join(' · ');

    /* SearXNG news results sometimes carry item.img_src */
    var thumb = item.img_src || '';
    var thumbHtml = '';
    if (thumb && thumb.startsWith('http')) {
      thumbHtml = '<img class="news-thumb" src="' + _esc(thumb) + '" '
        + 'loading="lazy" decoding="async" alt="" '
        + 'onerror="this.parentElement.classList.remove(\'has-thumb\');this.remove()">';
      card.dataset.hasImg = '1';
      card.classList.add('has-thumb');
    }

    card.innerHTML =
      '<div class="news-card-body">'
        + '<div class="news-meta">'    + _esc(meta)              + '</div>'
        + '<div class="news-title">'   + _esc(item.title || '')  + '</div>'
        + '<div class="news-snippet">' + _esc(item.content || '') + '</div>'
      + '</div>'
      + thumbHtml;

    return card;
  }

  /* ── main ─────────────────────────────────────────────────── */
  window._atkynInit_news = function () {
    var q  = sessionStorage.getItem('atkyn_last_query') || '';
    var pc = window._atkynPageContent;
    if (!pc) return;

    if (!q) {
      pc.innerHTML = '<div class="tab-empty"><p>Search something to see news</p></div>';
      return;
    }

    pc.innerHTML =
      '<div class="tab-skeleton">'
      + '<div class="sk-line"></div><div class="sk-line sk-short"></div>'
      + '<div class="sk-line"></div><div class="sk-line sk-short"></div>'
      + '</div>';

    var url = SEARX
      + '?q='          + encodeURIComponent(q)
      + '&categories=' + encodeURIComponent('news')
      + '&format=json'
      + '&language=en'
      + '&pageno=1';

    fetch(url)
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        var results = (data.results || []).slice(0, MAX);
        if (!results.length) throw new Error('empty');

        var list       = document.createElement('div');
        list.className = 'news-list';
        var cardEls    = [];

        results.forEach(function(item) {
          var card = _buildCard(item);
          list.appendChild(card);
          cardEls.push(card);
        });

        pc.innerHTML = '';
        pc.appendChild(list);
        if (typeof window._atkynAnimateIn === 'function') window._atkynAnimateIn();

        /* OG images in background */
        requestAnimationFrame(function() { _batchOG(results, cardEls); });
      })
      .catch(function(err) {
        console.error('[atkyn news]', err);
        pc.innerHTML = '<div class="tab-empty"><p>Could not load news</p></div>';
      });
  };

  window._atkynInit_news();
}());
