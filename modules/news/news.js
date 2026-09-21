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
      var d    = new Date(dateStr);
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
     EXTRACT SUGGESTION TOPICS FROM RESULTS
     Pull 2-word phrases from titles — deduplicate — cap at 8
  ────────────────────────────────────────────────────────────── */
  var STOP_WORDS = {
    'the':1,'a':1,'an':1,'and':1,'or':1,'but':1,'in':1,'on':1,'at':1,
    'to':1,'for':1,'of':1,'with':1,'by':1,'from':1,'is':1,'are':1,
    'was':1,'were':1,'be':1,'been':1,'as':1,'it':1,'its':1,'this':1,
    'that':1,'how':1,'why':1,'what':1,'who':1,'when':1,'can':1,'will':1,
    'has':1,'have':1,'had':1,'not':1,'no':1,'so':1,'do':1,'did':1,
    'after':1,'over':1,'than':1,'into':1,'about':1,'amid':1,'says':1,
    'say':1,'said':1,'new':1,'up':1,'out':1,'more':1,'he':1,'she':1,
    'his':1,'her':1,'their':1,'they':1,'we':1,'us':1,'you':1,'your':1
  };

  function extractSuggestions(results, baseQuery) {
    var seen    = {};
    var phrases = [];

    /* Base query words always go first */
    var qWords = baseQuery.trim().toLowerCase().split(/\s+/);
    qWords.forEach(function (w) { seen[w] = true; });

    results.forEach(function (item) {
      if (!item.title) return;

      /* Clean title → word array */
      var words = item.title
        .replace(/[''""'"\-–—:,\.!?]/g, ' ')
        .split(/\s+/)
        .filter(function (w) {
          var lw = w.toLowerCase();
          return w.length > 2 && !STOP_WORDS[lw];
        });

      /* Single meaningful words */
      words.forEach(function (w) {
        var key = w.toLowerCase();
        if (!seen[key] && phrases.length < 8) {
          seen[key] = true;
          phrases.push(w);
        }
      });
    });

    return phrases.slice(0, 8);
  }

  /* ──────────────────────────────────────────────────────────────
     SUGGESTION STRIP
  ────────────────────────────────────────────────────────────── */
  function buildSuggestionStrip(suggestions) {
    var strip = document.createElement('div');
    strip.className = 'news-suggestions';

    var label = document.createElement('span');
    label.className   = 'news-suggestions-label';
    label.textContent = 'Related';
    strip.appendChild(label);

    var scroll = document.createElement('div');
    scroll.className = 'news-suggestions-scroll';

    suggestions.forEach(function (term) {
      var btn = document.createElement('button');
      btn.className   = 'news-suggestion-chip';
      btn.textContent = term;
      btn.type        = 'button';

      btn.addEventListener('click', function () {
        try {
          sessionStorage.setItem('atkyn_last_query', term);
        } catch (_) {}

        /* Re-run search with new query */
        if (typeof window._atkynSearch === 'function') {
          window._atkynSearch(term);
        } else {
          /* Fallback: dispatch a search event */
          window.dispatchEvent(
            new CustomEvent('atkyn:search', { detail: { q: term } })
          );
        }
      });

      scroll.appendChild(btn);
    });

    strip.appendChild(scroll);
    return strip;
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
     Featured: image on top, text below
     Standard: text left, thumb right
     No-image: full-width text, no thumb column
  ────────────────────────────────────────────────────────────── */
  function hydrateImg(cardEl, imgEl, wrapEl) {
    var articleUrl = imgEl.dataset.url;

    fetchOg(articleUrl).then(function (ogSrc) {
      if (!cardEl.parentNode) return;

      if (!ogSrc) {
        cardEl.classList.add('news-card--no-image');
        if (wrapEl && wrapEl.parentNode) wrapEl.remove();
        return;
      }

      imgEl.onload = function () {
        if (!wrapEl || !wrapEl.parentNode) return;
        wrapEl.classList.add('loaded');
      };

      imgEl.onerror = function () {
        cardEl.classList.add('news-card--no-image');
        if (wrapEl && wrapEl.parentNode) wrapEl.remove();
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
     BUILD HERO CARD (index 0 — always one, always full-width)
  ────────────────────────────────────────────────────────────── */
  function buildHeroCard(item) {
    var a = document.createElement('a');
    a.className = 'news-card news-card--hero';
    a.href      = item.url || '#';
    a.target    = '_blank';
    a.rel       = 'noopener noreferrer';

    /* Image — top */
    var wrap = document.createElement('div');
    wrap.className = 'news-thumb-wrap';

    var img = document.createElement('img');
    img.className      = 'news-thumb';
    img.alt            = '';
    img.loading        = 'eager';
    img.decoding       = 'async';
    img.referrerPolicy = 'no-referrer';
    img.dataset.url    = item.url;

    wrap.appendChild(img);
    a.appendChild(wrap);

    /* Text — below */
    var body = document.createElement('div');
    body.className = 'news-card-body';
    body.innerHTML =
      buildMeta(item) +
      '<div class="news-title">' + esc(item.title || '') + '</div>';
    a.appendChild(body);

    hydrateImg(a, img, wrap);
    return a;
  }

  /* ──────────────────────────────────────────────────────────────
     BUILD STANDARD CARD
  ────────────────────────────────────────────────────────────── */
  function buildCard(item) {
    var a = document.createElement('a');
    a.className = 'news-card';
    a.href      = item.url || '#';
    a.target    = '_blank';
    a.rel       = 'noopener noreferrer';

    /* Text */
    var body = document.createElement('div');
    body.className = 'news-card-body';
    body.innerHTML =
      buildMeta(item) +
      '<div class="news-title">' + esc(item.title || '') + '</div>';
    a.appendChild(body);

    /* Thumb */
    if (item.url) {
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

      hydrateImg(a, img, wrap);
    }

    return a;
  }

  /* ──────────────────────────────────────────────────────────────
     BUILD AD CARD
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
     LOADING STATE
  ────────────────────────────────────────────────────────────── */
  function showLoading(pc) {
    pc.innerHTML =
      '<div class="news-loading">' +
        '<span></span><span></span><span></span>' +
      '</div>';
  }

  /* ──────────────────────────────────────────────────────────────
     INSERT SUGGESTION STRIPS BETWEEN CARDS
     Insert after card 3 and card 7 (if enough results)
  ────────────────────────────────────────────────────────────── */
  var SUGGESTION_POSITIONS = [3, 7];

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

        /* Extract suggestions from ALL results */
        var suggestions = extractSuggestions(results, q);

        var list = document.createElement('div');
        list.className = 'news-list';

        var nonAdCount = 0;  /* track non-ad card position for suggestions */

        results.forEach(function (item, i) {
          if (item._isAd) {
            list.appendChild(buildAdCard(item));
            return;
          }

          /* Hero = very first non-ad card */
          if (nonAdCount === 0) {
            list.appendChild(buildHeroCard(item));
          } else {
            list.appendChild(buildCard(item));
          }

          nonAdCount++;

          /* Insert suggestion strip at defined positions */
          if (
            suggestions.length > 0 &&
            SUGGESTION_POSITIONS.indexOf(nonAdCount) !== -1
          ) {
            list.appendChild(buildSuggestionStrip(suggestions));
          }
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
