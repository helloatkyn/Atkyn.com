/* ════════════════════════════════════════════════════════════════
   modules/news/news.js — ATKYN News
   Business design system · no loading UI
════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var NEWS_API = '/api/news';
  var OG_API = '/api/newsog';
  var MAX_RESULTS = 20;

  var SUGGESTION_POSITIONS = [3, 9];
  var CHIPS_PER_STRIP = 5;
  var MAX_SUGGESTIONS = SUGGESTION_POSITIONS.length * CHIPS_PER_STRIP;

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
    if (isNaN(date.getTime())) return String(dateStr);

    var diff = Date.now() - date.getTime();
    if (diff < 60000) return 'just now';

    var minutes = Math.floor(diff / 60000);
    if (minutes < 60) return minutes + 'm ago';

    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';

    return Math.floor(hours / 24) + 'd ago';
  }

  function rand(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function makeSet(text) {
    var set = Object.create(null);
    text.split(/\s+/).forEach(function (word) {
      if (word) set[word] = true;
    });
    return set;
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

    if (!nonAdIndexes.length) return plan;

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
     Client-side only. Scores proper nouns, acronyms, model names
     (GPT-5, ChatGPT) and phrases repeated across headlines; drops
     stop words and headline filler.
  ══════════════════════════════════════════════════════════════ */

  var STOP_WORDS = makeSet(
    'the a an and or but in on at to for of with by from is are was were ' +
    'be been being as it its this that these those how why what who whom ' +
    'when where which can could will would should may might has have had ' +
    'having not no so do does did after before over under than then into ' +
    'onto about amid against between during while because if too very ' +
    'says say said he she his her their they them we you your our i vs via ' +
    'per also just now still yet up out more most less'
  );

  var FILLER_WORDS = makeSet(
    'introducing introduces introduce announces announced announcing ' +
    'launches launched launch unveils unveiled new latest update updates ' +
    'updated report reports reported reportedly show shows showing shown ' +
    'watch live today tonight week weekly month year years first last next ' +
    'top best worst big biggest major key get gets getting got make makes ' +
    'making made take takes taking here there everything know need needs ' +
    'want thing things one two three four five six seven eight nine ten ' +
    'dots breaking exclusive analysis opinion video videos photo photos ' +
    'news story stories explained explains explain look looks set plans ' +
    'plan ahead back way ways more'
  );

  function splitSegments(title) {
    return String(title)
      .replace(/['\u2018\u2019]s\b/g, '')
      .replace(/['\u2018\u2019]/g, '')
      .split(/[:;,.!?()\[\]{}"\u201C\u201D\u2013\u2014|\/]+|\s-\s/)
      .map(function (segment) {
        return segment
          .split(/[^\w&+#\-\u00C0-\u024F]+/)
          .map(function (token) {
            return token.replace(/^-+|-+$/g, '');
          })
          .filter(Boolean);
      })
      .filter(function (tokens) {
        return tokens.length > 0;
      });
  }

  /* Title Case headlines make capitalisation meaningless as a signal. */
  function capitalizationIsInformative(title) {
    var words = String(title)
      .split(/\s+/)
      .filter(function (word) {
        return word.length > 3 && /[A-Za-z]/.test(word);
      });

    if (words.length < 3) return true;

    var capitalized = words.filter(function (word) {
      return /^[A-Z]/.test(word);
    }).length;

    return capitalized / words.length < 0.6;
  }

  /* Returns null for unusable words, else { word, lower, strength }.
     strength: 3 model/camel-case, 2 acronym, 1 proper noun, 0 plain. */
  function classifyWord(word, capsMatter) {
    var lower = word.toLowerCase();

    if (/^[\d.,%$+\-]+$/.test(word)) return null;
    if (!/[A-Za-z\u00C0-\u024F]/.test(word)) return null;
    if (STOP_WORDS[lower] || FILLER_WORDS[lower]) return null;

    var hasDigit = /\d/.test(word);
    var display = word;
    var strength = 0;

    if (word.length > 5 && word === word.toUpperCase() && !hasDigit) {
      display = word.charAt(0) + word.slice(1).toLowerCase();
    } else if (/^[A-Z]{2,5}$/.test(word)) {
      strength = 2;
    } else if (hasDigit || /[a-z][A-Z]/.test(word)) {
      strength = 3;
    } else if (word.length < 3) {
      return null;
    } else if (capsMatter && /^[A-Z]/.test(word) && word.length >= 4) {
      strength = 1;
    }

    return { word: display, lower: lower, strength: strength };
  }

  function extractSuggestions(results, baseQuery) {
    var queryWords = makeSet(String(baseQuery || '').toLowerCase());
    var stats = Object.create(null);
    var order = 0;

    function bump(key, text, strength, isPhrase) {
      var entry = stats[key];

      if (!entry) {
        entry = stats[key] = {
          key: key,
          text: text,
          count: 0,
          strength: 0,
          phrase: isPhrase,
          order: order++
        };
      }

      entry.count++;

      if (strength > entry.strength) {
        entry.strength = strength;
        entry.text = text;
      }
    }

    results.forEach(function (item) {
      if (!item || item._isAd || !item.title) return;

      var capsInformative = capitalizationIsInformative(item.title);

      splitSegments(item.title).forEach(function (tokens, segmentIndex) {
        var previous = null;

        tokens.forEach(function (token, tokenIndex) {
          var isTitleStart = segmentIndex === 0 && tokenIndex === 0;
          var info = classifyWord(token, capsInformative && !isTitleStart);

          if (!info) {
            previous = null;
            return;
          }

          if (!queryWords[info.lower]) {
            bump(info.lower, info.word, info.strength, false);
          }

          if (
            previous &&
            !(queryWords[previous.lower] && queryWords[info.lower])
          ) {
            bump(
              previous.lower + ' ' + info.lower,
              previous.word + ' ' + info.word,
              previous.strength + info.strength,
              true
            );
          }

          previous = info;
        });
      });
    });

    var candidates = Object.keys(stats)
      .map(function (key) {
        return stats[key];
      })
      .filter(function (entry) {
        return entry.phrase
          ? entry.count >= 2
          : entry.count >= 2 || entry.strength >= 1;
      })
      .map(function (entry) {
        entry.score = entry.phrase
          ? entry.count * 3 + entry.strength
          : entry.count * 2 + entry.strength * 2;
        return entry;
      })
      .sort(function (a, b) {
        return b.score - a.score || a.order - b.order;
      });

    var picked = [];

    candidates.forEach(function (entry) {
      if (picked.length >= MAX_SUGGESTIONS) return;

      if (entry.phrase) {
        var parts = entry.key.split(' ');

        /* A phrase replaces its plain-word components ("AI models" ≻ "models"). */
        picked = picked.filter(function (other) {
          return !(
            !other.phrase &&
            other.strength < 2 &&
            parts.indexOf(other.key) !== -1
          );
        });

        picked.push(entry);
        return;
      }

      var coveredByPhrase = picked.some(function (other) {
        return (
          other.phrase &&
          entry.strength < 2 &&
          other.key.split(' ').indexOf(entry.key) !== -1
        );
      });

      if (!coveredByPhrase) picked.push(entry);
    });

    return picked.slice(0, MAX_SUGGESTIONS).map(function (entry) {
      return entry.text;
    });
  }

  function buildSuggestionStrip(terms) {
    if (!terms || !terms.length) return null;

    var strip = document.createElement('div');
    strip.className = 'news-suggestions';

    var label = document.createElement('span');
    label.className = 'news-suggestions-label';
    label.textContent = 'Related searches';

    var group = document.createElement('div');
    group.className = 'news-suggestions-list';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Related searches');

    terms.forEach(function (term) {
      var button = document.createElement('button');

      button.type = 'button';
      button.className = 'news-suggestion-chip';
      button.textContent = term;

      button.addEventListener('click', function () {
        try {
          sessionStorage.setItem('atkyn_last_query', term);
        } catch (_) {}

        if (typeof window._atkynSearch === 'function') {
          window._atkynSearch(term);
          return;
        }

        window.dispatchEvent(
          new CustomEvent('atkyn:search', { detail: { q: term } })
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
    if (!articleUrl) return Promise.resolve(null);

    if (Object.prototype.hasOwnProperty.call(ogCache, articleUrl)) {
      return Promise.resolve(ogCache[articleUrl]);
    }

    return fetch(OG_API + '?url=' + encodeURIComponent(articleUrl), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'default'
    })
      .then(function (response) {
        if (!response.ok) throw new Error('OG HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var image = data && data.og ? String(data.og) : null;
        ogCache[articleUrl] = image;
        return image;
      })
      .catch(function () {
        ogCache[articleUrl] = null;
        return null;
      });
  }

  function dropImage(card, wrap) {
    if (!card) return;

    card.classList.add('news-card--no-image');

    if (wrap && wrap.parentNode) {
      wrap.parentNode.removeChild(wrap);
    }
  }

  function hydrateImg(card, image, wrap) {
    if (!card || !image || !image.dataset.url) {
      dropImage(card, wrap);
      return;
    }

    fetchOg(image.dataset.url).then(function (src) {
      if (!card.parentNode) return;

      if (!src) {
        dropImage(card, wrap);
        return;
      }

      image.onload = function () {
        if (wrap && wrap.parentNode) wrap.classList.add('loaded');
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
    var source = item && item.source ? esc(item.source) : '';
    var ago = item ? timeAgo(item.publishedDate) : '';

    if (!source && !ago) return '';

    var html = '<div class="news-meta">';

    if (source) html += '<span class="news-source">' + source + '</span>';

    if (source && ago) {
      html += '<span class="news-meta-dot" aria-hidden="true"></span>';
    }

    if (ago) html += '<span class="news-time">' + esc(ago) + '</span>';

    return html + '</div>';
  }

  function buildBody(item) {
    var body = document.createElement('div');

    body.className = 'news-card-body';
    body.innerHTML =
      buildMeta(item) +
      '<div class="news-title">' +
      esc(item && item.title ? item.title : '') +
      '</div>';

    return body;
  }

  function buildLink(className, item) {
    var link = document.createElement('a');

    link.className = className;

    /* No URL → inert anchor (no "#" opening a blank tab). */
    if (item && item.url) {
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }

    return link;
  }

  function buildThumb(item, eager) {
    var wrap = document.createElement('div');
    wrap.className = 'news-thumb-wrap';

    var image = document.createElement('img');

    image.className = 'news-thumb';
    image.alt = '';
    image.loading = eager ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.dataset.url = item && item.url ? item.url : '';

    wrap.appendChild(image);

    return { wrap: wrap, img: image };
  }

  /* ── Hero / featured ─────────────────────────────────────────── */

  function buildImageCard(item, type) {
    var outer = document.createElement('div');
    outer.className = 'news-card-outer';

    var card = buildLink('news-card news-card--' + type, item);

    if (!item || !item.url) {
      card.classList.add('news-card--no-image');
      card.appendChild(buildBody(item || {}));
      outer.appendChild(card);
      return outer;
    }

    var thumb = buildThumb(item, type === 'hero');

    card.appendChild(thumb.wrap);
    card.appendChild(buildBody(item));
    outer.appendChild(card);

    hydrateImg(card, thumb.img, thumb.wrap);

    return outer;
  }

  /* ── Standard row ────────────────────────────────────────────── */

  function buildCard(item) {
    var card = buildLink('news-card', item);

    card.appendChild(buildBody(item || {}));

    if (!item || !item.url) {
      card.classList.add('news-card--no-image');
      return card;
    }

    var thumb = buildThumb(item, false);

    card.appendChild(thumb.wrap);
    hydrateImg(card, thumb.img, thumb.wrap);

    return card;
  }

  /* ── Ad row ──────────────────────────────────────────────────── */

  function buildAdCard(item) {
    var card = buildLink('news-ad-card', item);

    var badge = document.createElement('div');
    badge.className = 'news-ad-badge';
    badge.textContent = 'Ad';
    card.appendChild(badge);

    var body = buildBody(item || {});
    body.className = 'news-ad-body';
    card.appendChild(body);

    if (item && item.img_src) {
      var image = document.createElement('img');

      image.className = 'news-ad-thumb';
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.src = item.img_src;

      image.onerror = function () {
        if (image.parentNode) image.parentNode.removeChild(image);
      };

      card.appendChild(image);
    }

    return card;
  }

  function showMessage(pageContent, message) {
    pageContent.innerHTML =
      '<div class="tab-empty"><p>' + esc(message) + '</p></div>';
  }

  /* ══════════════════════════════════════════════════════════════
     NEWS INITIALIZER
  ══════════════════════════════════════════════════════════════ */

  window._atkynInit_news = function () {
    var pageContent = window._atkynPageContent;

    if (!pageContent) return;

    var query = '';

    try {
      query = sessionStorage.getItem('atkyn_last_query') || '';
    } catch (_) {
      query = '';
    }

    query = String(query).trim();

    if (!query) {
      showMessage(pageContent, 'Search something to see news');
      return;
    }

    /* No loading indicator: the page stays untouched until results arrive. */
    fetch(NEWS_API + '?q=' + encodeURIComponent(query), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'default'
    })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var results =
          data && Array.isArray(data.results)
            ? data.results.slice(0, MAX_RESULTS)
            : [];

        if (!results.length) throw new Error('empty');

        var plan = buildRenderPlan(results);
        var terms = extractSuggestions(results, query);

        var list = document.createElement('div');
        list.className = 'news-list';

        var nonAdCount = 0;

        results.forEach(function (item, index) {
          var type = plan[index];

          if (type === 'ad') {
            list.appendChild(buildAdCard(item));
            return;
          }

          if (type === 'hero' || type === 'featured') {
            list.appendChild(buildImageCard(item, type));
          } else {
            list.appendChild(buildCard(item));
          }

          nonAdCount++;

          var slot = SUGGESTION_POSITIONS.indexOf(nonAdCount);
          if (slot === -1) return;

          var strip = buildSuggestionStrip(
            terms.slice(slot * CHIPS_PER_STRIP, (slot + 1) * CHIPS_PER_STRIP)
          );

          if (strip) list.appendChild(strip);
        });

        pageContent.innerHTML = '';
        pageContent.appendChild(list);

        if (typeof window._atkynAnimateIn === 'function') {
          window._atkynAnimateIn();
        }
      })
      .catch(function (error) {
        console.error('[atkyn news]', error);
        showMessage(pageContent, 'Could not load news');
      });
  };

  window._atkynInit_news();
}());
       
