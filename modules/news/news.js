/* modules/news/news.js */
(function () {
  'use strict';

  var NEWS_API = '/api/news';
  var OG_API   = '/api/og';
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

  /* ─────────────────────────────────────────────────────────────
     fetchOg — calls Worker /api/og to get full-res og:image
     Falls back to img_src if OG fetch fails or returns null.
     In-memory cache so same URL isn't fetched twice in a session.
  ───────────────────────────────────────────────────────────── */
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

  /* ─────────────────────────────────────────────────────────────
     Image element factory
     src      = what to show immediately (api thumbnail)
     Hydrates to OG image once fetch resolves.
  ───────────────────────────────────────────────────────────── */
  function makeImg(cls, fallbackSrc, lazy) {
    var img = document.createElement('img');
    img.className = cls;
    img.src       = fallbackSrc || '';
    img.alt       = '';
    img.loading   = lazy ? 'lazy' : 'eager';
    img.decoding  = 'async';
    img.referrerPolicy = 'no-referrer';
    return img;
  }

  /* Replace img.src with ogSrc once available; hide on total failure */
  function hydrateImg(imgEl, ogPromise, wrapEl) {
    ogPromise.then(function(ogSrc) {
      if (!imgEl) return;
      if (ogSrc && ogSrc !== imgEl.src) {
        var prev = imgEl.src;
        imgEl.onerror = function() {
          /* OG failed — fall back to original thumbnail */
          imgEl.onerror = function() {
            if (wrapEl) wrapEl.style.display = 'none';
          };
          imgEl.src = prev;
        };
        imgEl.src = ogSrc;
      } else if (!imgEl.src) {
        if (wrapEl) wrapEl.style.display = 'none';
      }
    });
    /* If thumbnail itself fails before OG arrives */
    imgEl.onerror = function() {
      ogPromise.then(function(ogSrc) {
        if (ogSrc) { imgEl.onerror = function() { if (wrapEl) wrapEl.style.display = 'none'; }; imgEl.src = ogSrc; }
        else if (wrapEl) wrapEl.style.display = 'none';
      });
    };
  }

  /* ─────────────────────────────────────────────────────────────
     DOM builders
  ───────────────────────────────────────────────────────────── */

  function buildHero(item) {
    var a = document.createElement('a');
    a.className = 'news-hero';
    a.href   = item.url || '#';
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';

    var ago = timeAgo(item.publishedDate || '');

    /* Image wrap — show API thumbnail immediately, upgrade to OG */
    var imgWrap = null, img = null;
    if (item.img_src || item.url) {
      imgWrap = document.createElement('div');
      imgWrap.className = 'news-hero-img-wrap';
      img = makeImg('news-hero-img', item.img_src || '', false);
      imgWrap.appendChild(img);

      var bar = document.createElement('div');
      bar.className = 'news-hero-bar';

      a.appendChild(imgWrap);
      a.appendChild(bar);

      /* Kick off OG fetch and hydrate when ready */
      if (item.url) hydrateImg(img, fetchOg(item.url), imgWrap);
    }

    var body = document.createElement('div');
    body.className = 'news-hero-body';
    body.innerHTML =
      (item.source ? '<span class="news-source">' + esc(item.source) + '</span>' : '')
      + '<div class="news-title">' + esc(item.title || '') + '</div>'
      + (ago ? '<div class="news-time">' + esc(ago) + '</div>' : '');
    a.appendChild(body);

    return a;
  }

  function buildCard(item) {
    var a = document.createElement('a');
    a.className = 'news-card';
    a.href   = item.url || '#';
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';

    var ago = timeAgo(item.publishedDate || '');

    var cardBody = document.createElement('div');
    cardBody.className = 'news-card-body';
    cardBody.innerHTML =
      (item.source ? '<span class="news-source">' + esc(item.source) + '</span>' : '')
      + '<div class="news-title">' + esc(item.title || '') + '</div>'
      + (ago ? '<div class="news-time">' + esc(ago) + '</div>' : '');
    a.appendChild(cardBody);

    if (item.img_src || item.url) {
      var wrap = document.createElement('div');
      wrap.className = 'news-thumb-wrap';
      var img = makeImg('news-thumb', item.img_src || '', true);
      wrap.appendChild(img);
      a.appendChild(wrap);

      if (item.url) hydrateImg(img, fetchOg(item.url), wrap);
    }

    return a;
  }

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

  /* ─────────────────────────────────────────────────────────────
     Skeleton
  ───────────────────────────────────────────────────────────── */
  function showSkeleton(pc) {
    var html =
      '<div class="tab-skeleton">'
      + '<div class="sk-hero"><div class="sk-hero-img"></div>'
      + '<div class="sk-hero-bar"></div>'
      + '<div class="sk-hero-body"><div class="sk-line sk-src"></div>'
      + '<div class="sk-line"></div><div class="sk-line"></div>'
      + '<div class="sk-line sk-short"></div></div></div>'
      + '<div class="sk-group">';
    for (var i = 0; i < 5; i++) {
      html += '<div class="sk-card"><div class="sk-card-body">'
        + '<div class="sk-line sk-src"></div>'
        + '<div class="sk-line"></div><div class="sk-line sk-short"></div>'
        + '</div><div class="sk-thumb"></div></div>';
    }
    pc.innerHTML = html + '</div></div>';
  }

  /* ─────────────────────────────────────────────────────────────
     Main init
  ───────────────────────────────────────────────────────────── */
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

        var heroIdx = -1;
        for (var i = 0; i < Math.min(results.length, 4); i++) {
          if (results[i].img_src || results[i].url) { heroIdx = i; break; }
        }

        if (heroIdx !== -1) list.appendChild(buildHero(results[heroIdx]));

        if (results.length > 1) {
          var lbl = document.createElement('div');
          lbl.className = 'news-section-label';
          lbl.textContent = 'More stories';
          list.appendChild(lbl);
        }

        var group = document.createElement('div');
        group.className = 'news-card-group';

        results.forEach(function(item, idx) {
          if (idx === heroIdx) return;
          if (item._isAd) { list.appendChild(buildAdCard(item)); return; }
          group.appendChild(buildCard(item));
        });

        if (group.children.length) list.appendChild(group);

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
      
