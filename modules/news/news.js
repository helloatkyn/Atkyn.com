/* modules/news/news.js — Atkyn News — professional redesign */
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

  /* ── Hero — full width, image uncropped ── */
  function buildHero(item) {
    var a = document.createElement('a');
    a.className = 'news-hero';
    a.href   = item.url || '#';
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';

    var thumb = item.img_src || '';
    var ago   = timeAgo(item.publishedDate || '');

    /* Use highest-res image URL if possible.
       Many APIs return a resized URL with width param — strip/max it out. */
    var imgSrc = thumb
      ? thumb
          .replace(/[?&]w=\d+/g, '')       /* strip width param */
          .replace(/[?&]width=\d+/g, '')
          .replace(/[?&]resize=\d+/g, '')
          .replace(/=s\d+-/, '=s1200-')    /* Google/Blogger size token */
      : '';

    a.innerHTML =
      (imgSrc
        ? '<div class="news-hero-img-wrap">'
          + '<img class="news-hero-img" src="' + esc(imgSrc) + '" alt=""'
          + ' loading="eager" decoding="async"'
          + ' onerror="this.closest(\'.news-hero-img-wrap\').style.display=\'none\'">'
          + '</div>'
          + '<div class="news-hero-bar"></div>'
        : '')
      + '<div class="news-hero-body">'
      + (item.source ? '<span class="news-source">' + esc(item.source) + '</span>' : '')
      + '<div class="news-title">' + esc(item.title || '') + '</div>'
      + (ago ? '<div class="news-time">' + esc(ago) + '</div>' : '')
      + '</div>';

    return a;
  }

  /* ── Regular card — text left, thumb right, uncropped ── */
  function buildCard(item) {
    var a = document.createElement('a');
    a.className = 'news-card';
    a.href   = item.url || '#';
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';

    var thumb = item.img_src || '';
    var ago   = timeAgo(item.publishedDate || '');

    /* Same max-res trick for thumbnails */
    var imgSrc = thumb
      ? thumb
          .replace(/[?&]w=\d+/g, '')
          .replace(/[?&]width=\d+/g, '')
          .replace(/[?&]resize=\d+/g, '')
          .replace(/=s\d+-/, '=s400-')
      : '';

    a.innerHTML =
      '<div class="news-card-body">'
      + (item.source ? '<span class="news-source">' + esc(item.source) + '</span>' : '')
      + '<div class="news-title">' + esc(item.title || '') + '</div>'
      + (ago ? '<div class="news-time">' + esc(ago) + '</div>' : '')
      + '</div>'
      + (imgSrc
          ? '<div class="news-thumb-wrap">'
            + '<img class="news-thumb" src="' + esc(imgSrc) + '" alt=""'
            + ' loading="lazy" decoding="async"'
            + ' onerror="this.closest(\'.news-thumb-wrap\').style.display=\'none\'">'
            + '</div>'
          : '');

    return a;
  }

  /* ── Ad card — clearly badged as Sponsored ── */
  function buildAdCard(item) {
    var a = document.createElement('a');
    a.className = 'news-ad-card';
    a.href   = item.url || '#';
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';

    var thumb = item.img_src || '';

    a.innerHTML =
      '<div class="news-ad-badge">Ad</div>'
      + '<div class="news-ad-body">'
      + (item.source ? '<span class="news-source">' + esc(item.source) + '</span>' : '')
      + '<div class="news-title">' + esc(item.title || '') + '</div>'
      + '</div>'
      + (thumb
          ? '<img class="news-ad-thumb" src="' + esc(thumb) + '" alt=""'
            + ' loading="lazy" decoding="async"'
            + ' onerror="this.remove()">'
          : '');

    return a;
  }

  /* ── Skeleton loader ── */
  function showSkeleton(pc) {
    var html =
      '<div class="tab-skeleton">'
      /* Hero skeleton */
      + '<div class="sk-hero">'
      + '<div class="sk-hero-img"></div>'
      + '<div class="sk-hero-bar"></div>'
      + '<div class="sk-hero-body">'
      + '<div class="sk-line sk-src"></div>'
      + '<div class="sk-line"></div>'
      + '<div class="sk-line"></div>'
      + '<div class="sk-line sk-short"></div>'
      + '</div></div>'
      /* Card group skeleton */
      + '<div class="sk-group">';

    for (var i = 0; i < 5; i++) {
      html += '<div class="sk-card">'
        + '<div class="sk-card-body">'
        + '<div class="sk-line sk-src"></div>'
        + '<div class="sk-line"></div>'
        + '<div class="sk-line sk-short"></div>'
        + '</div>'
        + '<div class="sk-thumb"></div>'
        + '</div>';
    }

    pc.innerHTML = html + '</div></div>';
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

        /* Pick first item with an image as hero (search within first 4) */
        var heroIdx = -1;
        for (var i = 0; i < Math.min(results.length, 4); i++) {
          if (results[i].img_src) { heroIdx = i; break; }
        }

        /* Hero */
        if (heroIdx !== -1) {
          list.appendChild(buildHero(results[heroIdx]));
        }

        /* Section label */
        if (results.length > 1) {
          var lbl = document.createElement('div');
          lbl.className = 'news-section-label';
          lbl.textContent = 'More stories';
          list.appendChild(lbl);
        }

        /* Remaining cards wrapped in a group */
        var group = document.createElement('div');
        group.className = 'news-card-group';

        results.forEach(function(item, idx) {
          if (idx === heroIdx) return;          /* skip hero */
          if (item._isAd) {                     /* standalone ad card */
            list.appendChild(buildAdCard(item));
            return;
          }
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
      
