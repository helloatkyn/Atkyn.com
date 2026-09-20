/* modules/news/news.js — multi-fallback debug version */
(function () {
  'use strict';

  var MAX = 20;

  var PROXIES = [
    function(rssUrl) {
      return 'https://rss-to-json-serverless-api.vercel.app/rssToJson?feedURL=' + encodeURIComponent(rssUrl);
    },
    function(rssUrl) {
      return 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(rssUrl) + '&count=' + MAX;
    }
  ];

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function timeAgo(dateStr) {
    try {
      var d = new Date(dateStr); if (isNaN(d)) return '';
      var diff = Date.now() - d.getTime();
      var m = Math.floor(diff/60000);
      if (m < 1) return 'just now';
      if (m < 60) return m + 'm ago';
      var h = Math.floor(m/60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h/24) + 'd ago';
    } catch(_) { return ''; }
  }

  function hostname(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch(_) { return ''; }
  }

  function stripTags(s) {
    return String(s).replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
  }

  function extractThumb(item) {
    if (item.thumbnail && item.thumbnail.startsWith('http')) return item.thumbnail;
    if (item.enclosure && item.enclosure.link && item.enclosure.link.startsWith('http')) return item.enclosure.link;
    var html = item.content || item.description || '';
    var m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && m[1] && m[1].startsWith('http')) return m[1];
    return '';
  }

  function getItems(data) {
    /* vercel proxy: { items: [...] } */
    /* rss2json:     { status:'ok', items: [...] } */
    if (Array.isArray(data.items) && data.items.length) return data.items;
    /* some proxies wrap in feed */
    if (data.feed && Array.isArray(data.feed.items)) return data.feed.items;
    return [];
  }

  function buildCard(item) {
    var card = document.createElement('a');
    card.className = 'news-card';
    card.href = item.link || item.url || '#';
    card.target = '_blank';
    card.rel = 'noopener noreferrer';

    var host = hostname(item.link || item.url || '');
    var ago  = timeAgo(item.pubDate || item.publishedDate || item.isoDate || '');
    var meta = [host, ago].filter(Boolean).join(' · ');
    var snippet = stripTags(item.description || item.content || item.summary || '');
    var thumb = extractThumb(item);

    if (thumb) { card.dataset.hasImg = '1'; card.classList.add('has-thumb'); }

    card.innerHTML =
      '<div class="news-card-body">'
      + '<div class="news-meta">'    + esc(meta)             + '</div>'
      + '<div class="news-title">'   + esc(item.title || '') + '</div>'
      + '<div class="news-snippet">' + esc(snippet)          + '</div>'
      + '</div>'
      + (thumb ? '<img class="news-thumb" src="' + esc(thumb) + '" loading="lazy" decoding="async" alt="" onerror="this.parentElement.classList.remove(\'has-thumb\');this.remove()">' : '');

    return card;
  }

  function showSkeleton(pc) {
    var html = '<div class="tab-skeleton">';
    for (var i = 0; i < 6; i++) {
      html += '<div class="sk-card"><div class="sk-line"></div><div class="sk-line"></div><div class="sk-line sk-short"></div></div>';
    }
    pc.innerHTML = html + '</div>';
  }

  function tryProxy(url, index) {
    if (index >= PROXIES.length) return Promise.reject(new Error('all proxies failed'));
    var apiUrl = PROXIES[index](url);
    console.log('[atkyn news] trying proxy', index, apiUrl);
    return fetch(apiUrl)
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        var items = getItems(data);
        if (!items.length) throw new Error('empty response from proxy ' + index);
        return items;
      })
      .catch(function(err) {
        console.warn('[atkyn news] proxy', index, 'failed:', err.message);
        return tryProxy(url, index + 1);
      });
  }

  window._atkynInit_news = function () {
    var pc = window._atkynPageContent;
    if (!pc) { console.error('[atkyn news] _atkynPageContent not found'); return; }

    var q = '';
    try { q = sessionStorage.getItem('atkyn_last_query') || ''; } catch(_) {}

    console.log('[atkyn news] init, query:', q);
    showSkeleton(pc);

    var rssUrl = q
      ? 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-IN&gl=IN&ceid=IN:en'
      : 'https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en';

    tryProxy(rssUrl, 0)
      .then(function(items) {
        items = items.slice(0, MAX);
        var list = document.createElement('div');
        list.className = 'news-list';
        items.forEach(function(item) { list.appendChild(buildCard(item)); });
        pc.innerHTML = '';
        pc.appendChild(list);
        if (typeof window._atkynAnimateIn === 'function') window._atkynAnimateIn();
      })
      .catch(function(err) {
        console.error('[atkyn news] all failed:', err);
        pc.innerHTML = '<div class="tab-empty"><p>Could not load news</p></div>';
      });
  };

  window._atkynInit_news();
}());
