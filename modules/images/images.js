/* modules/images/images.js
   Atkyn Images Masonry
   Clean • No Wikipedia • No Sentinel • No Dead Wikipedia Code
   Smooth incremental rendering • Stable layout
*/

(function () {
  'use strict';

  let _seen = new Set();
  let _cols = [null, null];
  let _colH = [0, 0];

  let _grid = null;
  let _lazyIo = null;

  let _q = '';
  let _queue = [];
  let _batchTimer = null;


  /* ── Shortest column ──────────────────────────────────────── */

  function _shortCol() {
    return _colH[0] <= _colH[1] ? 0 : 1;
  }


  /* ── Compact title ────────────────────────────────────────── */

  function _shortTitle(raw) {
    if (!raw) return '';

    return raw
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join(' ');
  }


  /* ── Tile builder ─────────────────────────────────────────── */

  function _buildTile(img) {
    const src =
      img.img_src ||
      img.thumbnail_src ||
      '';

    const thumb =
      img.thumbnail_src ||
      img.img_src ||
      '';

    if (!src) return null;


    /* Stable aspect ratio prevents layout movement */

    const aspect =
      img.width && img.height
        ? ((img.height / img.width) * 100).toFixed(2) + '%'
        : '133.33%';


    /* Tile */

    const a = document.createElement('a');

    a.className = 'img-tile';
    a.href = img.url || src;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';


    /* Aspect-ratio spacer */

    const spacer = document.createElement('div');

    spacer.className = 'img-tile__spacer';
    spacer.style.paddingBottom = aspect;


    /* Image */

    const imgEl = document.createElement('img');

    imgEl.alt = img.title || '';
    imgEl.decoding = 'async';

    imgEl.dataset.src = src;
    imgEl.dataset.thumb = thumb;
    imgEl.className = 'img-lazy';


    /* Image loaded */

    imgEl.onload = function () {
      this.classList.add('img-loaded');
    };


    /* Thumbnail fallback */

    imgEl.onerror = function () {
      if (
        this.dataset.triedThumb !== '1' &&
        thumb &&
        thumb !== this.src
      ) {
        this.dataset.triedThumb = '1';
        this.src = thumb;
        return;
      }

      a.remove();
    };


    spacer.appendChild(imgEl);
    a.appendChild(spacer);


    /* Overlay */

    const title = _shortTitle(img.title);

    if (title) {
      const overlay = document.createElement('div');

      overlay.className = 'img-tile__overlay';


      /* Title */

      const titleEl = document.createElement('span');

      titleEl.className = 'img-tile__title';
      titleEl.textContent = title;


      /* Menu */

      const menu = document.createElement('button');

      menu.className = 'img-tile__menu';
      menu.type = 'button';
      menu.setAttribute('aria-label', 'More options');

      menu.innerHTML = `
        <svg
          width="16"
          height="4"
          viewBox="0 0 16 4"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="2" cy="2" r="1.5" fill="currentColor"/>
          <circle cx="8" cy="2" r="1.5" fill="currentColor"/>
          <circle cx="14" cy="2" r="1.5" fill="currentColor"/>
        </svg>
      `;


      menu.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        a.dispatchEvent(
          new CustomEvent('img-menu', {
            bubbles: true,
            detail: img
          })
        );
      });


      overlay.appendChild(titleEl);
      overlay.appendChild(menu);

      a.appendChild(overlay);
    }


    return a;
  }


  /* ── Lazy loader ───────────────────────────────────────────── */

  function _initLazyIo() {
    if (_lazyIo) {
      _lazyIo.disconnect();
    }


    _lazyIo = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;

          const el = entry.target;

          observer.unobserve(el);


          const thumbSrc =
            el.dataset.thumb ||
            el.dataset.src ||
            '';

          const fullSrc =
            el.dataset.src ||
            '';


          /* Fast first paint */

          if (thumbSrc) {
            el.src = thumbSrc;
          }


          /* Full-resolution preload */

          if (
            fullSrc &&
            fullSrc !== thumbSrc
          ) {
            const full = new Image();

            full.decoding = 'async';

            full.onload = function () {
              if (!el.isConnected) return;

              el.src = fullSrc;
            };

            full.src = fullSrc;
          }
        });
      },
      {
        rootMargin: '1000px 0px'
      }
    );
  }


  /* ── Observe one image ────────────────────────────────────── */

  function _observeImage(tile) {
    if (!_lazyIo || !tile) return;

    const imgEl =
      tile.querySelector('.img-lazy');

    if (!imgEl) return;

    _lazyIo.observe(imgEl);
  }


  /* ── Incremental renderer ─────────────────────────────────── */

  function _drip() {
    if (!_queue.length) {
      _batchTimer = null;
      return;
    }


    /*
      Small batches keep the main thread responsive.
      Six tiles per frame group is enough for fast visual fill
      without creating one huge synchronous DOM operation.
    */

    const batch = _queue.splice(0, 6);


    batch.forEach(function (img) {
      const tile = _buildTile(img);

      if (!tile) return;


      const column = _shortCol();

      _cols[column].appendChild(tile);


      const aspect =
        img.width && img.height
          ? img.height / img.width
          : 1.33;

      _colH[column] += aspect;


      /* Direct observation — no full-grid querySelectorAll */

      _observeImage(tile);
    });


    _batchTimer = setTimeout(_drip, 60);
  }


  /* ── Append fresh results ─────────────────────────────────── */

  function _appendResults(results) {
    if (!Array.isArray(results) || !results.length) {
      return;
    }


    const fresh = [];


    results.forEach(function (item) {
      const key =
        item.img_src ||
        item.thumbnail_src ||
        '';


      if (!key || _seen.has(key)) {
        return;
      }


      _seen.add(key);
      fresh.push(item);
    });


    if (!fresh.length) return;


    _queue.push(...fresh);


    if (!_batchTimer) {
      _drip();
    }
  }


  /* ── Fetch images from Atkyn API ──────────────────────────── */

  function _fetchImages() {
    fetch(
      '/api/images?q=' +
      encodeURIComponent(_q)
    )
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Image request failed');
        }

        return response.json();
      })
      .then(function (data) {
        const results =
          Array.isArray(data.results)
            ? data.results
            : [];


        if (!results.length) {
          const pc =
            document.getElementById('pageContent');

          if (pc) {
            pc.innerHTML =
              '<div class="tab-empty"><p>No images found</p></div>';
          }

          return;
        }


        _appendResults(results);
      })
      .catch(function () {
        const pc =
          document.getElementById('pageContent');

        if (pc) {
          pc.innerHTML =
            '<div class="tab-empty"><p>Could not load images</p></div>';
        }
      });
  }


  /* ── Init ─────────────────────────────────────────────────── */

  window._atkynInit_images = function () {

    /* Reset previous state */

    _seen = new Set();
    _cols = [null, null];
    _colH = [0, 0];

    _grid = null;
    _q = '';
    _queue = [];


    if (_batchTimer) {
      clearTimeout(_batchTimer);
      _batchTimer = null;
    }


    if (_lazyIo) {
      _lazyIo.disconnect();
      _lazyIo = null;
    }


    /* Current search */

    _q =
      sessionStorage.getItem(
        'atkyn_last_query'
      ) || '';


    const pc =
      document.getElementById('pageContent');


    if (!pc) return;


    if (!_q) {
      pc.innerHTML =
        '<div class="tab-empty"><p>Search something to see images</p></div>';

      return;
    }


    /* ── Sharp static skeleton ─────────────────────────────── */

    pc.innerHTML = `
      <div class="tab-skeleton grid">
        <div class="sk-col">
          <div class="sk-img" style="padding-bottom:133%"></div>
          <div class="sk-img" style="padding-bottom:75%"></div>
          <div class="sk-img" style="padding-bottom:110%"></div>
        </div>

        <div class="sk-col">
          <div class="sk-img" style="padding-bottom:80%"></div>
          <div class="sk-img" style="padding-bottom:130%"></div>
          <div class="sk-img" style="padding-bottom:90%"></div>
        </div>
      </div>
    `;


    /* Lazy observer */

    _initLazyIo();


    /* Masonry grid */

    _grid =
      document.createElement('div');

    _grid.className = 'images-grid';


    for (let i = 0; i < 2; i++) {
      const col =
        document.createElement('div');

      col.className = 'img-col';

      _grid.appendChild(col);
      _cols[i] = col;
    }


    /* Replace skeleton once grid is ready */

    pc.replaceChildren(_grid);


    /* Only ONE network source: Atkyn API */

    _fetchImages();
  };


  /* ── Initial execution ───────────────────────────────────── */

  window._atkynInit_images();

}());
