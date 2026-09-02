/* modules/images/images.js
   ATKYN — Premium Images
   Fast-scroll protected
   Stable masonry
   Memory image cache
   Aggressive ahead-of-viewport preload
   No thumbnail swap
   No Wikipedia
   No layout bounce
*/

(function () {
  'use strict';

  /* ────────────────────────────────────────────────────────────
     PERSISTENT IMAGE CACHE
     Survives tab re-initialization inside this page session.
  ──────────────────────────────────────────────────────────── */

  const _imageCache = new Map();


  /* ────────────────────────────────────────────────────────────
     STATE
  ──────────────────────────────────────────────────────────── */

  let _seen = new Set();

  let _cols = [null, null];
  let _colH = [0, 0];

  let _grid = null;
  let _lazyIo = null;

  let _q = '';

  let _preloadList = [];
  let _preloadIndex = 0;
  let _preloadRunning = false;

  let _renderFrame = 0;


  /* ────────────────────────────────────────────────────────────
     SHORTEST COLUMN
  ──────────────────────────────────────────────────────────── */

  function _shortCol() {
    return _colH[0] <= _colH[1] ? 0 : 1;
  }


  /* ────────────────────────────────────────────────────────────
     TITLE
  ──────────────────────────────────────────────────────────── */

  function _shortTitle(raw) {
    if (!raw) return '';

    return raw
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join(' ');
  }


  /* ────────────────────────────────────────────────────────────
     IMAGE PRELOAD CACHE
  ──────────────────────────────────────────────────────────── */

  function _preloadImage(src) {
    if (!src) {
      return Promise.reject(
        new Error('Missing image source')
      );
    }


    const cached = _imageCache.get(src);

    if (cached) {
      return cached;
    }


    const promise = new Promise(function (resolve, reject) {
      const image = new Image();

      image.decoding = 'async';

      image.onload = function () {
        /*
          Decode the already downloaded image where supported.
          This reduces visible decode stalls during fast scrolling.
        */

        if (typeof image.decode === 'function') {
          image.decode()
            .catch(function () {})
            .finally(function () {
              _imageCache.set(src, {
                state: 'loaded',
                image: image
              });

              resolve(image);
            });
        } else {
          _imageCache.set(src, {
            state: 'loaded',
            image: image
          });

          resolve(image);
        }
      };


      image.onerror = function () {
        _imageCache.delete(src);
        reject(
          new Error('Image failed: ' + src)
        );
      };


      image.src = src;
    });


    _imageCache.set(src, {
      state: 'loading',
      promise: promise
    });


    return promise;
  }


  /* ────────────────────────────────────────────────────────────
     LOAD IMAGE INTO TILE
  ──────────────────────────────────────────────────────────── */

  function _loadTileImage(imgEl) {
    if (!imgEl || !imgEl.isConnected) {
      return;
    }


    const src = imgEl.dataset.src;

    if (!src) {
      return;
    }


    if (imgEl.dataset.loading === '1') {
      return;
    }


    imgEl.dataset.loading = '1';


    const cached = _imageCache.get(src);


    /*
      Already decoded/loaded:
      assign immediately without another network fetch.
    */

    if (
      cached &&
      cached.state === 'loaded'
    ) {
      imgEl.src = src;

      /*
        The source is already decoded.
        Reveal on the next paint.
      */

      requestAnimationFrame(function () {
        if (imgEl.isConnected) {
          imgEl.classList.add('img-loaded');
        }
      });

      return;
    }


    _preloadImage(src)
      .then(function () {
        if (!imgEl.isConnected) {
          return;
        }

        imgEl.src = src;

        requestAnimationFrame(function () {
          if (imgEl.isConnected) {
            imgEl.classList.add('img-loaded');
          }
        });
      })
      .catch(function () {
        /*
          Image-specific failure.
          Keep the tile geometry intact instead of
          removing the entire masonry space.
        */

        imgEl.dataset.failed = '1';
      });
  }


  /* ────────────────────────────────────────────────────────────
     BUILD TILE
  ──────────────────────────────────────────────────────────── */

  function _buildTile(data) {
    const src =
      data.img_src ||
      data.thumbnail_src ||
      '';

    if (!src) {
      return null;
    }


    const aspect =
      data.width && data.height
        ? ((data.height / data.width) * 100).toFixed(2) + '%'
        : '133.33%';


    const tile =
      document.createElement('a');

    tile.className =
      'img-tile';

    tile.href =
      data.url || src;

    tile.target =
      '_blank';

    tile.rel =
      'noopener noreferrer';


    /* ── Stable image space ── */

    const spacer =
      document.createElement('div');

    spacer.className =
      'img-tile__spacer';

    spacer.style.paddingBottom =
      aspect;


    /* ── Image ── */

    const image =
      document.createElement('img');

    image.className =
      'img-lazy';

    image.alt =
      data.title || '';

    image.decoding =
      'async';

    image.dataset.src =
      src;


    image.onload =
      function () {
        this.classList.add(
          'img-loaded'
        );
      };


    /*
      Important:
      Never remove the masonry tile on image failure.
      The reserved placeholder remains so scrolling geometry
      cannot suddenly collapse.
    */

    image.onerror =
      function () {
        this.dataset.failed =
          '1';
      };


    spacer.appendChild(image);

    tile.appendChild(spacer);


    /* ── Overlay ── */

    const overlay =
      document.createElement('div');

    overlay.className =
      'img-tile__overlay';


    const title =
      _shortTitle(data.title);

    if (title) {
      const titleEl =
        document.createElement('span');

      titleEl.className =
        'img-tile__title';

      titleEl.textContent =
        title;

      overlay.appendChild(
        titleEl
      );
    }


    /* ── Menu ── */

    const menu =
      document.createElement('button');

    menu.className =
      'img-tile__menu';

    menu.type =
      'button';

    menu.setAttribute(
      'aria-label',
      'More options'
    );

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


    menu.addEventListener(
      'click',
      function (event) {
        event.preventDefault();
        event.stopPropagation();

        tile.dispatchEvent(
          new CustomEvent(
            'img-menu',
            {
              bubbles: true,
              detail: data
            }
          )
        );
      }
    );


    overlay.appendChild(
      menu
    );

    tile.appendChild(
      overlay
    );


    /*
      Keep source metadata on tile for
      later cache/preload operations.
    */

    tile.dataset.imageSrc =
      src;


    return tile;
  }


  /* ────────────────────────────────────────────────────────────
     INTERSECTION OBSERVER
     Huge preload distance protects against very fast scrolling.
  ──────────────────────────────────────────────────────────── */

  function _initLazyObserver() {
    if (_lazyIo) {
      _lazyIo.disconnect();
    }


    _lazyIo =
      new IntersectionObserver(
        function (entries, observer) {

          for (
            const entry of entries
          ) {
            if (!entry.isIntersecting) {
              continue;
            }


            const image =
              entry.target;

            observer.unobserve(
              image
            );


            _loadTileImage(
              image
            );
          }

        },
        {
          /*
            Load images roughly 2500px
            before they enter the viewport.
          */

          rootMargin:
            '2500px 0px'
        }
      );
  }


  /* ────────────────────────────────────────────────────────────
     OBSERVE TILE
  ──────────────────────────────────────────────────────────── */

  function _observeTile(tile) {
    if (
      !_lazyIo ||
      !tile
    ) {
      return;
    }


    const image =
      tile.querySelector(
        '.img-lazy'
      );

    if (!image) {
      return;
    }


    /*
      If already visible / cached,
      load immediately.
      Otherwise observer takes over.
    */

    const src =
      image.dataset.src;

    const cached =
      _imageCache.get(src);


    if (
      cached &&
      cached.state === 'loaded'
    ) {
      _loadTileImage(
        image
      );

      return;
    }


    _lazyIo.observe(
      image
    );
  }


  /* ────────────────────────────────────────────────────────────
     BACKGROUND CACHE WARMING
     Preloads a limited number of future images.
     Does NOT flood the network with every image at once.
  ──────────────────────────────────────────────────────────── */

  function _warmCache() {
    if (_preloadRunning) {
      return;
    }


    if (
      !_preloadList.length ||
      _preloadIndex >= _preloadList.length
    ) {
      return;
    }


    _preloadRunning =
      true;


    const runNext =
      function () {

        if (
          _preloadIndex >=
          _preloadList.length
        ) {
          _preloadRunning =
            false;

          return;
        }


        const src =
          _preloadList[
            _preloadIndex++
          ];


        if (
          src &&
          !_imageCache.has(src)
        ) {
          _preloadImage(
            src
          )
            .catch(function () {})
            .finally(function () {

              /*
                Yield to the browser after
                each preload so scrolling
                stays responsive.
              */

              requestAnimationFrame(
                runNext
              );
            });

          return;
        }


        requestAnimationFrame(
          runNext
        );
      };


    runNext();
  }


  /* ────────────────────────────────────────────────────────────
     APPEND RESULTS
     All tile shells are created immediately.
     This prevents fast scrolling from outrunning DOM rendering.
  ──────────────────────────────────────────────────────────── */

  function _appendResults(results) {
    if (
      !Array.isArray(results) ||
      !results.length
    ) {
      return;
    }


    const fresh = [];


    for (
      const item of results
    ) {
      const key =
        item.img_src ||
        item.thumbnail_src ||
        '';


      if (
        !key ||
        _seen.has(key)
      ) {
        continue;
      }


      _seen.add(key);

      fresh.push(item);
    }


    if (!fresh.length) {
      return;
    }


    /*
      Prepare the cache-warming list.
    */

    for (
      const item of fresh
    ) {
      const src =
        item.img_src ||
        item.thumbnail_src ||
        '';

      if (src) {
        _preloadList.push(src);
      }
    }


    /*
      Build both columns inside fragments.
      Only two final DOM insertions are performed.
    */

    const fragments = [
      document.createDocumentFragment(),
      document.createDocumentFragment()
    ];


    for (
      const item of fresh
    ) {
      const tile =
        _buildTile(item);

      if (!tile) {
        continue;
      }


      const column =
        _shortCol();


      fragments[column].appendChild(
        tile
      );


      const aspect =
        item.width &&
        item.height
          ? item.height / item.width
          : 1.33;


      _colH[column] +=
        aspect;


      _observeTile(
        tile
      );
    }


    /*
      Append all generated tiles immediately.
      No render queue can fall behind a fast fling.
    */

    _cols[0].appendChild(
      fragments[0]
    );

    _cols[1].appendChild(
      fragments[1]
    );


    /*
      Start gentle background preloading.
    */

    _warmCache();
  }


  /* ────────────────────────────────────────────────────────────
     FETCH
  ──────────────────────────────────────────────────────────── */

  function _fetchImages() {
    fetch(
      '/api/images?q=' +
      encodeURIComponent(_q)
    )
      .then(function (response) {
        if (!response.ok) {
          throw new Error(
            'Image request failed'
          );
        }

        return response.json();
      })
      .then(function (data) {
        const results =
          Array.isArray(
            data.results
          )
            ? data.results
            : [];


        if (!results.length) {
          const page =
            document.getElementById(
              'pageContent'
            );

          if (page) {
            page.innerHTML =
              '<div class="tab-empty"><p>No images found</p></div>';
          }

          return;
        }


        _appendResults(
          results
        );
      })
      .catch(function () {
        const page =
          document.getElementById(
            'pageContent'
          );

        if (page) {
          page.innerHTML =
            '<div class="tab-empty"><p>Could not load images</p></div>';
        }
      });
  }


  /* ────────────────────────────────────────────────────────────
     INIT
  ──────────────────────────────────────────────────────────── */

  window._atkynInit_images =
    function () {

      if (_renderFrame) {
        cancelAnimationFrame(
          _renderFrame
        );

        _renderFrame = 0;
      }


      if (_lazyIo) {
        _lazyIo.disconnect();

        _lazyIo = null;
      }


      /*
        IMPORTANT:
        _imageCache is NOT cleared.
        Previously loaded images remain reusable.
      */

      _seen = new Set();

      _cols = [null, null];

      _colH = [0, 0];

      _grid = null;

      _preloadList = [];

      _preloadIndex = 0;

      _preloadRunning = false;


      _q =
        sessionStorage.getItem(
          'atkyn_last_query'
        ) || '';


      const page =
        document.getElementById(
          'pageContent'
        );

      if (!page) {
        return;
      }


      if (!_q) {
        page.innerHTML =
          '<div class="tab-empty"><p>Search something to see images</p></div>';

        return;
      }


      /* ── Static professional placeholder ── */

      page.innerHTML = `
        <div class="tab-skeleton grid">

          <div class="sk-col">
            <div
              class="sk-img"
              style="padding-bottom:133%"
            ></div>

            <div
              class="sk-img"
              style="padding-bottom:75%"
            ></div>

            <div
              class="sk-img"
              style="padding-bottom:110%"
            ></div>
          </div>

          <div class="sk-col">
            <div
              class="sk-img"
              style="padding-bottom:80%"
            ></div>

            <div
              class="sk-img"
              style="padding-bottom:130%"
            ></div>

            <div
              class="sk-img"
              style="padding-bottom:90%"
            ></div>
          </div>

        </div>
      `;


      /* Observer */

      _initLazyObserver();


      /* Masonry */

      _grid =
        document.createElement(
          'div'
        );

      _grid.className =
        'images-grid';


      for (
        let i = 0;
        i < 2;
        i++
      ) {
        const column =
          document.createElement(
            'div'
          );

        column.className =
          'img-col';

        _grid.appendChild(
          column
        );

        _cols[i] =
          column;
      }


      /*
        One DOM replacement.
        The complete masonry shell now exists before
        image loading starts.
      */

      page.replaceChildren(
        _grid
      );


      _fetchImages();
    };


  /* ────────────────────────────────────────────────────────────
     FIRST INIT
  ──────────────────────────────────────────────────────────── */

  window._atkynInit_images();

}());
