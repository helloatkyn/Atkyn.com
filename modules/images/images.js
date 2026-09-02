/* ══════════════════════════════════════════════════════════════
   modules/images/images.js
   ATKYN — Production Google-Style Images
   ONE API CALL • MAX RESULTS • HIGH-RES • FAST PAINT
   Stable masonry • Fast scrolling • No Wikipedia
══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';


  /* ═══════════════════════════════════════════════════════════
     MEMORY CACHE
     Kept across image-tab reinitializations.
  ═══════════════════════════════════════════════════════════ */

  const _imageCache = new Map();


  /* ═══════════════════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════════════════ */

  let _seen = new Set();

  let _gallery = null;

  let _observer = null;

  let _query = '';

  let _warmQueue = [];

  let _warmRunning = false;


  /* ═══════════════════════════════════════════════════════════
     TITLE CLEANER
     Removes trailing dots / ellipsis from actual source titles.
  ═══════════════════════════════════════════════════════════ */

  function _cleanTitle(value) {
    if (!value) return '';

    return value
      .replace(/\u2026+/g, '')
      .replace(/\.{2,}$/g, '')
      .replace(/\s*[-–—:|]\s*$/g, '')
      .trim();
  }


  /* ═══════════════════════════════════════════════════════════
     SHORT TITLE
  ═══════════════════════════════════════════════════════════ */

  function _shortTitle(raw) {
    const clean = _cleanTitle(raw);

    if (!clean) return '';

    return clean
      .split(/\s+/)
      .slice(0, 3)
      .join(' ');
  }


  /* ═══════════════════════════════════════════════════════════
     SOURCE NORMALIZER
     Supports:
       Serper: imageUrl / imageWidth / imageHeight / link
       Atkyn: img_src / width / height / url
  ═══════════════════════════════════════════════════════════ */

  function _normalize(item) {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const src =
      item.img_src ||
      item.imageUrl ||
      item.image_url ||
      item.thumbnail_src ||
      item.thumbnailUrl ||
      '';

    if (!src) {
      return null;
    }

    const thumb =
      item.thumbnail_src ||
      item.thumbnailUrl ||
      '';

    return {
      title:
        item.title ||
        '',

      url:
        item.url ||
        item.link ||
        src,

      img_src:
        src,

      thumbnail_src:
        thumb,

      width:
        Number(
          item.width ||
          item.imageWidth ||
          item.thumbnailWidth ||
          0
        ),

      height:
        Number(
          item.height ||
          item.imageHeight ||
          item.thumbnailHeight ||
          0
        )
    };
  }


  /* ═══════════════════════════════════════════════════════════
     PRELOAD
     Browser cache + decoded image object.
  ═══════════════════════════════════════════════════════════ */

  function _preload(src) {
    if (!src) {
      return Promise.resolve(null);
    }

    const existing =
      _imageCache.get(src);

    if (existing) {
      return existing;
    }


    const promise =
      new Promise(function (resolve, reject) {

        const image =
          new Image();

        image.decoding =
          'async';


        image.onload =
          function () {

            const finish =
              function () {

                _imageCache.set(
                  src,
                  Promise.resolve(image)
                );

                resolve(image);
              };


            if (
              typeof image.decode ===
              'function'
            ) {

              image.decode()
                .catch(function () {})
                .finally(
                  finish
                );

            } else {
              finish();
            }
          };


        image.onerror =
          function () {

            _imageCache.delete(
              src
            );

            reject(
              new Error(
                'Image failed'
              )
            );
          };


        image.src =
          src;
      });


    _imageCache.set(
      src,
      promise
    );

    return promise;
  }


  /* ═══════════════════════════════════════════════════════════
     LOAD TILE
  ═══════════════════════════════════════════════════════════ */

  function _loadTile(image) {
    if (!image) return;

    if (
      image.dataset.loading === '1' ||
      image.dataset.loaded === '1'
    ) {
      return;
    }

    const src =
      image.dataset.src;

    if (!src) return;

    image.dataset.loading =
      '1';


    const cached =
      _imageCache.get(src);


    if (cached) {

      cached
        .then(function () {

          if (!image.isConnected) {
            return;
          }

          image.src =
            src;

          image.dataset.loaded =
            '1';

          requestAnimationFrame(
            function () {
              if (
                image.isConnected
              ) {
                image.classList.add(
                  'img-loaded'
                );
              }
            }
          );
        })
        .catch(function () {
          image.dataset.failed =
            '1';
        });

      return;
    }


    image.src =
      src;
  }


  /* ═══════════════════════════════════════════════════════════
     TILE BUILDER
  ═══════════════════════════════════════════════════════════ */

  function _buildTile(data) {

    const src =
      data.img_src;

    if (!src) {
      return null;
    }


    const aspect =
      data.width &&
      data.height
        ? (
            data.height /
            data.width *
            100
          ).toFixed(2) + '%'
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


    /* Stable geometry */

    const spacer =
      document.createElement('div');

    spacer.className =
      'img-tile__spacer';

    spacer.style.paddingBottom =
      aspect;


    /* Image */

    const image =
      document.createElement('img');

    image.className =
      'img-lazy';

    image.alt =
      _cleanTitle(data.title);

    image.decoding =
      'async';

    image.dataset.src =
      src;


    image.onload =
      function () {

        this.dataset.loaded =
          '1';

        requestAnimationFrame(
          function () {

            if (
              image.isConnected
            ) {
              image.classList.add(
                'img-loaded'
              );
            }
          }
        );
      };


    image.onerror =
      function () {

        /*
          Keep the reserved tile.
          Never collapse masonry geometry.
        */

        this.dataset.failed =
          '1';

        this.dataset.loading =
          '0';
      };


    spacer.appendChild(
      image
    );

    tile.appendChild(
      spacer
    );


    /* Overlay */

    const overlay =
      document.createElement(
        'div'
      );

    overlay.className =
      'img-tile__overlay';


    const title =
      _shortTitle(
        data.title
      );


    if (title) {

      const titleEl =
        document.createElement(
          'span'
        );

      titleEl.className =
        'img-tile__title';

      titleEl.textContent =
        title;

      overlay.appendChild(
        titleEl
      );
    }


    /* Menu */

    const menu =
      document.createElement(
        'button'
      );

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


    return tile;
  }


  /* ═══════════════════════════════════════════════════════════
     INTERSECTION OBSERVER
     Very large preload window.
  ═══════════════════════════════════════════════════════════ */

  function _initObserver() {

    if (_observer) {
      _observer.disconnect();
    }


    _observer =
      new IntersectionObserver(
        function (
          entries,
          observer
        ) {

          for (
            const entry of entries
          ) {

            if (
              !entry.isIntersecting
            ) {
              continue;
            }


            const image =
              entry.target;


            observer.unobserve(
              image
            );


            _loadTile(
              image
            );
          }
        },
        {
          rootMargin:
            '3000px 0px'
        }
      );
  }


  /* ═══════════════════════════════════════════════════════════
     OBSERVE
  ═══════════════════════════════════════════════════════════ */

  function _observeTile(tile) {

    const image =
      tile.querySelector(
        '.img-lazy'
      );

    if (
      !image ||
      !_observer
    ) {
      return;
    }


    _observer.observe(
      image
    );
  }


  /* ═══════════════════════════════════════════════════════════
     RENDER GRID
     Max 2 columns.
  ═══════════════════════════════════════════════════════════ */

  function _renderResults(results) {

    const fragment =
      document.createDocumentFragment();


    const colA =
      document.createElement(
        'div'
      );

    const colB =
      document.createElement(
        'div'
      );


    colA.className =
      'gallery-col';

    colB.className =
      'gallery-col';


    const heights =
      [0, 0];


    for (
      const data of results
    ) {

      const tile =
        _buildTile(data);

      if (!tile) {
        continue;
      }


      const ratio =
        data.width &&
        data.height
          ? data.height /
            data.width
          : 1.33;


      const column =
        heights[0] <= heights[1]
          ? 0
          : 1;


      if (column === 0) {
        colA.appendChild(tile);
      } else {
        colB.appendChild(tile);
      }


      heights[column] +=
        ratio;


      _observeTile(
        tile
      );
    }


    fragment.appendChild(
      colA
    );

    fragment.appendChild(
      colB
    );


    const grid =
      document.createElement(
        'div'
      );

    grid.className =
      'gallery-grid';

    grid.appendChild(
      fragment
    );


    _gallery.replaceChildren(
      grid
    );
  }


  /* ═══════════════════════════════════════════════════════════
     CACHE WARMING
  ═══════════════════════════════════════════════════════════ */

  function _warmCache() {

    if (
      _warmRunning ||
      !_warmQueue.length
    ) {
      return;
    }


    _warmRunning =
      true;


    const next =
      function () {

        if (
          !_warmQueue.length
        ) {

          _warmRunning =
            false;

          return;
        }


        const src =
          _warmQueue.shift();


        if (
          src &&
          !_imageCache.has(src)
        ) {

          _preload(
            src
          ).catch(
            function () {}
          );
        }


        if (
          typeof requestIdleCallback ===
          'function'
        ) {

          requestIdleCallback(
            next,
            {
              timeout: 100
            }
          );

        } else {

          requestAnimationFrame(
            next
          );
        }
      };


    next();
  }


  /* ═══════════════════════════════════════════════════════════
     NORMALIZE API RESPONSE
  ═══════════════════════════════════════════════════════════ */

  function _extractResults(data) {

    const raw =
      Array.isArray(data?.images)
        ? data.images
        : Array.isArray(data?.results)
          ? data.results
          : [];


    const output = [];


    for (
      const item of raw
    ) {

      const normalized =
        _normalize(item);

      if (!normalized) {
        continue;
      }


      const key =
        normalized.img_src;


      if (
        _seen.has(key)
      ) {
        continue;
      }


      _seen.add(key);

      output.push(
        normalized
      );
    }


    return output;
  }


  /* ═══════════════════════════════════════════════════════════
     ONE AND ONLY ONE NETWORK CALL
  ═══════════════════════════════════════════════════════════ */

  function _fetchImages() {

    const endpoint =
      '/api/images?q=' +
      encodeURIComponent(
        _query
      ) +
      '&num=100';


    fetch(
      endpoint,
      {
        method: 'GET',
        cache: 'default',
        credentials: 'same-origin'
      }
    )
      .then(
        function (response) {

          if (!response.ok) {
            throw new Error(
              'Images request failed'
            );
          }

          return response.json();
        }
      )
      .then(
        function (data) {

          const results =
            _extractResults(
              data
            );


          if (
            !results.length
          ) {

            const empty =
              document.createElement(
                'div'
              );

            empty.className =
              'tab-empty';

            empty.innerHTML =
              '<p>No images found</p>';

            _gallery.replaceChildren(
              empty
            );

            return;
          }


          /*
            FIRST 12:
            Start warming immediately so
            first-screen content arrives ASAP.
          */

          results
            .slice(0, 12)
            .forEach(
              function (item) {

                _preload(
                  item.img_src
                ).catch(
                  function () {}
                );
              }
            );


          /*
            Remaining images:
            warm gradually without
            stealing the scroll thread.
          */

          _warmQueue =
            results
              .slice(12)
              .map(
                function (item) {
                  return item.img_src;
                }
              );


          /*
            Build complete geometry immediately.
          */

          _renderResults(
            results
          );


          _warmCache();
        }
      )
      .catch(
        function () {

          if (!_gallery) {
            return;
          }

          const error =
            document.createElement(
              'div'
            );

          error.className =
            'tab-empty';

          error.innerHTML =
            '<p>Could not load images</p>';

          _gallery.replaceChildren(
            error
          );
        }
      );
  }


  /* ═══════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════ */

  window._atkynInit_images =
    function () {

      if (_observer) {
        _observer.disconnect();
        _observer = null;
      }


      _seen =
        new Set();

      _warmQueue =
        [];

      _warmRunning =
        false;


      _query =
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


      if (!_query) {

        page.innerHTML =
          '<div class="tab-empty"><p>Search something to see images</p></div>';

        return;
      }


      /* Sharp static loading skeleton */

      page.innerHTML = `
        <div class="tab-skeleton grid">

          <div class="sk-col">

            <div
              class="sk-img"
              style="padding-bottom:110%"
            ></div>

            <div
              class="sk-img"
              style="padding-bottom:78%"
            ></div>

            <div
              class="sk-img"
              style="padding-bottom:125%"
            ></div>

          </div>

          <div class="sk-col">

            <div
              class="sk-img"
              style="padding-bottom:76%"
            ></div>

            <div
              class="sk-img"
              style="padding-bottom:118%"
            ></div>

            <div
              class="sk-img"
              style="padding-bottom:88%"
            ></div>

          </div>

        </div>
      `;


      _gallery =
        document.createElement(
          'div'
        );

      _gallery.className =
        'images-grid';


      page.replaceChildren(
        _gallery
      );


      _initObserver();


      /*
        ONE API REQUEST.
      */

      _fetchImages();
    };


  window._atkynInit_images();

}());
