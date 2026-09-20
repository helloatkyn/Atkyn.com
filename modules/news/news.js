/* modules/news/news.js — Serper news via /api/news */
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

    var meta = [item.source, timeAgo(item.publishedDate)].filter(Boolean).join(' · ');
    var thumb = item.img_src || '';

    if (thumb) {
      card.dataset.hasImg = '1';
      card.classList.add('has-thumb');
    }

    card.innerHTML =
      '<div class="news-card-body">'
      + '<div class="news-meta">'    + esc(meta)              + '</div>'
      + '<div class="news-title">'   + esc(item.title  || '') + '</div>'
      + '<div class="news-snippet">' + esc(item.snippet || '') + '</div>'
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

        var list = document.createElement('div');
        list.className = 'news-list';
        results.forEach(function(item) { list.appendChild(buildCard(item)); });

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
