/* ════════════════════════════════════════════════════════════════
   modules/news/news.js — ATKYN News
   Corporate Business Design System
   Production Clean • No Loading UI
════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var NEWS_API = '/api/news';
  var OG_API = '/api/newsog';
  var MAX_RESULTS = 20;

  /* ══════════════════════════════════════════════════════════════
     UTILITY
  ══════════════════════════════════════════════════════════════ */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';

    var date = new Date(dateStr);

    if (isNaN(date.getTime())) {
      return String(dateStr);
    }

    var diff = Date.now() - date.getTime();

    if (diff < 60000) {
      return 'just now';
    }

    var minutes = Math.floor(diff / 60000);

    if (minutes < 60) {
      return minutes + 'm ago';
    }

    var hours = Math.floor(minutes / 60);

    if (hours < 24) {
      return hours + 'h ago';
    }

    return Math.floor(hours / 24) + 'd ago';
  }

  function rand(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  /* ══════════════════════════════════════════════════════════════
     RENDER PLAN
  ══════════════════════════════════════════════════════════════ */

  function buildRenderPlan(results) {
    var plan = [];
    var nonAdIndexes = [];

    results.forEach(function (item, index) {
      if (item && item._isAd) {
        plan[index] = 'ad';
        return;
      }

      plan[index] = 'standard';
      nonAdIndexes.push(index);
    });

    if (!nonAdIndexes.length) {
      return plan;
    }

    plan[nonAdIndexes[0]] = 'hero';

    var firstFeatured = rand(4, 6);
    var secondFeatured = firstFeatured + rand(5, 7);

    [firstFeatured, secondFeatured].forEach(function (position) {
      if (position < nonAdIndexes.length) {
        plan[nonAdIndexes[position]] = 'featured';
      }
    });

    return plan;
  }

  /* ══════════════════════════════════════════════════════════════
     RELATED SEARCH TERMS
  ══════════════════════════════════════════════════════════════ */

  var STOP_WORDS = Object.create(null);

  (
    'the a an and or but in on at to for of with by from is are was were ' +
    'be been as it its this that how why what who when can will has have ' +
    'had not no so do did after over than into about amid says say said ' +
    'new up out more he she his her their they we us you your'
  )
    .split(/\s+/)
    .forEach(function (word) {
      STOP_WORDS[word] = true;
    });

  function extractSuggestions(results, baseQuery) {
    var seen = Object.create(null);
    var terms = [];

    String(baseQuery || '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .forEach(function (word) {
        if (word) {
          seen[word] = true;
        }
      });

    results.forEach(function (item) {
      if (!item || !item.title) {
        return;
      }

      String(item.title)
        .replace(
          /[\u2018\u2019\u201C\u201D'"\-–—:,.!?()[\]{}]/g,
          ' '
        )
        .split(/\s+/)
        .forEach(function (word) {
          var key = word.toLowerCase();

          if (
            word.length > 2 &&
            !STOP_WORDS[key] &&
            !seen[key] &&
            terms.length < 10
          ) {
            seen[key] = true;
            terms.push(word);
          }
        });
    });

    return terms;
  }

  function buildSuggestionStrip(terms) {
    if (!terms || !terms.length) {
      return null;
    }

    var strip = document.createElement('div');
    strip.className = 'news-suggestions';

    var label = document.createElement('span');
    label.className = 'news-suggestions-label';
    label.textContent = 'Related searches';

    var group = document.createElement('div');
    group.className = 'news-suggestions-scroll';

    terms.forEach(function (term) {
      var button = document.createElement('button');

      button.type = 'button';
      button.className = 'news-suggestion-chip';
      button.textContent = term;

      button.addEventListener('click', function () {
        try {
          sessionStorage.setItem(
            'atkyn_last_query',
            term
          );
        } catch (_) {}

        if (typeof window._atkynSearch === 'function') {
          window._atkynSearch(term);
          return;
        }

        window.dispatchEvent(
          new CustomEvent('atkyn:search', {
            detail: {
              q: term
            }
          })
        );
      });

      group.appendChild(button);
    });

    strip.appendChild(label);
    strip.appendChild(group);

    return strip;
  }

  /* ══════════════════════════════════════════════════════════════
     OG IMAGE CACHE
  ══════════════════════════════════════════════════════════════ */

  var ogCache = Object.create(null);

  function fetchOg(articleUrl) {
    if (!articleUrl) {
      return Promise.resolve(null);
    }

    if (
      Object.prototype.hasOwnProperty.call(
        ogCache,
        articleUrl
      )
    ) {
      return Promise.resolve(
        ogCache[articleUrl]
      );
    }

    return fetch(
      OG_API +
        '?url=' +
        encodeURIComponent(articleUrl),
      {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'default'
      }
    )
      .then(function (response) {
        if (!response.ok) {
          throw new Error(
            'OG HTTP ' +
              response.status
          );
        }

        return response.json();
      })
      .then(function (data) {
        var image =
          data && data.og
            ? String(data.og)
            : null;

        ogCache[articleUrl] = image;

        return image;
      })
      .catch(function () {
        ogCache[articleUrl] = null;
        return null;
      });
  }

  function dropImage(card, wrap) {
    if (!card) {
      return;
    }

    card.classList.add(
      'news-card--no-image'
    );

    if (wrap && wrap.parentNode) {
      wrap.parentNode.removeChild(wrap);
    }
  }

  function hydrateImg(card, image, wrap) {
    if (
      !card ||
      !image ||
      !image.dataset.url
    ) {
      dropImage(card, wrap);
      return;
    }

    fetchOg(
      image.dataset.url
    ).then(function (src) {
      if (!card.parentNode) {
        return;
      }

      if (!src) {
        dropImage(card, wrap);
        return;
      }

      image.onload = function () {
        if (
          wrap &&
          wrap.parentNode
        ) {
          wrap.classList.add(
            'loaded'
          );
        }
      };

      image.onerror = function () {
        dropImage(card, wrap);
      };

      image.src = src;
    });
  }

  /* ══════════════════════════════════════════════════════════════
     DOM BUILDERS
  ══════════════════════════════════════════════════════════════ */

  function buildMeta(item) {
    var source =
      item && item.source
        ? esc(item.source)
        : '';

    var ago =
      item
        ? timeAgo(
            item.publishedDate
          )
        : '';

    if (!source && !ago) {
      return '';
    }

    var html =
      '<div class="news-meta">';

    if (source) {
      html +=
        '<span class="news-source">' +
        source +
        '</span>';
    }

    if (source && ago) {
      html +=
        '<span class="news-meta-dot" aria-hidden="true"></span>';
    }

    if (ago) {
      html +=
        '<span class="news-time">' +
        esc(ago) +
        '</span>';
    }

    html += '</div>';

    return html;
  }

  function buildBody(item) {
    var body =
      document.createElement('div');

    body.className =
      'news-card-body';

    body.innerHTML =
      buildMeta(item) +
      '<div class="news-title">' +
      esc(
        item && item.title
          ? item.title
          : ''
      ) +
      '</div>';

    return body;
  }

  function buildLink(
    className,
    item
  ) {
    var link =
      document.createElement('a');

    link.className = className;
    link.href =
      item && item.url
        ? item.url
        : '#';

    link.target = '_blank';
    link.rel =
      'noopener noreferrer';

    return link;
  }

  function buildThumb(
    item,
    eager
  ) {
    var wrap =
      document.createElement('div');

    wrap.className =
      'news-thumb-wrap';

    var image =
      document.createElement('img');

    image.className =
      'news-thumb';

    image.alt = '';
    image.loading =
      eager
        ? 'eager'
        : 'lazy';

    image.decoding = 'async';
    image.referrerPolicy =
      'no-referrer';

    image.dataset.url =
      item && item.url
        ? item.url
        : '';

    wrap.appendChild(image);

    return {
      wrap: wrap,
      img: image
    };
  }

  /* ══════════════════════════════════════════════════════════════
     HERO / FEATURED
  ══════════════════════════════════════════════════════════════ */

  function buildImageCard(
    item,
    type
  ) {
    var outer =
      document.createElement('div');

    outer.className =
      'news-card-outer';

    var card =
      buildLink(
        'news-card news-card--' +
          type,
        item
      );

    if (
      !item ||
      !item.url
    ) {
      card.classList.add(
        'news-card--no-image'
      );

      card.appendChild(
        buildBody(
          item || {}
        )
      );

      outer.appendChild(card);

      return outer;
    }

    var thumb =
      buildThumb(
        item,
        type === 'hero'
      );

    card.appendChild(
      thumb.wrap
    );

    card.appendChild(
      buildBody(item)
    );

    outer.appendChild(card);

    hydrateImg(
      card,
      thumb.img,
      thumb.wrap
    );

    return outer;
  }

  /* ══════════════════════════════════════════════════════════════
     STANDARD ARTICLE
  ══════════════════════════════════════════════════════════════ */

  function buildCard(item) {
    var card =
      buildLink(
        'news-card',
        item
      );

    card.appendChild(
      buildBody(
        item || {}
      )
    );

    if (
      !item ||
      !item.url
    ) {
      card.classList.add(
        'news-card--no-image'
      );

      return card;
    }

    var thumb =
      buildThumb(
        item,
        false
      );

    card.appendChild(
      thumb.wrap
    );

    hydrateImg(
      card,
      thumb.img,
      thumb.wrap
    );

    return card;
  }

  /* ══════════════════════════════════════════════════════════════
     AD ARTICLE
  ══════════════════════════════════════════════════════════════ */

  function buildAdCard(item) {
    var card =
      buildLink(
        'news-ad-card',
        item
      );

    var badge =
      document.createElement('div');

    badge.className =
      'news-ad-badge';

    badge.textContent =
      'Ad';

    card.appendChild(
      badge
    );

    var body =
      buildBody(
        item || {}
      );

    body.className =
      'news-ad-body';

    card.appendChild(
      body
    );

    if (
      item &&
      item.img_src
    ) {
      var image =
        document.createElement('img');

      image.className =
        'news-ad-thumb';

      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy =
        'no-referrer';

      image.src =
        item.img_src;

      image.onerror =
        function () {
          if (image.parentNode) {
            image.parentNode.removeChild(
              image
            );
          }
        };

      card.appendChild(
        image
      );
    }

    return card;
  }

  /* ══════════════════════════════════════════════════════════════
     EMPTY / ERROR
  ══════════════════════════════════════════════════════════════ */

  function showMessage(
    pageContent,
    message
  ) {
    pageContent.innerHTML =
      '<div class="tab-empty">' +
        '<p>' +
          esc(message) +
        '</p>' +
      '</div>';
  }

  /* ══════════════════════════════════════════════════════════════
     RELATED SEARCH INSERTION
  ══════════════════════════════════════════════════════════════ */

  var SUGGESTION_POSITIONS = [3, 9];
  var CHIPS_PER_STRIP = 5;

  /* ══════════════════════════════════════════════════════════════
     NEWS INITIALIZER
  ══════════════════════════════════════════════════════════════ */

  window._atkynInit_news =
    function () {
      var pageContent =
        window._atkynPageContent;

      if (!pageContent) {
        return;
      }

      var query = '';

      try {
        query =
          sessionStorage.getItem(
            'atkyn_last_query'
          ) || '';
      } catch (_) {
        query = '';
      }

      query =
        String(query).trim();

      if (!query) {
        showMessage(
          pageContent,
          'Search something to see news'
        );

        return;
      }

      /*
       * Intentionally no loading indicator.
       * Existing page remains untouched until
       * the News response is ready.
       */
      fetch(
        NEWS_API +
          '?q=' +
          encodeURIComponent(query),
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'default'
        }
      )
        .then(function (response) {
          if (!response.ok) {
            throw new Error(
              'HTTP ' +
                response.status
            );
          }

          return response.json();
        })
        .then(function (data) {
          var results =
            data &&
            Array.isArray(
              data.results
            )
              ? data.results.slice(
                  0,
                  MAX_RESULTS
                )
              : [];

          if (!results.length) {
            throw new Error(
              'empty'
            );
          }

          var plan =
            buildRenderPlan(
              results
            );

          var terms =
            extractSuggestions(
              results,
              query
            );

          var list =
            document.createElement(
              'div'
            );

          list.className =
            'news-list';

          var nonAdCount = 0;

          results.forEach(
            function (
              item,
              index
            ) {
              var type =
                plan[index];

              if (
                type === 'ad'
              ) {
                list.appendChild(
                  buildAdCard(
                    item
                  )
                );

                return;
              }

              if (
                type === 'hero' ||
                type === 'featured'
              ) {
                list.appendChild(
                  buildImageCard(
                    item,
                    type
                  )
                );
              } else {
                list.appendChild(
                  buildCard(
                    item
                  )
                );
              }

              nonAdCount++;

              var slot =
                SUGGESTION_POSITIONS.indexOf(
                  nonAdCount
                );

              if (slot === -1) {
                return;
              }

              var chips =
                terms.slice(
                  slot *
                    CHIPS_PER_STRIP,
                  (slot + 1) *
                    CHIPS_PER_STRIP
                );

              if (!chips.length) {
                return;
              }

              var strip =
                buildSuggestionStrip(
                  chips
                );

              if (strip) {
                list.appendChild(
                  strip
                );
              }
            }
          );

          pageContent.innerHTML = '';

          pageContent.appendChild(
            list
          );

          if (
            typeof window._atkynAnimateIn ===
            'function'
          ) {
            window._atkynAnimateIn();
          }
        })
        .catch(
          function (error) {
            console.error(
              '[atkyn news]',
              error
            );

            showMessage(
              pageContent,
              'Could not load news'
            );
          }
        );
    };

  window._atkynInit_news();

}());
