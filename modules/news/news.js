/* modules/news/news.js — Google News style layout */
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

  /* Hero — first item, full width */
  function buildHero(item) {
    var a = document.createElement('a');
    a.className = 'news-hero';
    a.href   = item.url || '#';
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';

    var thumb = item.img_src || '';
    var ago   = timeAgo(item.publishedDate || '');

    a.innerHTML =
      (thumb
        ? '<img class="news-hero-img" src="' + esc(thumb) + '" alt="" loading="eager" decoding="async"'
          + ' onerror="this.style.display=\'none\'">'
        : '')
      + '<div class="news-hero-body">'
      + (item.source ? '<span class="news-source">' + esc(item.source) + '</span>' : '')
      + '<div class="news-title">' + esc(item.title || '') + '</div>'
      + (ago ? '<div class="news-time">' + esc(ago) + '</div>' : '')
      + '</div>';

    return a;
  }

  /* Regular card — thumbnail right */
  function buildCard(item) {
    var a = document.createElement('a');
    a.className = 'news-card';
    a.href   = item.url || '#';
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';

    var thumb = item.img_src || '';
    var ago   = timeAgo(item.publishedDate || '');

    a.innerHTML =
      '<div class="news-card-body">'
      + (item.source ? '<span class="news-source">' + esc(item.source) + '</span>' : '')
      + '<div class="news-title">' + esc(item.title || '') + '</div>'
      + (ago ? '<div class="news-time">' + esc(ago) + '</div>' : '')
      + '</div>'
      + (thumb
          ? '<img class="news-thumb" src="' + esc(thumb) + '" alt="" loading="lazy" decoding="async"'
            + ' onerror="this.remove()">'
          : '');

    return a;
  }

  function showSkeleton(pc) {
    var html =
      '<div class="tab-skeleton">'
      + '<div class="sk-hero"><div class="sk-hero-img"></div>'
      + '<div class="sk-hero-body"><div class="sk-line sk-src"></div>'
      + '<div class="sk-line"></div><div class="sk-line sk-short"></div></div></div>';

    for (var i = 0; i < 5; i++) {
      html += '<div class="sk-card">'
        + '<div class="sk-card-body"><div class="sk-line sk-src"></div>'
        + '<div class="sk-line"></div><div class="sk-line sk-short"></div></div>'
        + '<div class="sk-thumb"></div></div>';
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

        /* First item with image → hero */
        var heroIdx = -1;
        for (var i = 0; i < Math.min(results.length, 4); i++) {
          if (results[i].img_src) { heroIdx = i; break; }
        }

        results.forEach(function(item, idx) {
          if (idx === heroIdx) {
            list.appendChild(buildHero(item));
            var div = document.createElement('div');
            div.className = 'news-divider';
            list.appendChild(div);
          } else {
            list.appendChild(buildCard(item));
          }
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
