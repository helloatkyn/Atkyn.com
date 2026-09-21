/* modules/news/news.js */
(function () {
  'use strict';

  var NEWS_API = '/api/news';
  var OG_API   = '/api/newsog';
  var MAX      = 20;

  /* ──────────────────────────────────────────────────────────────
     UTILS
  ────────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;');
  }

  function timeAgo(dateStr) {
    try {
      if (!dateStr) return '';
      var d = new Date(dateStr);
      if (isNaN(d)) return dateStr || '';
      var diff = Date.now() - d.getTime();
      if (diff < 0) return 'just now';
      var m = Math.floor(diff / 60000);
      if (m < 1)  return 'just now';
      if (m < 60) return m + 'm ago';
      var h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h / 24) + 'd ago';
    } catch (_) { return dateStr || ''; }
  }

  /* ──────────────────────────────────────────────────────────────
     PICK FEATURED INDICES
     Randomly pick 2–4 non-ad indices from results to be featured
     (full-width). Index 0 is always featured.
  ────────────────────────────────────────────────────────────── */
  function pickFeaturedIndices(results) {
    var nonAdIndices = [];
    results.forEach(function (item, i) {
      if (!item._isAd) nonAdIndices.push(i);
    });

    if (nonAdIndices.length === 0) return {};

    /* Always feature first non-ad */
    var count   = 2 + Math.floor(Math.random() * 3); /* 2, 3 or 4 */
    var chosen  = {};

    chosen[nonAdIndices[0]] = true;

    /* Shuffle rest and pick more */
    var rest = nonAdIndices.slice(1);
    for (var i = rest.length - 1; i > 0; i--) {
      var j   = Math.floor(Math.random() * (i + 1));
      var tmp = rest[i];
      rest[i] = rest[j];
      rest[j] = tmp;
    }

    for (var k = 0; k < Math.min(count - 1, rest.length); k++) {
      chosen[rest[k]] = true;
    }

    return chosen;
  }

  /* ──────────────────────────────────────────────────────────────
     OG CACHE
  ────────────────────────────────────────────────────────────── */
  var _ogCache = {};

  function fetchOg(articleUrl) {
    if (!articleUrl) return Promise.resolve(null);
    if (_ogCache[articleUrl] !== undefined) {
      return Promise.resolve(_ogCache[articleUrl]);
    }
    return fetch(
      OG_API + '?url=' + encodeURIComponent(articleUrl),
      { method: 'GET', credentials: 'same-origin', cache: 'default' }
    )
      .then(function (r) {
        if (!r.ok) throw new Error('OG HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var img = (data && data.og) ? String(data.og) : null;
        _ogCache[articleUrl] = img;
        return img;
      })
      .catch(function () {
        _ogCache[articleUrl] = null;
        return null;
      });
  }

  /* ──────────────────────────────────────────────────────────────
     HYDRATE OG IMAGE
     - Card starts as text-only (no-image layout)
     - If OG loads → card upgrades to image layout
     - If OG fails → card stays as clean full-width text card
  ────────────────────────────────────────────────────────────── */
  function hydrateImg(cardEl, imgEl, wrapEl, isFeatured) {
    var articleUrl = imgEl.dataset.url;

    fetchOg(articleUrl).then(function (ogSrc) {
      if (!cardEl.parentNode) return;

      if (!ogSrc) {
        /* No image: make card full-width text layout */
        cardEl.classList.add('news-card--no-image');
        if (wrapEl.parentNode) wrapEl.remove();
        return;
      }

      imgEl.onload = function () {
        if (!wrapEl.parentNode) return;
        wrapEl.classList.add('loaded');
      };

      imgEl.onerror = function () {
        cardEl.classList.add('news-card--no-image');
        if (wrapEl.parentNode) wrapEl.remove();
      };

      imgEl.src = ogSrc;
    });
  }

  /* ──────────────────────────────────────────────────────────────
     META ROW
  ────────────────────────────────────────────────────────────── */
  function buildMeta(item) {
    var source = item.source ? esc(item.source) : '';
    var ago    = timeAgo(item.publishedDate || '');
    if (!source && !ago) return '';

    var html = '<div class="news-meta">';
    if (source) html += '<span class="news-source">' + source + '</span>';
    if (source && ago) html += '<span class="news-meta-dot" aria-hidden="true"></span>';
    if (ago) html += '<span class="news-time">' + esc(ago) + '</span>';
    html += '</div>';
    return html;
  }

  /* ──────────────────────────────────────────────────────────────
     BUILD NEWS CARD
  ────────────────────────────────────────────────────────────── */
  function buildCard(item, isFeatured) {
    var a = document.createElement('a');

    a.className = 'news-card' + (isFeatured ? ' news-card--featured' : '');
    a.href      = item.url || '#';
    a.target    = '_blank';
    a.rel       = 'noopener noreferrer';

    if (isFeatured) {
      /* Featured: image on top, text below */

      /* Image wrapper — created first, hidden until loaded */
      var wrap = document.createElement('div');
      wrap.className = 'news-thumb-wrap';

      var img = document.createElement('img');
      img.className      = 'news-thumb';
      img.alt            = '';
      img.loading        = 'lazy';
      img.decoding       = 'async';
      img.referrerPolicy = 'no-referrer';
      img.dataset.url    = item.url;

      wrap.appendChild(img);
      a.appendChild(wrap);

      /* Text body */
      var body = document.createElement('div');
      body.className = 'news-card-body';
      body.innerHTML =
        buildMeta(item) +
        '<div class="news-title">' + esc(item.title || '') + '</div>';
      a.appendChild(body);

      hydrateImg(a, img, wrap, true);

    } else {
      /* Standard: text left, thumb right */

      var body2 = document.createElement('div');
      body2.className = 'news-card-body';
      body2.innerHTML =
        buildMeta(item) +
        '<div class="news-title">' + esc(item.title || '') + '</div>';
      a.appendChild(body2);

      if (item.url) {
        var wrap2 = document.createElement('div');
        wrap2.className = 'news-thumb-wrap';

        var img2 = document.createElement('img');
        img2.className      = 'news-thumb';
        img2.alt            = '';
        img2.loading        = 'lazy';
        img2.decoding       = 'async';
        img2.referrerPolicy = 'no-referrer';
        img2.dataset.url    = item.url;

        wrap2.appendChild(img2);
        a.appendChild(wrap2);

        hydrateImg(a, img2, wrap2, false);
      }
    }

    return a;
  }

  /* ──────────────────────────────────────────────────────────────
     AD CARD
  ────────────────────────────────────────────────────────────── */
  function buildAdCard(item) {
    var a = document.createElement('a');
    a.className = 'news-ad-card';
    a.href      = item.url || '#';
    a.target    = '_blank';
    a.rel       = 'noopener noreferrer';

    var badge = document.createElement('div');
    badge.className   = 'news-ad-badge';
    badge.textContent = 'Ad';
    a.appendChild(badge);

    var body = document.createElement('div');
    body.className = 'news-ad-body';
    body.innerHTML =
      buildMeta(item) +
      '<div class="news-title">' + esc(item.title || '') + '</div>';
    a.appendChild(body);

    if (item.img_src) {
      var img = document.createElement('img');
      img.className      = 'news-ad-thumb';
      img.alt            = '';
      img.loading        = 'lazy';
      img.decoding       = 'async';
      img.referrerPolicy = 'no-referrer';
      img.src            = item.img_src;
      img.onerror        = function () { img.remove(); };
      a.appendChild(img);
    }

    return a;
  }

  /* ──────────────────────────────────────────────────────────────
     LOADING STATE — no shimmer, clean pulse dots
  ────────────────────────────────────────────────────────────── */
  function showLoading(pc) {
    pc.innerHTML =
      '<div class="news-loading">' +
        '<span></span><span></span><span></span>' +
      '</div>';
  }

  /* ──────────────────────────────────────────────────────────────
     MAIN INIT
  ────────────────────────────────────────────────────────────── */
  window._atkynInit_news = function () {
    var pc = window._atkynPageContent;
    if (!pc) return;

    var q = '';
    try { q = sessionStorage.getItem('atkyn_last_query') || ''; } catch (_) {}

    if (!q) {
      pc.innerHTML =
        '<div class="tab-empty"><p>Search something to see news</p></div>';
      return;
    }

    showLoading(pc);

    fetch(
      NEWS_API + '?q=' + encodeURIComponent(q),
      { method: 'GET', credentials: 'same-origin', cache: 'default' }
    )
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var results = (data.results || []).slice(0, MAX);
        if (!results.length) throw new Error('empty');

        var featuredMap = pickFeaturedIndices(results);

        var list = document.createElement('div');
        list.className = 'news-list';

        results.forEach(function (item, i) {
          if (item._isAd) {
            list.appendChild(buildAdCard(item));
            return;
          }
          list.appendChild(buildCard(item, !!featuredMap[i]));
        });

        pc.innerHTML = '';
        pc.appendChild(list);

        if (typeof window._atkynAnimateIn === 'function') {
          window._atkynAnimateIn();
        }
      })
      .catch(function (err) {
        console.error('[atkyn news]', err);
        pc.innerHTML =
          '<div class="tab-empty"><p>Could not load news</p></div>';
      });
  };

  window._atkynInit_news();
}());
      
