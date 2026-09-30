/* modules/news/news.js */
(function () {
  'use strict';

  var NEWS_API = '/api/news';
  var OG_API   = '/api/newsog';
  var MAX      = 20;

  var SUGGESTION_POSITIONS = [3, 8]; /* after 3rd and 8th non-ad card */

  var CHECK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="20 6 9 17 4 12"></polyline></svg>';

  var STOP_WORDS = {
    the:1, a:1, an:1, and:1, or:1, but:1, in:1, on:1, at:1, to:1, for:1, of:1,
    with:1, by:1, from:1, is:1, are:1, was:1, were:1, be:1, been:1, as:1, it:1,
    its:1, this:1, that:1, how:1, why:1, what:1, who:1, when:1, can:1, will:1,
    has:1, have:1, had:1, not:1, no:1, so:1, do:1, did:1, after:1, over:1,
    than:1, into:1, about:1, amid:1, says:1, say:1, said:1, new:1, up:1, out:1,
    more:1, he:1, she:1, his:1, her:1, their:1, they:1, we:1, us:1, you:1, your:1
  };

  /* ── Utils ─────────────────────────────────────────────────── */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    if (isNaN(d)) return String(dateStr);
    var diff = Date.now() - d.getTime();
    if (diff < 0) return 'just now';
    var m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  /* ── Related suggestions ───────────────────────────────────── */
  function extractSuggestions(results, baseQuery) {
    var seen    = {};
    var phrases = [];

    baseQuery.trim().toLowerCase().split(/\s+/).forEach(function (w) { seen[w] = true; });

    results.forEach(function (item) {
      if (!item.title) return;
      item.title
        .replace(/[\u2018\u2019\u201C\u201D'"\-\u2013\u2014:,.!?]/g, ' ')
        .split(/\s+/)
        .forEach(function (w) {
          var key = w.toLowerCase();
          if (w.length > 2 && !STOP_WORDS[key] && !seen[key] && phrases.length < 8) {
            seen[key] = true;
            phrases.push(w);
          }
        });
    });

    return phrases;
  }

  function buildSuggestionStrip(suggestions) {
    var strip = document.createElement('div');
    strip.className = 'news-suggestions';

    var label = document.createElement('span');
    label.className   = 'news-suggestions-label';
    label.textContent = 'Related searches';
    strip.appendChild(label);

    var list = document.createElement('div');
    list.className = 'news-suggestions-list';

    suggestions.forEach(function (term) {
      var btn = document.createElement('button');
      btn.type        = 'button';
      btn.className   = 'news-suggestion-btn';
      btn.textContent = term;

      btn.addEventListener('click', function () {
        try { sessionStorage.setItem('atkyn_last_query', term); } catch (_) {}
        if (typeof window._atkynSearch === 'function') {
          window._atkynSearch(term);
        } else {
          window.dispatchEvent(new CustomEvent('atkyn:search', { detail: { q: term } }));
        }
      });

      list.appendChild(btn);
    });

    strip.appendChild(list);
    return strip;
  }

  /* ── OG image ──────────────────────────────────────────────── */
  var _ogCache = {};

  function fetchOg(articleUrl) {
    if (!articleUrl) return Promise.resolve(null);
    if (_ogCache[articleUrl] !== undefined) return Promise.resolve(_ogCache[articleUrl]);

    return fetch(OG_API + '?url=' + encodeURIComponent(articleUrl), {
      method: 'GET', credentials: 'same-origin', cache: 'default'
    })
      .then(function (r) { if (!r.ok) throw new Error('OG HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var img = data && data.og ? String(data.og) : null;
        _ogCache[articleUrl] = img;
        return img;
      })
      .catch(function () { _ogCache[articleUrl] = null; return null; });
  }

  /* Image block is added only once the image has loaded — no empty placeholder */
  function hydrateImg(cardEl, item, eager) {
    fetchOg(item.url).then(function (src) {
      if (!src || !cardEl.parentNode) return;

      var img = new Image();
      img.className      = 'news-thumb';
      img.alt            = '';
      img.decoding       = 'async';
      img.loading        = eager ? 'eager' : 'lazy';
      img.referrerPolicy = 'no-referrer';

      img.onload = function () {
        if (!cardEl.parentNode) return;
        var wrap = document.createElement('div');
        wrap.className = 'news-thumb-wrap';
        wrap.appendChild(img);

        if (item.source) {
          var badge = document.createElement('span');
          badge.className   = 'news-glass';
          badge.textContent = item.source;
          wrap.appendChild(badge);
        }

        cardEl.insertBefore(wrap, cardEl.firstChild);
      };

      img.src = src;
    });
  }

  /* ── Cards ─────────────────────────────────────────────────── */
  function buildMeta(item) {
    var source = item.source ? esc(item.source) : '';
    var ago    = timeAgo(item.publishedDate);
    if (!source && !ago) return '';

    return '<div class="news-meta">' +
      (source ? CHECK_ICON + '<span class="news-source">' + source + '</span>' : '') +
      (ago ? '<span class="news-time">' + esc(ago) + '</span>' : '') +
      '</div>';
  }

  function buildLink(item, extraClass) {
    var a = document.createElement('a');
    a.className = 'news-card' + (extraClass ? ' ' + extraClass : '');
    a.href      = item.url || '#';
    a.target    = '_blank';
    a.rel       = 'noopener noreferrer';
    return a;
  }

  function buildBody(item, prefixHtml) {
    var body = document.createElement('div');
    body.className = 'news-card-body';
    body.innerHTML =
      (prefixHtml || '') +
      buildMeta(item) +
      '<h3 class="news-title">' + esc(item.title || '') + '</h3>';
    return body;
  }

  function buildCard(item, isHero) {
    var a = buildLink(item, isHero ? 'news-card--hero' : '');
    a.appendChild(buildBody(item));
    if (item.url) hydrateImg(a, item, isHero);
    return a;
  }

  function buildAdCard(item) {
    var a = buildLink(item, 'news-ad-card');

    if (item.img_src) {
      var wrap = document.createElement('div');
      wrap.className = 'news-thumb-wrap';

      var img = new Image();
      img.className      = 'news-thumb';
      img.alt            = '';
      img.loading        = 'lazy';
      img.decoding       = 'async';
      img.referrerPolicy = 'no-referrer';
      img.onload         = function () { wrap.appendChild(img); a.insertBefore(wrap, a.firstChild); };
      img.src            = item.img_src;
    }

    a.appendChild(buildBody(item, '<span class="news-ad-badge">Ad</span>'));
    return a;
  }

  /* ── Init ──────────────────────────────────────────────────── */
  window._atkynInit_news = function () {
    var pc = window._atkynPageContent;
    if (!pc) return;

    var q = '';
    try { q = sessionStorage.getItem('atkyn_last_query') || ''; } catch (_) {}

    if (!q) {
      pc.innerHTML = '<div class="tab-empty"><p>Search something to see news</p></div>';
      return;
    }

    fetch(NEWS_API + '?q=' + encodeURIComponent(q), {
      method: 'GET', credentials: 'same-origin', cache: 'default'
    })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var results = (data.results || []).slice(0, MAX);
        if (!results.length) throw new Error('empty');

        var suggestions = extractSuggestions(results, q);
        var list        = document.createElement('div');
        list.className  = 'news-list';
        var nonAdCount  = 0;

        results.forEach(function (item) {
          if (item._isAd) {
            list.appendChild(buildAdCard(item));
            return;
          }

          list.appendChild(buildCard(item, nonAdCount === 0));
          nonAdCount++;

          if (suggestions.length && SUGGESTION_POSITIONS.indexOf(nonAdCount) !== -1) {
            list.appendChild(buildSuggestionStrip(suggestions));
          }
        });

        pc.innerHTML = '';
        pc.appendChild(list);

        if (typeof window._atkynAnimateIn === 'function') window._atkynAnimateIn();
      })
      .catch(function (err) {
        console.error('[atkyn news]', err);
        pc.innerHTML = '<div class="tab-empty"><p>Could not load news</p></div>';
      });
  };

  window._atkynInit_news();
}());
      
