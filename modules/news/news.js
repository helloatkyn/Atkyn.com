/* modules/news/news.js — Masonry grid news layout */
(function () {
  'use strict';

  var NEWS_API = '/api/news';
  var MAX      = 20;

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function timeAgo(dateStr) {
    try {
      var d = new Date(dateStr);
      if (isNaN(d)) return dateStr || '';
      var diff = Date.now() - d.getTime();
      var m = Math.floor(diff / 60000);
      if (m < 1)  return 'just now';
      if (m < 60) return m + 'm ago';
      var h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h / 24) + 'd ago';
    } catch(_) { return dateStr || ''; }
  }

  function buildCard(item) {
    var card = document.createElement('a');
    card.className = 'news-card';
    card.href   = item.url || '#';
    card.target = '_blank';
    card.rel    = 'noopener noreferrer';

    var thumb = item.img_src || '';
    var ago   = timeAgo(item.publishedDate || '');

    card.innerHTML =
      (thumb
        ? '<div class="news-img-wrap"><img class="news-img" src="' + esc(thumb)
          + '" alt="" loading="lazy" decoding="async"'
          + ' onerror="this.closest(\'.news-img-wrap\').remove()"></div>'
        : '')
      + '<div class="news-body">'
      + (item.source ? '<span class="news-source">' + esc(item.source) + '</span>' : '')
      + '<div class="news-title">' + esc(item.title || '') + '</div>'
      + (ago ? '<div class="news-time">' + esc(ago) + '</div>' : '')
      + '</div>';

    return card;
  }

  function showSkeleton(pc) {
    var html = '<div class="news-grid">';
    for (var i = 0; i < 6; i++) {
      html += '<div class="news-card sk-card">'
        + '<div class="sk-img"></div>'
        + '<div class="news-body">'
        + '<div class="sk-line sk-src"></div>'
        + '<div class="sk-line"></div>'
        + '<div class="sk-line sk-short"></div>'
        + '</div></div>';
    }
    pc.innerHTML = html + '</div>';
  }

  window._atkynInit_news = function () {
    var pc = window._atkynPageContent;
    if (!pc) return;

    var q = '';
    try { q = sessionStorage.getItem('atkyn_last_query') || ''; } catch(_) {}

    if (!q) {
      pc.innerHTML = '<div class="tab-empty"><p>Search something to see news</p></div>';
      return;
    }

    showSkeleton(pc);

    fetch(NEWS_API + '?q=' + encodeURIComponent(q))
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        var results = (data.results || []).slice(0, MAX);
        if (!results.length) throw new Error('empty');

        var grid = document.createElement('div');
        grid.className = 'news-grid';
        results.forEach(function(item) { grid.appendChild(buildCard(item)); });

        pc.innerHTML = '';
        pc.appendChild(grid);
        if (typeof window._atkynAnimateIn === 'function') window._atkynAnimateIn();
      })
      .catch(function(err) {
        console.error('[atkyn news]', err);
        pc.innerHTML = '<div class="tab-empty"><p>Could not load news</p></div>';
      });
  };

  window._atkynInit_news();
}());
