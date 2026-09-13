/* modules/news/news.js — News tab · Cloudflare Worker backend */
(function () {
  'use strict';

  /* Worker routes — deploy workers/news-worker.js → atkyn-news
     Pages route:  /api/news     → atkyn-news
                   /api/og-proxy → atkyn-news               */
  var NEWS_API  = '/api/news';
  var OG_PROXY  = '/api/og-proxy';
  var MAX       = 20;
  var OG_TO     = 4500;
  var OG_BATCH  = 4;

  /* ── helpers ─────────────────────────────────────────────── */
  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function timeAgo(dateStr) {
    try {
      var d = new Date(dateStr);
      if (isNaN(d)) return '';
      var diff = Date.now() - d.getTime();
      var m = Math.floor(diff / 60000);
      if (m < 1)  return 'just now';
      if (m < 60) return m + 'm ago';
      var h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h / 24) + 'd ago';
    } catch(_) { return ''; }
  }

  function hostname(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch(_) { return ''; }
  }

  /* ── OG proxy ────────────────────────────────────────────── */
  function fetchOG(url) {
    var ctrl  = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, OG_TO);
    return fetch(OG_PROXY + '?url=' + encodeURIComponent(url), { signal: ctrl.signal })
      .then(function(r) { clearTimeout(timer); return r.ok ? r.json() : null; })
      .then(function(d) { return (d && d.og && d.og.startsWith('http')) ? d.og : null; })
      .catch(function() { return null; });
  }

  function batchOG(results, cardEls) {
    var i = 0;
    function next() {
      if (i >= results.length) return;
      var slice = results.slice(i, i + OG_BATCH);
      i += OG_BATCH;
      return Promise.all(slice.map(function(item, j) {
        var card = cardEls[i - OG_BATCH + j];
        if (!card || card.dataset.hasImg === '1') return Promise.resolve();
        return fetchOG(item.url).then(function(og) {
          if (!og) return;
          var img = document.createElement('img');
          img.className = 'news-thumb'; img.loading = 'lazy';
          img.decoding  = 'async'; img.alt = ''; img.src = og;
          img.onerror = function() {
            this.parentElement.classList.remove('has-thumb'); this.remove();
          };
          card.appendChild(img);
          card.classList.add('has-thumb');
        });
      })).then(next);
    }
    return next();
  }

  /* ── card ────────────────────────────────────────────────── */
  function buildCard(item) {
    var card       = document.createElement('a');
    card.className = 'news-card';
    card.href      = item.url || '#';
    card.target    = '_blank';
    card.rel       = 'noopener noreferrer';

    var host  = item.source || hostname(item.url || '');
    var ago   = timeAgo(item.publishedDate || '');
    var meta  = [host, ago].filter(Boolean).join(' · ');

    var thumb = item.img_src || '';
    var tHtml = '';
    if (thumb && thumb.startsWith('http')) {
      tHtml = '<img class="news-thumb" src="' + esc(thumb) + '" '
        + 'loading="lazy" decoding="async" alt="" '
        + 'onerror="this.parentElement.classList.remove(\'has-thumb\');this.remove()">';
      card.dataset.hasImg = '1';
      card.classList.add('has-thumb');
    }

    card.innerHTML =
      '<div class="news-card-body">'
      + '<div class="news-meta">'    + esc(meta)              + '</div>'
      + '<div class="news-title">'   + esc(item.title || '')  + '</div>'
      + '<div class="news-snippet">' + esc(item.content || '') + '</div>'
      + '</div>' + tHtml;

    return card;
  }

  /* ── main ────────────────────────────────────────────────── */
  window._atkynInit_news = function () {
    var q  = sessionStorage.getItem('atkyn_last_query') || '';
    var pc = window._atkynPageContent;
    if (!pc) return;

    if (!q) {
      pc.innerHTML = '<div class="tab-empty"><p>Search something to see news</p></div>';
      return;
    }

    pc.innerHTML = '<div class="tab-skeleton">'
      + '<div class="sk-line"></div><div class="sk-line sk-short"></div>'
      + '<div class="sk-line"></div><div class="sk-line sk-short"></div>'
      + '</div>';

    fetch(NEWS_API + '?q=' + encodeURIComponent(q))
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        var results = (data.results || []).slice(0, MAX);
        if (!results.length) throw new Error('empty');

        var list = document.createElement('div');
        list.className = 'news-list';
        var cardEls = [];

        results.forEach(function(item) {
          var card = buildCard(item);
          list.appendChild(card);
          cardEls.push(card);
        });

        pc.innerHTML = '';
        pc.appendChild(list);
        if (typeof window._atkynAnimateIn === 'function') window._atkynAnimateIn();
        requestAnimationFrame(function() { batchOG(results, cardEls); });
      })
      .catch(function(err) {
        console.error('[atkyn news]', err);
        pc.innerHTML = '<div class="tab-empty"><p>Could not load news</p></div>';
      });
  };

  window._atkynInit_news();
}());
  
