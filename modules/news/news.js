/* modules/news/news.js */
(function () {
  'use strict';

  var NEWS_API = '/api/news';
  var OG_API   = '/api/news-og';
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

  /* ── OG fetch — in-memory cache per session ── */
  var _ogCache = {};

  function fetchOg(articleUrl) {
    if (!articleUrl) return Promise.resolve(null);
    if (_ogCache[articleUrl] !== undefined) return Promise.resolve(_ogCache[articleUrl]);
    return fetch(OG_API + '?url=' + encodeURIComponent(articleUrl))
      .then(function(r) { return r.ok ? r.json() : { og: null }; })
      .then(function(data) {
        var img = (data && data.og) ? data.og : null;
        _ogCache[articleUrl] = img;
        return img;
      })
      .catch(function() { _ogCache[articleUrl] = null; return null; });
  }

  /* ── Hydrate img.src with OG once fetched ──
     Shows nothing until OG arrives — no low-res placeholder flash.
     If OG fails, removes the img element entirely.              */
  function hydrateImg(imgEl) {
    var articleUrl = imgEl.dataset.url;
    fetchOg(articleUrl).then(function(ogSrc) {
      if (!imgEl.parentNode) return;      /* card already removed */
      if (!ogSrc) { imgEl.remove(); return; }
      imgEl.onerror = function() { imgEl.remove(); };
      imgEl.src = ogSrc;
    });
  }

  /* ── Build a news card ── */
  function buildCard(item) {
    var a = document.createElement('a');
    a.className = 'news-card';
    a.href   = item.url || '#';
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';

    var ago = timeAgo(item.publishedDate || '');

    /* Text body */
    var body = document.createElement('div');
    body.className = 'news-card-body';
    body.innerHTML =
      (item.source ? '<span class="news-source">' + esc(item.source) + '</span>' : '')
      + '<div class="news-title">' + esc(item.title || '') + '</div>'
      + (ago ? '<div class="news-time">' + esc(ago) + '</div>' : '');
    a.appendChild(body);

    /* Thumbnail — starts hidden, shown only after OG loads */
    if (item.url) {
      var img = document.createElement('img');
      img.className = 'news-thumb';
      img.alt     = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.style.display = 'none';           /* hidden until OG arrives */
      img.dataset.url = item.url;
      a.appendChild(img);

      /* Show once loaded so no layout shift */
      img.onload = function() { img.style.display = 'block'; };
      img.onerror = function() { img.remove(); };

      hydrateImg(img);
    }

    return a;
  }

  /* ── Ad card ── */
  function buildAdCard(item) {
    var a = document.createElement('a');
    a.className = 'news-ad-card';
    a.href   = item.url || '#';
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';

    a.innerHTML =
      '<div class="news-ad-badge">Ad</div>'
      + '<div class="news-ad-body">'
      + (item.source ? '<span class="news-source">' + esc(item.source) + '</span>' : '')
      + '<div class="news-title">' + esc(item.title || '') + '</div>'
      + '</div>'
      + (item.img_src
          ? '<img class="news-ad-thumb" src="' + esc(item.img_src) + '"'
            + ' loading="lazy" decoding="async" onerror="this.remove()">'
          : '');
    return a;
  }

  /* ── Skeleton ── */
  function showSkeleton(pc) {
    var html = '<div class="tab-skeleton">';
    for (var i = 0; i < 6; i++) {
      html += '<div class="sk-card">'
        + '<div class="sk-card-body">'
        + '<div class="sk-line sk-src"></div>'
        + '<div class="sk-line"></div>'
        + '<div class="sk-line"></div>'
        + '<div class="sk-line sk-short"></div>'
        + '</div>'
        + '<div class="sk-thumb"></div>'
        + '</div>';
    }
    pc.innerHTML = html + '</div>';
  }

  /* ── Main init ── */
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

        results.forEach(function(item) {
          if (item._isAd) { list.appendChild(buildAdCard(item)); return; }
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
