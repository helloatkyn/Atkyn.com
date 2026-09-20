/* modules/news/news.js — Google News RSS via vercel serverless proxy */
(function () {
  'use strict';

  var PROXY = 'https://rss-to-json-serverless-api.vercel.app/rssToJson?feedURL=';
  var MAX   = 20;

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

  function stripTags(s) {
    return String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  function extractThumb(item) {
    if (item.thumbnail && item.thumbnail.startsWith('http')) return item.thumbnail;
    if (item.enclosure && item.enclosure.link && item.enclosure.link.startsWith('http')) return item.enclosure.link;
    var html = item.content || item.description || '';
    var m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && m[1] && m[1].startsWith('http')) return m[1];
    return '';
  }

  function buildCard(item) {
    var card       = document.createElement('a');
    card.className = 'news-card';
    card.href      = item.link || '#';
    card.target    = '_blank';
    card.rel       = 'noopener noreferrer';

    var host    = hostname(item.link || '');
    var ago     = timeAgo(item.pubDate || '');
    var meta    = [host, ago].filter(Boolean).join(' · ');
    var snippet = stripTags(item.description || item.content || '');
    var thumb   = extractThumb(item);

    if (thumb) {
      card.dataset.hasImg = '1';
      card.classList.add('has-thumb');
    }

    card.innerHTML =
      '<div class="news-card-body">'
      + '<div class="news-meta">'    + esc(meta)             + '</div>'
      + '<div class="news-title">'   + esc(item.title || '') + '</div>'
      + '<div class="news-snippet">' + esc(snippet)          + '</div>'
      + '</div>'
      + (thumb
          ? '<img class="news-thumb" src="' + esc(thumb) + '" loading="lazy" decoding="async" alt=""'
            + ' onerror="this.parentElement.classList.remove(\'has-thumb\');this.remove()">'
          : '');

    return card;
  }

  function showSkeleton(pc) {
    var html = '<div class="tab-skeleton">';
    for (var i = 0; i < 6; i++) {
      html += '<div class="sk-card">'
        + '<div class="sk-line"></div>'
        + '<div class="sk-line"></div>'
        + '<div class="sk-line sk-short"></div>'
        + '</div>';
    }
    html += '</div>';
    pc.innerHTML = html;
  }

  window._atkynInit_news = function () {
    var q  = sessionStorage.getItem('atkyn_last_query') || '';
    var pc = window._atkynPageContent;
    if (!pc) return;

    showSkeleton(pc);

    var rssUrl = q
      ? 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-IN&gl=IN&ceid=IN:en'
      : 'https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en';

    var apiUrl = PROXY + encodeURIComponent(rssUrl);

    fetch(apiUrl)
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        /* vercel proxy returns { items: [...] } */
        var items = (data.items || []).slice(0, MAX);
        if (!items.length) throw new Error('empty');

        var list = document.createElement('div');
        list.className = 'news-list';
        items.forEach(function(item) {
          list.appendChild(buildCard(item));
        });

        pc.innerHTML = '';
        pc.appendChild(list);
        if (typeof window._atkynAnimateIn === 'function') window._atkynAnimateIn();
      })
      .catch(function(err) {
        console.error('[atkyn news]', err);
        pc.innerHTML = '<div class="tab-empty"><p>Could not load news</p></div>';
      });
  };

  window._atkynInit_news();
}());
