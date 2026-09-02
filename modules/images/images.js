/* ══════════════════════════════════════════════════════════════
   modules/images/images.js
   ATKYN — Premium Editorial Image Gallery
   ONE API CALL · Hero + Masonry Sections · Stable Layout
   Generation-safe · Reliable fallback · No Wikipedia
   Version: 2.0
══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';


  /* ═══════════════════════════════════════════════════════════
     IN-MEMORY URL CACHE
     Persists across tab reinitializations so repeated queries
     don't re-request already-resolved image URLs.
     Rejected promises are ALWAYS deleted — never retained.
  ═══════════════════════════════════════════════════════════ */

  const _urlCache = new Map();


  /* ═══════════════════════════════════════════════════════════
     GENERATION COUNTER
     Incremented on every init. All async callbacks capture the
     generation at creation time and bail out if _gen has moved.
     Prevents Search A from corrupting Search B.
  ═══════════════════════════════════════════════════════════ */

  let _gen = 0;


  /* ═══════════════════════════════════════════════════════════
     PER-INIT STATE
     Reset fully on every _atkynInit_images call.
  ═══════════════════════════════════════════════════════════ */

  let _observer    = null;
  let _query       = '';
  let _seen        = new Set();
  let _warmQueue   = [];
  let _warmRunning = false;
  let _gallery     = null;


  /* ═══════════════════════════════════════════════════════════
     SEEDED PRNG (Mulberry32)
     Deterministic per query string — same query always yields
     the same hero/grid layout sequence.
  ═══════════════════════════════════════════════════════════ */

  function _makePrng(seed) {
    var s = seed >>> 0;
    return function () {
      s += 0x6D2B79F5;
      var t = s;
      t  = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function _hashStr(str) {
    var h = 0x811C9DC5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h  = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }


  /* ═══════════════════════════════════════════════════════════
     TITLE CLEANER
     Removes trailing ellipsis, separators, excess words.
  ═══════════════════════════════════════════════════════════ */

  function _cleanTitle(value) {
    if (!value || typeof value !== 'string') return '';
    return value
      .replace(/\u2026+/g, '')
      .replace(/\.{2,}$/g, '')
      .replace(/\s*[-\u2013\u2014:|•·]\s*$/g, '')
      .trim();
  }

  function _shortTitle(raw) {
    var clean = _cleanTitle(raw);
    if (!clean) return '';
    return clean.split(/\s+/).slice(0, 3).join(' ');
  }


  /* ═══════════════════════════════════════════════════════════
     NORMALIZER
     Primary contract: results[].img_src / url / width / height
     Legacy tolerance: images[].imageUrl / link / imageWidth
  ═══════════════════════════════════════════════════════════ */

  function _normalize(item) {
    if (!item || typeof item !== 'object') return null;

    var src =
      item.img_src       ||
      item.imageUrl      ||
      item.image_url     ||
      '';

    if (!src) return null;

    var thumb =
      item.thumbnail_src ||
      item.thumbnailUrl  ||
      '';

    /* Don't store thumb if it's identical to src */
    if (thumb === src) thumb = '';

    return {
      title:         typeof item.title === 'string' ? item.title : '',
      url:           item.url || item.link || src,
      img_src:       src,
      thumbnail_src: thumb,
      width:  Number(item.width  || item.imageWidth  || item.thumbnailWidth  || 0),
      height: Number(item.height || item.imageHeight || item.thumbnailHeight || 0)
    };
  }


  /* ═══════════════════════════════════════════════════════════
     EXTRACT + DEDUPE API RESULTS
  ═══════════════════════════════════════════════════════════ */

  function _extractResults(data) {
    var raw =
      Array.isArray(data && data.results)
        ? data.results
        : Array.isArray(data && data.images)
          ? data.images
          : [];

    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var n = _normalize(raw[i]);
      if (!n) continue;
      if (_seen.has(n.img_src)) continue;
      _seen.add(n.img_src);
      out.push(n);
    }
    return out;
  }


  /* ═══════════════════════════════════════════════════════════
     URL PRELOAD
     Returns a Promise that resolves with the loaded Image.
     On failure: always deletes cache entry so next attempt
     starts fresh (no permanently-cached rejections).
  ═══════════════════════════════════════════════════════════ */

  function _preload(src) {
    if (!src) return Promise.resolve(null);

    var cached = _urlCache.get(src);
    if (cached) return cached;

    var p = new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';

      img.onload = function () {
        img.onload  = null;
        img.onerror = null;

        var afterDecode = function () {
          _urlCache.set(src, Promise.resolve(img));
          resolve(img);
        };

        if (typeof img.decode === 'function') {
          img.decode().catch(function () {}).then(afterDecode, afterDecode);
        } else {
          afterDecode();
        }
      };

      img.onerror = function () {
        img.onload  = null;
        img.onerror = null;
        _urlCache.delete(src);
        reject(new Error('load-failed'));
      };

      img.src = src;
    });

    _urlCache.set(src, p);
    return p;
  }


  /* ═══════════════════════════════════════════════════════════
     LOAD TILE
     Full pipeline:
       hi-res → thumbnail → delayed hi-res retry → stable placeholder

     Generation-aware: stale callbacks are silently dropped.
     Geometry is NEVER collapsed on failure.

     imgEl carries:
       data-src   = img_src        (high-res)
       data-thumb = thumbnail_src  (fallback, may be empty)
  ═══════════════════════════════════════════════════════════ */

  function _loadTile(imgEl, capturedGen) {
    if (!imgEl || !imgEl.isConnected)           return;
    if (imgEl.dataset.loading === '1')          return;
    if (imgEl.dataset.loaded  === '1')          return;

    var hiSrc    = imgEl.dataset.src   || '';
    var thumbSrc = imgEl.dataset.thumb || '';

    if (!hiSrc) return;

    imgEl.dataset.loading = '1';

    /* Reveal: just opacity, no layout change */
    function _reveal() {
      imgEl.dataset.loaded  = '1';
      imgEl.dataset.loading = '0';
      requestAnimationFrame(function () {
        if (imgEl.isConnected) {
          imgEl.classList.add('img-loaded');
        }
      });
    }

    /* Mark failed — geometry stays intact */
    function _fail() {
      imgEl.dataset.loading = '0';
      imgEl.dataset.failed  = '1';
    }

    /*
      Attempt to load one URL into the DOM img element.
      Uses cache when available; falls back to direct src assignment.
      onFail is called if/when this src fails.
    */
    function _attempt(src, onFail) {
      if (_gen !== capturedGen) return;
      if (!imgEl.isConnected)  return;
      if (!src) {
        onFail();
        return;
      }

      var cached = _urlCache.get(src);

      if (cached) {
        /* Already pending or resolved — chain on it */
        cached
          .then(function () {
            if (_gen !== capturedGen || !imgEl.isConnected) return;
            /* Guard: don't re-assign src if already loaded correctly */
            if (imgEl.dataset.loaded === '1') return;
            imgEl.onload  = null;
            imgEl.onerror = null;
            imgEl.src = src;
            _reveal();
          })
          .catch(function () {
            /* Cached promise rejected — clean up and fall through */
            _urlCache.delete(src);
            if (_gen === capturedGen && imgEl.isConnected) {
              onFail();
            }
          });
        return;
      }

      /* No cache hit — wire DOM events and set src */
      imgEl.onload = function () {
        if (_gen !== capturedGen) return;
        imgEl.onload  = null;
        imgEl.onerror = null;
        /* Cache the resolved URL so subsequent tiles benefit */
        _urlCache.set(src, Promise.resolve(imgEl));
        _reveal();
      };

      imgEl.onerror = function () {
        imgEl.onload  = null;
        imgEl.onerror = null;
        _urlCache.delete(src);
        if (_gen === capturedGen && imgEl.isConnected) {
          onFail();
        }
      };

      imgEl.src = src;
    }

    /* Pipeline */
    _attempt(hiSrc, function () {
      /* hi-res failed */
      if (thumbSrc) {
        _attempt(thumbSrc, function () {
          /* thumbnail also failed — one delayed hi-res retry */
          setTimeout(function () {
            if (_gen !== capturedGen) return;
            if (!imgEl.isConnected)  return;
            if (imgEl.dataset.loaded === '1') return;
            /* Clear any stale src to force a fresh network request */
            imgEl.src = '';
            _urlCache.delete(hiSrc);
            _attempt(hiSrc, _fail);
          }, 2800);
        });
      } else {
        /* No thumbnail — one delayed hi-res retry */
        setTimeout(function () {
          if (_gen !== capturedGen) return;
          if (!imgEl.isConnected)  return;
          if (imgEl.dataset.loaded === '1') return;
          imgEl.src = '';
          _urlCache.delete(hiSrc);
          _attempt(hiSrc, _fail);
        }, 2800);
      }
    });
  }


  /* ═══════════════════════════════════════════════════════════
     BUILD IMAGE ELEMENT
  ═══════════════════════════════════════════════════════════ */

  function _buildImg(data) {
    var img = document.createElement('img');
    img.className    = 'img-lazy';
    img.alt          = _cleanTitle(data.title);
    img.decoding     = 'async';
    img.dataset.src  = data.img_src;
    img.dataset.thumb = data.thumbnail_src || '';
    /* Prevent browser from auto-loading before observer fires */
    img.loading = 'lazy';
    return img;
  }


  /* ═══════════════════════════════════════════════════════════
     BUILD TILE
     Spacer reserves exact geometry via padding-bottom ratio.
     Overlay + menu sit on top at pointer-events: auto.
  ═══════════════════════════════════════════════════════════ */

  function _buildTile(data) {
    var src = data.img_src;
    if (!src) return null;

    /* Aspect ratio for geometry reservation */
    var aspect =
      data.width && data.height
        ? (data.height / data.width * 100).toFixed(2) + '%'
        : '133.33%';

    /* Anchor */
    var tile = document.createElement('a');
    tile.className = 'img-tile';
    tile.href      = data.url || src;
    tile.target    = '_blank';
    tile.rel       = 'noopener noreferrer';

    /* Spacer reserves geometry */
    var spacer = document.createElement('div');
    spacer.className           = 'img-tile__spacer';
    spacer.style.paddingBottom = aspect;
    spacer.appendChild(_buildImg(data));
    tile.appendChild(spacer);

    /* Overlay */
    var overlay = document.createElement('div');
    overlay.className = 'img-tile__overlay';

    var titleText = _shortTitle(data.title);
    if (titleText) {
      var titleEl = document.createElement('span');
      titleEl.className   = 'img-tile__title';
      titleEl.textContent = titleText;
      overlay.appendChild(titleEl);
    }

    /* 3-dot menu button */
    var menu = document.createElement('button');
    menu.className = 'img-tile__menu';
    menu.type      = 'button';
    menu.setAttribute('aria-label', 'More options');
    menu.innerHTML =
      '<svg width="16" height="4" viewBox="0 0 16 4" fill="none" ' +
      'xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<circle cx="2"  cy="2" r="1.5" fill="currentColor"/>' +
      '<circle cx="8"  cy="2" r="1.5" fill="currentColor"/>' +
      '<circle cx="14" cy="2" r="1.5" fill="currentColor"/>' +
      '</svg>';

    menu.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      tile.dispatchEvent(
        new CustomEvent('img-menu', { bubbles: true, detail: data })
      );
    });

    overlay.appendChild(menu);
    tile.appendChild(overlay);

    return tile;
  }


  /* ═══════════════════════════════════════════════════════════
     INTERSECTION OBSERVER
     Large rootMargin for fast-scroll safety.
     Callback only starts image loading — no layout work.
  ═══════════════════════════════════════════════════════════ */

  function _initObserver(capturedGen) {
    /* Always disconnect any prior observer before creating a new one */
    if (_observer) {
      _observer.disconnect();
      _observer = null;
    }

    _observer = new IntersectionObserver(
      function (entries, obs) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (!entry.isIntersecting) continue;
          var imgEl = entry.target;
          obs.unobserve(imgEl);
          _loadTile(imgEl, capturedGen);
        }
      },
      { rootMargin: '3000px 0px' }
    );
  }

  function _observe(tile) {
    var imgEl = tile.querySelector('.img-lazy');
    if (!imgEl || !_observer) return;
    _observer.observe(imgEl);
  }


  /* ═══════════════════════════════════════════════════════════
     LAYOUT PLANNER
     Divides results into sections: hero (full-width) or grid
     (2-column masonry). First result is always a hero.
     Subsequent sections via seeded PRNG — same query = same layout.

     Returns array of section descriptors:
       { type: 'hero', items: [data] }
       { type: 'grid', items: [data, data, ...] }

     Hero → 1 item consumed.
     Grid → 2–4 items consumed (2-col masonry group).
  ═══════════════════════════════════════════════════════════ */

  function _planLayout(results, query) {
    var rng = _makePrng(_hashStr(query || 'atkyn'));
    var sections = [];
    var i   = 0;
    var len = results.length;

    /* First image always a full-width hero */
    if (len > 0) {
      sections.push({ type: 'hero', items: [results[0]] });
      i = 1;
    }

    while (i < len) {
      var remaining = len - i;

      /* Hero probability ~35%. Never two consecutive heroes.
         Require at least 2 remaining so a grid item isn't orphaned. */
      var lastWasHero =
        sections.length > 0 &&
        sections[sections.length - 1].type === 'hero';

      var wantHero =
        !lastWasHero &&
        remaining >= 2 &&
        rng() < 0.35;

      if (wantHero) {
        sections.push({ type: 'hero', items: [results[i]] });
        i += 1;
      } else {
        /* Grid: consume 2–4 items */
        var take = remaining >= 4
          ? (rng() < 0.5 ? 4 : 2)
          : remaining;
        take = Math.min(take, 4);
        var group = results.slice(i, i + take);
        sections.push({ type: 'grid', items: group });
        i += take;
      }
    }

    return sections;
  }


  /* ═══════════════════════════════════════════════════════════
     BUILD HERO SECTION
  ═══════════════════════════════════════════════════════════ */

  function _buildHero(data) {
    var section = document.createElement('div');
    section.className = 'gallery-hero';

    var tile = _buildTile(data);
    if (tile) {
      section.appendChild(tile);
      _observe(tile);
    }

    return section;
  }


  /* ═══════════════════════════════════════════════════════════
     BUILD GRID SECTION
     2-column masonry, balanced by cumulative aspect-ratio height.
     Columns feel like Pinterest — no forced equal heights.
  ═══════════════════════════════════════════════════════════ */

  function _buildGridSection(items) {
    var section = document.createElement('div');
    section.className = 'gallery-grid';

    var colA = document.createElement('div');
    var colB = document.createElement('div');
    colA.className = 'gallery-col';
    colB.className = 'gallery-col';

    /* Track cumulative virtual height per column using aspect ratios */
    var heights = [0, 0];

    for (var i = 0; i < items.length; i++) {
      var data = items[i];
      var tile = _buildTile(data);
      if (!tile) continue;

      var ratio =
        data.width && data.height
          ? data.height / data.width
          : 1.3333;

      var col = heights[0] <= heights[1] ? 0 : 1;

      if (col === 0) {
        colA.appendChild(tile);
      } else {
        colB.appendChild(tile);
      }

      heights[col] += ratio;
      _observe(tile);
    }

    section.appendChild(colA);
    section.appendChild(colB);
    return section;
  }


  /* ═══════════════════════════════════════════════════════════
     RENDER GALLERY
     Uses DocumentFragment for one atomic DOM insertion.
     ALL geometry is reserved before any image starts loading.
  ═══════════════════════════════════════════════════════════ */

  function _renderGallery(results, query) {
    var sections = _planLayout(results, query);
    var frag = document.createDocumentFragment();

    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      if (section.type === 'hero') {
        frag.appendChild(_buildHero(section.items[0]));
      } else {
        frag.appendChild(_buildGridSection(section.items));
      }
    }

    /* ONE atomic DOM insertion */
    _gallery.replaceChildren(frag);
  }


  /* ═══════════════════════════════════════════════════════════
     CACHE WARMER
     Gradually preloads remaining images at idle priority.
     Generation-aware: stops immediately if _gen has moved on.
  ═══════════════════════════════════════════════════════════ */

  function _startWarm(capturedGen) {
    if (_warmRunning) return;
    _warmRunning = true;

    function _next() {
      if (_gen !== capturedGen) {
        _warmRunning = false;
        return;
      }

      if (!_warmQueue.length) {
        _warmRunning = false;
        return;
      }

      var src = _warmQueue.shift();
      if (src && !_urlCache.has(src)) {
        _preload(src).catch(function () {});
      }

      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(_next, { timeout: 120 });
      } else {
        setTimeout(_next, 40);
      }
    }

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(_next, { timeout: 120 });
    } else {
      setTimeout(_next, 40);
    }
  }


  /* ═══════════════════════════════════════════════════════════
     FETCH IMAGES
     EXACTLY ONE /api/images request per initialization.
     No secondary API calls. No Wikipedia. No pagination.
  ═══════════════════════════════════════════════════════════ */

  function _fetchImages(capturedGen) {
    var endpoint = '/api/images?q=' + encodeURIComponent(_query);

    fetch(endpoint, {
      method:      'GET',
      cache:       'default',
      credentials: 'same-origin'
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (_gen !== capturedGen) return;   /* stale — discard */

        var results = _extractResults(data);

        var page = document.getElementById('pageContent');
        if (!page || _gen !== capturedGen) return;

        if (!results.length) {
          var empty = document.createElement('div');
          empty.className = 'tab-empty';
          empty.innerHTML = '<p>No images found</p>';
          page.replaceChildren(empty);
          return;
        }

        /*
          Step 1: Render ALL geometry atomically into _gallery (no images start yet).
          Step 2: Insert _gallery into page — replaces skeleton in one swap.
          Step 3: Immediately preload first batch for first paint.
          Step 4: Queue remainder for idle warming.
        */
        _renderGallery(results, _query);

        /* Atomic swap: skeleton → gallery */
        page.replaceChildren(_gallery);

        var FIRST_BATCH = 8;

        for (var i = 0; i < Math.min(FIRST_BATCH, results.length); i++) {
          _preload(results[i].img_src).catch(function () {});
        }

        _warmQueue = [];
        for (var j = FIRST_BATCH; j < results.length; j++) {
          _warmQueue.push(results[j].img_src);
        }

        _startWarm(capturedGen);
      })
      .catch(function () {
        if (_gen !== capturedGen) return;

        var page = document.getElementById('pageContent');
        if (!page) return;

        var err = document.createElement('div');
        err.className = 'tab-empty';
        err.innerHTML = '<p>Could not load images</p>';
        page.replaceChildren(err);
      });
  }


  /* ═══════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════ */

  window._atkynInit_images = function () {

    /* Invalidate all previous async work */
    _gen += 1;
    var capturedGen = _gen;

    /* Disconnect stale observer before any new one is created */
    if (_observer) {
      _observer.disconnect();
      _observer = null;
    }

    /* Reset all per-search state */
    _seen        = new Set();
    _warmQueue   = [];
    _warmRunning = false;
    _gallery     = null;

    _query = (sessionStorage.getItem('atkyn_last_query') || '').trim();

    var page = document.getElementById('pageContent');
    if (!page) return;

    if (!_query) {
      page.innerHTML =
        '<div class="tab-empty"><p>Search something to see images</p></div>';
      return;
    }

    /* Show skeleton immediately */
    page.innerHTML =
      '<div class="tab-skeleton grid">' +
        '<div class="sk-col">' +
          '<div class="sk-img" style="padding-bottom:110%"></div>' +
          '<div class="sk-img" style="padding-bottom:78%"></div>' +
          '<div class="sk-img" style="padding-bottom:125%"></div>' +
        '</div>' +
        '<div class="sk-col">' +
          '<div class="sk-img" style="padding-bottom:76%"></div>' +
          '<div class="sk-img" style="padding-bottom:118%"></div>' +
          '<div class="sk-img" style="padding-bottom:88%"></div>' +
        '</div>' +
      '</div>';

    /* Create gallery container */
    _gallery = document.createElement('div');
    _gallery.className = 'images-grid';

    /* Init observer before fetch so first tiles are watched immediately */
    _initObserver(capturedGen);

    /* ONE API CALL — fetch will call page.replaceChildren(_gallery) when ready */
    _fetchImages(capturedGen);
  };


  /* Auto-run on script load */
  window._atkynInit_images();

}());
