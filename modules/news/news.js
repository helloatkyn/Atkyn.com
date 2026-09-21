/* modules/news/news.js */
(function () {
  'use strict';

  var NEWS_API = '/api/news';

  /* IMPORTANT:
     /functions/api/og.js maps to /api/og on Cloudflare Pages. */
  var OG_API   = '/api/og';

  var MAX      = 20;

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
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
    } catch (_) {
      return dateStr || '';
    }
  }

  /* ──────────────────────────────────────────────────────────────
     OG CACHE — in-memory per session
  ────────────────────────────────────────────────────────────── */
  var _ogCache = {};

  function fetchOg(articleUrl) {
    if (!articleUrl) {
      return Promise.resolve(null);
    }

    if (_ogCache[articleUrl] !== undefined) {
      return Promise.resolve(_ogCache[articleUrl]);
    }

    return fetch(
      OG_API + '?url=' + encodeURIComponent(articleUrl),
      {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'default'
      }
    )
      .then(function (r) {
        if (!r.ok) {
          throw new Error('OG HTTP ' + r.status);
        }

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

     The wrapper reserves the space immediately.
     The actual image becomes visible only after successful load.
  ────────────────────────────────────────────────────────────── */
  function hydrateImg(imgEl, wrapEl) {
    var articleUrl = imgEl.dataset.url;

    fetchOg(articleUrl).then(function (ogSrc) {
      if (!imgEl.parentNode || !wrapEl.parentNode) return;

      if (!ogSrc) {
        wrapEl.remove();
        return;
      }

      imgEl.onload = function () {
        if (!wrapEl.parentNode) return;

        wrapEl.classList.add('loaded');
      };

      imgEl.onerror = function () {
        if (wrapEl.parentNode) {
          wrapEl.remove();
        }
      };

      imgEl.src = ogSrc;
    });
  }

  /* ──────────────────────────────────────────────────────────────
     META ROW
  ────────────────────────────────────────────────────────────── */
  function buildMeta(item) {
    var source = item.source ? esc(item.source) : '';
    var ago = timeAgo(item.publishedDate || '');

    if (!source && !ago) {
      return '';
    }

    var html = '<div class="news-meta">';

    if (source) {
      html += '<span class="news-source">' + source + '</span>';
    }

    if (source && ago) {
      html += '<span class="news-meta-dot" aria-hidden="true"></span>';
    }

    if (ago) {
      html += '<span class="news-time">' + esc(ago) + '</span>';
    }

    html += '</div>';

    return html;
  }

  /* ──────────────────────────────────────────────────────────────
     BUILD NEWS CARD
  ────────────────────────────────────────────────────────────── */
  function buildCard(item, isLead) {
    var a = document.createElement('a');

    a.className = 'news-card' + (isLead ? ' news-card--lead' : '');

    a.href = item.url || '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    /* ── Text body ── */
    var body = document.createElement('div');
    body.className = 'news-card-body';

    body.innerHTML =
      buildMeta(item) +
      '<div class="news-title">' +
      esc(item.title || '') +
      '</div>';

    a.appendChild(body);

    /* ── OG image wrapper ── */
    if (item.url) {
      var wrap = document.createElement('div');
      wrap.className = 'news-thumb-wrap';

      var img = document.createElement('img');

      img.className = 'news-thumb';
      img.alt = '';

      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';

      img.style.display = 'block';

      img.dataset.url = item.url;

      wrap.appendChild(img);
      a.appendChild(wrap);

      hydrateImg(img, wrap);
    }

    return a;
  }

  /* ──────────────────────────────────────────────────────────────
     AD CARD
  ────────────────────────────────────────────────────────────── */
  function buildAdCard(item) {
    var a = document.createElement('a');

    a.className = 'news-ad-card';

    a.href = item.url || '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    var badge = document.createElement('div');

    badge.className = 'news-ad-badge';
    badge.textContent = 'Ad';

    a.appendChild(badge);

    var body = document.createElement('div');

    body.className = 'news-ad-body';

    body.innerHTML =
      buildMeta(item) +
      '<div class="news-title">' +
      esc(item.title || '') +
      '</div>';

    a.appendChild(body);

    if (item.img_src) {
      var img = document.createElement('img');

      img.className = 'news-ad-thumb';

      img.alt = '';

      img.loading = 'lazy';
      img.decoding = 'async';

      img.referrerPolicy = 'no-referrer';

      img.src = item.img_src;

      img.onerror = function () {
        img.remove();
      };

      a.appendChild(img);
    }

    return a;
  }

  /* ──────────────────────────────────────────────────────────────
     SKELETON
  ────────────────────────────────────────────────────────────── */
  function showSkeleton(pc) {
    var html = '<div class="tab-skeleton">';

    for (var i = 0; i < 6; i++) {
      html +=
        '<div class="sk-card">' +
          '<div class="sk-card-body">' +
            '<div class="sk-line sk-src"></div>' +
            '<div class="sk-line"></div>' +
            '<div class="sk-line"></div>' +
            '<div class="sk-line sk-short"></div>' +
          '</div>' +
          '<div class="sk-thumb"></div>' +
        '</div>';
    }

    html += '</div>';

    pc.innerHTML = html;
  }

  /* ──────────────────────────────────────────────────────────────
     MAIN INIT
  ────────────────────────────────────────────────────────────── */
  window._atkynInit_news = function () {
    var pc = window._atkynPageContent;

    if (!pc) return;

    var q = '';

    try {
      q = sessionStorage.getItem('atkyn_last_query') || '';
    } catch (_) {}

    if (!q) {
      pc.innerHTML =
        '<div class="tab-empty">' +
          '<p>Search something to see news</p>' +
        '</div>';

      return;
    }

    showSkeleton(pc);

    fetch(
      NEWS_API + '?q=' + encodeURIComponent(q),
      {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'default'
      }
    )
      .then(function (r) {
        if (!r.ok) {
          throw new Error('HTTP ' + r.status);
        }

        return r.json();
      })
      .then(function (data) {
        var results = (data.results || []).slice(0, MAX);

        if (!results.length) {
          throw new Error('empty');
        }

        var list = document.createElement('div');

        list.className = 'news-list';

        /*
          First NON-AD story becomes the editorial lead.
          Ads never consume the featured-story position.
        */
        var leadUsed = false;

        results.forEach(function (item) {
          if (item._isAd) {
            list.appendChild(buildAdCard(item));
            return;
          }

          var isLead = !leadUsed;

          if (isLead) {
            leadUsed = true;
          }

          list.appendChild(buildCard(item, isLead));
        });

        pc.innerHTML = '';
        pc.appendChild(list);

        if (
          typeof window._atkynAnimateIn === 'function'
        ) {
          window._atkynAnimateIn();
        }
      })
      .catch(function (err) {
        console.error('[atkyn news]', err);

        pc.innerHTML =
          '<div class="tab-empty">' +
            '<p>Could not load news</p>' +
          '</div>';
      });
  };

  window._atkynInit_news();
}());
