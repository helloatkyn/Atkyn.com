/* ══════════════════════════════════════════════════════════════
   modules/images/images.js
   ATKYN — Production Image Gallery

   Full-width hero + max 2-column masonry
   Deterministic random gallery pattern
   Direct high-resolution loading
   Fast first paint
   Aggressive ahead-of-viewport loading
   Browser-cache friendly
   Stable layout
   No thumbnail swap
   No Wikipedia
   No sentinel
══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';


  /* ═══════════════════════════════════════════════════════════
     CACHE
  ═══════════════════════════════════════════════════════════ */

  const _preloaded = new Set();


  /* ═══════════════════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════════════════ */

  let _seen = new Set();

  let _gallery = null;

  let _lazyIo = null;

  let _q = '';

  let _columnHeights = [0, 0];

  let _warmQueue = [];

  let _warmRunning = false;


  /* ═══════════════════════════════════════════════════════════
     SEEDED RANDOM
     Same query = same professional layout.
  ═══════════════════════════════════════════════════════════ */

  function _seedFromString(value) {
    let hash = 2166136261;

    for (
      let i = 0;
      i < value.length;
      i++
    ) {
      hash ^= value.charCodeAt(i);
      hash =
        Math.imul(
          hash,
          16777619
        );
    }

    return hash >>> 0;
  }


  function _random(seed) {
    let x =
      seed + 0x6D2B79F5;

    return function () {
      x =
        Math.imul(
          x ^ (x >>> 15),
          x | 1
        );

      x ^=
        x +
        Math.imul(
          x ^ (x >>> 7),
          x | 61
        );

      return (
        ((x ^ (x >>> 14)) >>> 0)
        / 4294967296
      );
    };
  }


  /* ═══════════════════════════════════════════════════════════
     TITLE
  ═══════════════════════════════════════════════════════════ */

  function _shortTitle(raw) {
    if (!raw) return '';

    return raw
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join(' ');
  }


  /* ═══════════════════════════════════════════════════════════
     IMAGE PRELOAD
  ═══════════════════════════════════════════════════════════ */

  function _preload(src) {
    if (
      !src ||
      _preloaded.has(src)
    ) {
      return;
    }

    _preloaded.add(src);

    const image =
      new Image();

    image.decoding =
      'async';

    image.src =
      src;
  }


  /* ═══════════════════════════════════════════════════════════
     LOAD ACTUAL TILE IMAGE
  ═══════════════════════════════════════════════════════════ */

  function _loadImage(image) {
    if (!image) {
      return;
    }

    if (
      image.dataset.loaded === '1' ||
      image.dataset.loading === '1'
    ) {
      return;
    }

    const src =
      image.dataset.src;

    if (!src) {
      return;
    }

    image.dataset.loading =
      '1';

    /*
      Direct high-resolution source.
      There is no low-res thumbnail stage.
    */

    image.src =
      src;

    /*
      Cache warm marker.
      Browser itself handles actual HTTP caching.
    */

    _preloaded.add(src);
  }


  /* ═══════════════════════════════════════════════════════════
     TILE
  ═══════════════════════════════════════════════════════════ */

  function _buildTile(data) {

    const src =
      data.img_src ||
      data.thumbnail_src ||
      '';

    if (!src) {
      return null;
    }


    /* Stable ratio */

    const aspect =
      data.width &&
      data.height
        ? (
            data.height /
            data.width *
            100
          ).toFixed(2) + '%'
        : '133.33%';


    /* Tile */

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


    /* Reserved space */

    const spacer =
      document.createElement('div');

    spacer.className =
      'img-tile__spacer';

    spacer.style.paddingBottom =
      aspect;


    /* Actual image */

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

        this.dataset.loaded =
          '1';

        requestAnimationFrame(
          () => {
            if (
              this.isConnected
            ) {
              this.classList.add(
                'img-loaded'
              );
            }
          }
        );
      };


    /*
      Never remove tile on failure.
      Its reserved space remains stable.
    */

    image.onerror =
      function () {
        this.dataset.failed =
          '1';
      };


    spacer.appendChild(
      image
    );

    tile.appendChild(
      spacer
    );


    /* ─────────────────────────────────────────────────────────
       OVERLAY
    ───────────────────────────────────────────────────────── */

    const overlay =
      document.createElement('div');

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


    /*
      Store metadata for the
      layout/preload engine.
    */

    tile.dataset.imageSrc =
      src;


    tile._imageData =
      data;


    return tile;
  }


  /* ═══════════════════════════════════════════════════════════
     OBSERVER
  ═══════════════════════════════════════════════════════════ */

  function _initObserver() {

    if (_lazyIo) {
      _lazyIo.disconnect();
    }


    _lazyIo =
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


            _loadImage(
              image
            );
          }
        },
        {
          /*
            Very large ahead-of-viewport
            buffer for fast finger flings.
          */

          rootMargin:
            '3000px 0px'
        }
      );
  }


  /* ═══════════════════════════════════════════════════════════
     OBSERVE TILE
  ═══════════════════════════════════════════════════════════ */

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


    _lazyIo.observe(
      image
    );
  }


  /* ═══════════════════════════════════════════════════════════
     SHORTEST COLUMN
  ═══════════════════════════════════════════════════════════ */

  function _shortestColumn() {
    return (
      _columnHeights[0] <=
      _columnHeights[1]
        ? 0
        : 1
    );
  }


  /* ═══════════════════════════════════════════════════════════
     CREATE 2-COLUMN SECTION
  ═══════════════════════════════════════════════════════════ */

  function _buildGridSection(
    items
  ) {

    const section =
      document.createElement(
        'div'
      );

    section.className =
      'gallery-grid';


    const columns = [
      document.createElement(
        'div'
      ),
      document.createElement(
        'div'
      )
    ];


    columns.forEach(
      function (column) {
        column.className =
          'gallery-col';

        section.appendChild(
          column
        );
      }
    );


    const heights =
      [0, 0];


    for (
      const data of items
    ) {

      const tile =
        _buildTile(data);

      if (!tile) {
        continue;
      }


      const column =
        heights[0] <= heights[1]
          ? 0
          : 1;


      columns[column].appendChild(
        tile
      );


      const ratio =
        data.width &&
        data.height
          ? data.height /
            data.width
          : 1.33;


      heights[column] +=
        ratio;


      _observeTile(
        tile
      );
    }


    return section;
  }


  /* ═══════════════════════════════════════════════════════════
     CREATE FULL-WIDTH HERO
  ═══════════════════════════════════════════════════════════ */

  function _buildHero(
    data
  ) {

    const section =
      document.createElement(
        'div'
      );

    section.className =
      'gallery-hero';


    const tile =
      _buildTile(data);

    if (tile) {
      section.appendChild(
        tile
      );

      _observeTile(
        tile
      );
    }


    return section;
  }


  /* ═══════════════════════════════════════════════════════════
     RENDER GALLERY
  ═══════════════════════════════════════════════════════════ */

  function _renderGallery(
    results
  ) {

    const fragment =
      document.createDocumentFragment();


    const random =
      _random(
        _seedFromString(
          _q
        )
      );


    let index = 0;

    let sectionNumber = 0;


    while (
      index < results.length
    ) {

      const remaining =
        results.length -
        index;


      /*
        Hero-heavy editorial pattern.

        First item:
        ALWAYS hero.

        Afterwards:
        ~65% hero
        ~35% 2-column section
      */

      const forceHero =
        sectionNumber === 0;


      const useHero =
        remaining === 1 ||
        forceHero ||
        random() < 0.65;


      if (useHero) {

        const hero =
          _buildHero(
            results[index]
          );

        fragment.appendChild(
          hero
        );

        index += 1;

      } else {

        /*
          A grid section contains
          2–4 images.
          Never more than 2 columns.
        */

        const count =
          remaining >= 4 &&
          random() < 0.45
            ? 4
            : Math.min(
                2,
                remaining
              );


        const items =
          results.slice(
            index,
            index + count
          );


        const grid =
          _buildGridSection(
            items
          );

        fragment.appendChild(
          grid
        );

        index +=
          items.length;
      }


      sectionNumber++;
    }


    /*
      Single DOM insertion.
      Gallery skeleton is replaced atomically.
    */

    _gallery.replaceChildren(
      fragment
    );
  }


  /* ═══════════════════════════════════════════════════════════
     BACKGROUND PRELOAD
  ═══════════════════════════════════════════════════════════ */

  function _warmCache() {

    if (_warmRunning) {
      return;
    }

    if (
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
          !_preloaded.has(src)
        ) {

          _preload(
            src
          );
        }


        /*
          Yield frequently.
          Image decoding/network work must
          never block touch scrolling.
        */

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
     FETCH RESULTS
  ═══════════════════════════════════════════════════════════ */

  function _fetchImages() {

    fetch(
      '/api/images?q=' +
      encodeURIComponent(
        _q
      )
    )
      .then(
        function (response) {

          if (!response.ok) {
            throw new Error(
              'Image request failed'
            );
          }

          return response.json();
        }
      )
      .then(
        function (data) {

          const results =
            Array.isArray(
              data.results
            )
              ? data.results
              : [];


          if (
            !results.length
          ) {

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


          /*
            Deduplicate.
          */

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


          if (
            !fresh.length
          ) {
            return;
          }


          /*
            First images are immediate.
            This gives the fastest possible
            first viewport.
          */

          fresh
            .slice(0, 6)
            .forEach(
              function (item) {

                const src =
                  item.img_src ||
                  item.thumbnail_src ||
                  '';

                _preload(
                  src
                );
              }
            );


          /*
            Remaining images warm gradually
            in browser cache.
          */

          _warmQueue =
            fresh
              .slice(6)
              .map(
                function (item) {
                  return (
                    item.img_src ||
                    item.thumbnail_src ||
                    ''
                  );
                }
              );


          _renderGallery(
            fresh
          );


          /*
            Start cache warming after
            the first visible content is built.
          */

          _warmCache();
        }
      )
      .catch(
        function () {

          const page =
            document.getElementById(
              'pageContent'
            );

          if (page) {

            page.innerHTML =
              '<div class="tab-empty"><p>Could not load images</p></div>';
          }
        }
      );
  }


  /* ═══════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════ */

  window._atkynInit_images =
    function () {

      if (_lazyIo) {

        _lazyIo.disconnect();

        _lazyIo =
          null;
      }


      _seen =
        new Set();


      _columnHeights =
        [0, 0];


      _warmQueue =
        [];


      _warmRunning =
        false;


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


      /* ───────────────────────────────────────────────────────
         Initial sharp placeholders
      ─────────────────────────────────────────────────────── */

      page.innerHTML = `
        <div class="tab-skeleton grid">

          <div class="sk-col">

            <div
              class="sk-img"
              style="padding-bottom:72%"
            ></div>

            <div
              class="sk-img"
              style="padding-bottom:125%"
            ></div>

            <div
              class="sk-img"
              style="padding-bottom:82%"
            ></div>

          </div>

          <div class="sk-col">

            <div
              class="sk-img"
              style="padding-bottom:110%"
            ></div>

            <div
              class="sk-img"
              style="padding-bottom:76%"
            ></div>

            <div
              class="sk-img"
              style="padding-bottom:118%"
            ></div>

          </div>

        </div>
      `;


      /*
        Create final gallery container
        before fetching images.
      */

      _gallery =
        document.createElement(
          'div'
        );

      _gallery.className =
        'images-grid';


      page.replaceChildren(
        _gallery
      );


      /*
        Large preload window protects
        high-speed scrolling.
      */

      _initObserver();


      /*
        One API only.
      */

      _fetchImages();
    };


  /* ═══════════════════════════════════════════════════════════
     INITIAL RUN
  ═══════════════════════════════════════════════════════════ */

  window._atkynInit_images();

}());
