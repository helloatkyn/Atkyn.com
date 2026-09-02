/* modules/images/images.js
   ATKYN IMAGES
   Premium masonry renderer
   Direct high-resolution loading
   Zero layout bounce • Smooth incremental rendering
   No Wikipedia • No thumbnail swapping • No dead code
*/

(function () {
  'use strict';

  let _seen = new Set();

  let _cols = [null, null];
  let _colH = [0, 0];

  let _grid = null;
  let _lazyIo = null;

  let _queue = [];
  let _renderFrame = 0;

  let _q = '';


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
     TILE BUILDER
  ──────────────────────────────────────────────────────────── */

  function _buildTile(data) {
    const highRes =
      data.img_src ||
      data.thumbnail_src ||
      '';

    const fallback =
      data.thumbnail_src &&
      data.thumbnail_src !== highRes
        ? data.thumbnail_src
        : '';

    if (!highRes) {
      return null;
    }


    /* Stable aspect ratio */

    const aspect =
      data.width && data.height
        ? ((data.height / data.width) * 100).toFixed(2) + '%'
        : '133.33%';


    /* Tile */

    const tile =
      document.createElement('a');

    tile.className = 'img-tile';

    tile.href =
      data.url || highRes;

    tile.target = '_blank';

    tile.rel =
      'noopener noreferrer';


    /* Image reservation */

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
      data.title || '';

    image.decoding =
      'async';

    image.loading =
      'lazy';

    image.dataset.src =
      highRes;

    if (fallback) {
      image.dataset.fallback =
        fallback;
    }


    /* Only the actual final source is assigned.
       No thumbnail → full image visual swap. */

    image.onload =
      function () {
        this.classList.add(
          'img-loaded'
        );
      };


    image.onerror =
      function () {
        const backup =
          this.dataset.fallback;

        if (
          backup &&
          this.dataset.fallbackTried !== '1'
        ) {
          this.dataset.fallbackTried =
            '1';

          this.src =
            backup;

          return;
        }

        tile.remove();
      };


    spacer.appendChild(image);

    tile.appendChild(spacer);


    /* ─────────────────────────────────────────────────────────
       OVERLAY
       Always creates the menu so tile structure stays consistent.
    ───────────────────────────────────────────────────────── */

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

      overlay.appendChild(titleEl);
    }


    /* Three-dot menu */

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
        <circle
          cx="2"
          cy="2"
          r="1.5"
          fill="currentColor"
        />
        <circle
          cx="8"
          cy="2"
          r="1.5"
          fill="currentColor"
        />
        <circle
          cx="14"
          cy="2"
          r="1.5"
          fill="currentColor"
        />
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


    overlay.appendChild(menu);

    tile.appendChild(overlay);


    return tile;
  }


  /* ────────────────────────────────────────────────────────────
     LAZY LOADER
     Loads images BEFORE they enter the viewport.
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

            observer.unobserve(image);


            const source =
              image.dataset.src;

            if (!source) {
              continue;
            }


            /*
              Important:
              The high-resolution source is loaded directly.
              There is NO low-resolution thumbnail phase.
            */

            image.src =
              source;
          }
        },
        {
          rootMargin:
            '1200px 0px'
        }
      );
  }


  /* ────────────────────────────────────────────────────────────
     OBSERVE ONE IMAGE
  ──────────────────────────────────────────────────────────── */

  function _observeTile(tile) {
    if (!_lazyIo || !tile) {
      return;
    }

    const image =
      tile.querySelector(
        '.img-lazy'
      );

    if (!image) {
      return;
    }

    _lazyIo.observe(image);
  }


  /* ────────────────────────────────────────────────────────────
     RENDER QUEUE
     requestAnimationFrame keeps DOM work aligned with frames.
  ──────────────────────────────────────────────────────────── */

  function _renderQueue() {
    _renderFrame = 0;


    if (!_queue.length) {
      return;
    }


    /*
      Small controlled batch.
      Prevents one huge synchronous DOM operation.
    */

    const batch =
      _queue.splice(0, 5);


    for (
      const data of batch
    ) {
      const tile =
        _buildTile(data);

      if (!tile) {
        continue;
      }


      const column =
        _shortCol();


      _cols[column].appendChild(
        tile
      );


      /*
        Because column widths are identical,
        aspect ratio gives a stable height estimate
        before image decoding completes.
      */

      const aspect =
        data.width &&
        data.height
          ? data.height / data.width
          : 1.33;


      _colH[column] +=
        aspect;


      _observeTile(tile);
    }


    if (_queue.length) {
      _renderFrame =
        requestAnimationFrame(
          _renderQueue
        );
    }
  }


  /* ────────────────────────────────────────────────────────────
     APPEND RESULTS
  ──────────────────────────────────────────────────────────── */

  function _appendResults(results) {
    if (
      !Array.isArray(results) ||
      !results.length
    ) {
      return;
    }


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

      _queue.push(item);
    }


    if (
      _queue.length &&
      !_renderFrame
    ) {
      _renderFrame =
        requestAnimationFrame(
          _renderQueue
        );
    }
  }


  /* ────────────────────────────────────────────────────────────
     API FETCH
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
          Array.isArray(data.results)
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


        _appendResults(results);
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
     INITIALIZATION
  ──────────────────────────────────────────────────────────── */

  window._atkynInit_images =
    function () {

      /* Cancel previous render */

      if (_renderFrame) {
        cancelAnimationFrame(
          _renderFrame
        );

        _renderFrame = 0;
      }


      /* Disconnect previous observer */

      if (_lazyIo) {
        _lazyIo.disconnect();
        _lazyIo = null;
      }


      /* Reset state */

      _seen = new Set();

      _cols = [null, null];

      _colH = [0, 0];

      _grid = null;

      _queue = [];

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


      /* No query */

      if (!_q) {
        page.innerHTML =
          '<div class="tab-empty"><p>Search something to see images</p></div>';

        return;
      }


      /* ───────────────────────────────────────────────────────
         STATIC SHARP PLACEHOLDER
      ─────────────────────────────────────────────────────── */

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


      /* Lazy observer */

      _initLazyObserver();


      /* Masonry */

      _grid =
        document.createElement(
          'div'
        );

      _grid.className =
        'images-grid';


      for (
        let index = 0;
        index < 2;
        index++
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

        _cols[index] =
          column;
      }


      /*
        Replace placeholder with the
        already-created grid in ONE DOM operation.
      */

      page.replaceChildren(
        _grid
      );


      /* One source only: Atkyn image API */

      _fetchImages();
    };


  window._atkynInit_images();

}());
