/* ═══════════════════════════════════════════════════════════════
   modules/web/web.js — Atkyn Web tab
   Production image layout
   SearXNG proxy via /api/search — zero AI calls.
   Requires: core.js globals (_atkynPageContent, _atkynAnimateIn)
   ═══════════════════════════════════════════════════════════════ */

(function () {

'use strict';


/* ═══════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════ */

const _esc = s => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');


const _safeUrl = u => {
  try {
    const p = new URL(u);

    return (
      p.protocol === 'https:' ||
      p.protocol === 'http:'
    )
      ? u
      : '#';

  } catch (_) {
    return '#';
  }
};


/* ═══════════════════════════════════════════════════════════════
   OG IMAGE FETCH
═══════════════════════════════════════════════════════════════ */

function _fetchOg(url) {
  if (!url) return Promise.resolve(null);

  return fetch(
    `/api/og?url=${encodeURIComponent(url)}`,
    {
      signal: AbortSignal.timeout(6000),
    }
  )
    .then(response => {
      if (!response.ok) return null;
      return response.json();
    })
    .then(data => {
      return data?.image || null;
    })
    .catch(() => null);
}


/* ═══════════════════════════════════════════════════════════════
   IMAGE STYLE HELPERS
   !important is intentional.
   Existing web.css must not be able to force crop/position.
═══════════════════════════════════════════════════════════════ */

function _setStyle(el, property, value) {
  el.style.setProperty(property, value, 'important');
}


function _clearImageStyles(el) {
  if (!el) return;

  [
    'display',
    'width',
    'height',
    'max-width',
    'max-height',
    'min-width',
    'min-height',
    'object-fit',
    'object-position',
    'flex',
    'flex-shrink',
    'margin',
    'position',
    'inset',
    'transform'
  ].forEach(property => {
    el.style.removeProperty(property);
  });
}


/* ═══════════════════════════════════════════════════════════════
   IMAGE LAYOUT
═══════════════════════════════════════════════════════════════ */

function _renderOgImage(cardEl, img) {

  if (!cardEl || !img) return;

  if (!img.naturalWidth || !img.naturalHeight) {
    return;
  }


  /* Prevent duplicate rendering */
  if (img.dataset.atkynRendered === '1') {
    return;
  }


  const width = img.naturalWidth;
  const height = img.naturalHeight;

  const ratio = width / height;


  /*
   * Near-square:
   *
   * 0.78 ───────────── 1.30
   *
   * This catches:
   * 1:1
   * 4:5
   * 5:4
   * 6:5
   * etc.
   */
  const isSquare =
    ratio >= 0.78 &&
    ratio <= 1.30;


  /* ═══════════════════════════════════════════════════════════
     SQUARE IMAGE
     Text LEFT + Image RIGHT
  ═══════════════════════════════════════════════════════════ */

  if (isSquare) {

    const snippet =
      cardEl.querySelector('.wc-snippet');


    /*
     * If there is no snippet, there is nowhere sensible
     * to put a right-side image. Use centered layout instead.
     */
    if (!snippet) {
      _renderFullImage(cardEl, img);
      return;
    }


    const row =
      document.createElement('div');

    row.className =
      'wc-inline-row wc-image-host';


    const thumb =
      document.createElement('div');

    thumb.className =
      'wc-thumb-inline-wrap';


    /*
     * Move snippet into the row.
     */
    snippet.parentNode.insertBefore(
      row,
      snippet
    );


    row.appendChild(snippet);
    row.appendChild(thumb);
    thumb.appendChild(img);


    /* ── Row ── */

    _setStyle(row, 'display', 'flex');
    _setStyle(row, 'align-items', 'center');
    _setStyle(row, 'justify-content', 'space-between');
    _setStyle(row, 'width', '100%');
    _setStyle(row, 'gap', '14px');
    _setStyle(row, 'min-width', '0');


    /* ── Text ── */

    _setStyle(snippet, 'flex', '1 1 auto');
    _setStyle(snippet, 'min-width', '0');
    _setStyle(snippet, 'width', 'auto');


    /* ── Thumbnail viewport ── */

    _setStyle(thumb, 'display', 'flex');
    _setStyle(thumb, 'align-items', 'center');
    _setStyle(thumb, 'justify-content', 'center');

    _setStyle(thumb, 'width', '150px');
    _setStyle(thumb, 'height', '110px');

    _setStyle(thumb, 'min-width', '150px');
    _setStyle(thumb, 'max-width', '150px');

    _setStyle(thumb, 'flex', '0 0 150px');

    /*
     * The viewport is allowed to contain the complete
     * source image. It never crops it.
     */
    _setStyle(thumb, 'overflow', 'hidden');

    _setStyle(
      thumb,
      'border-radius',
      '14px'
    );


    /* ── Image ── */

    _setStyle(img, 'display', 'block');

    _setStyle(img, 'width', 'auto');
    _setStyle(img, 'height', 'auto');

    _setStyle(img, 'max-width', '100%');
    _setStyle(img, 'max-height', '100%');

    _setStyle(img, 'min-width', '0');
    _setStyle(img, 'min-height', '0');

    _setStyle(img, 'object-fit', 'contain');
    _setStyle(img, 'object-position', 'center center');

    _setStyle(img, 'flex', '0 0 auto');

    _setStyle(img, 'margin', '0');

    _setStyle(img, 'position', 'static');
    _setStyle(img, 'transform', 'none');


    img.dataset.atkynRendered = '1';

    return;
  }


  /* ═══════════════════════════════════════════════════════════
     LANDSCAPE / PORTRAIT
     CENTERED FULL-WIDTH IMAGE
  ═══════════════════════════════════════════════════════════ */

  _renderFullImage(cardEl, img);
}


/* ═══════════════════════════════════════════════════════════════
   FULL IMAGE LAYOUT
═══════════════════════════════════════════════════════════════ */

function _renderFullImage(cardEl, img) {

  if (!cardEl || !img) return;


  const title =
    cardEl.querySelector('.wc-title');


  const wrap =
    document.createElement('div');


  wrap.className =
    'wc-thumb-full-wrap wc-image-host';


  /*
   * Insert image immediately after title.
   */
  if (title?.nextSibling) {

    title.parentNode.insertBefore(
      wrap,
      title.nextSibling
    );

  } else if (title) {

    title.parentNode.appendChild(wrap);

  } else {

    cardEl.appendChild(wrap);
  }


  wrap.appendChild(img);


  /* ── Wrapper ── */

  _setStyle(wrap, 'display', 'flex');
  _setStyle(wrap, 'align-items', 'center');
  _setStyle(wrap, 'justify-content', 'center');

  _setStyle(wrap, 'width', '100%');
  _setStyle(wrap, 'height', 'auto');

  _setStyle(wrap, 'min-width', '0');

  _setStyle(wrap, 'overflow', 'hidden');

  _setStyle(
    wrap,
    'border-radius',
    '14px'
  );


  /*
   * Important:
   * No fixed height.
   *
   * The image controls its own natural height.
   * Therefore no cropping occurs.
   */


  /* ── Image ── */

  _setStyle(img, 'display', 'block');

  _setStyle(img, 'width', '100%');
  _setStyle(img, 'height', 'auto');

  _setStyle(img, 'max-width', '100%');
  _setStyle(img, 'max-height', '300px');

  _setStyle(img, 'min-width', '0');
  _setStyle(img, 'min-height', '0');

  _setStyle(img, 'object-fit', 'contain');
  _setStyle(img, 'object-position', 'center center');

  _setStyle(img, 'flex', '0 1 auto');

  _setStyle(img, 'margin', '0');

  _setStyle(img, 'position', 'static');
  _setStyle(img, 'transform', 'none');


  img.dataset.atkynRendered = '1';
}


/* ═══════════════════════════════════════════════════════════════
   INJECT OG IMAGE
═══════════════════════════════════════════════════════════════ */

function _injectOgImage(cardEl, image) {

  if (!cardEl || !image) return;


  /*
   * Prevent same card from receiving multiple images.
   */
  if (cardEl.querySelector('.wc-image-host')) {
    return;
  }


  const img =
    document.createElement('img');


  img.className =
    'wc-og-source';


  img.src = image;

  img.loading = 'lazy';

  img.decoding = 'async';

  img.alt = '';

  img.setAttribute(
    'aria-hidden',
    'true'
  );


  /*
   * Image failure:
   * Remove only the image host.
   * Never break the result card.
   */
  img.addEventListener(
    'error',
    () => {

      const host =
        img.closest('.wc-image-host');

      if (host) {
        host.remove();
      }

    },
    {
      once: true,
    }
  );


  /*
   * IMPORTANT:
   *
   * We cannot determine square/rectangle
   * until naturalWidth/naturalHeight exists.
   */
  const onLoad = () => {

    if (
      !img.naturalWidth ||
      !img.naturalHeight
    ) {
      return;
    }

    _renderOgImage(
      cardEl,
      img
    );
  };


  if (
    img.complete &&
    img.naturalWidth
  ) {

    onLoad();

  } else {

    img.addEventListener(
      'load',
      onLoad,
      {
        once: true,
      }
    );
  }
}


/* ═══════════════════════════════════════════════════════════════
   RESULT CARD
═══════════════════════════════════════════════════════════════ */

function _buildCard(r, index) {

  let host = '';
  let path = '';


  try {

    const u =
      new URL(r.url);


    host =
      u.hostname
        .replace(/^www\./, '');


    path =
      (host + u.pathname)
        .replace(/\/$/, '')
        .substring(0, 60);

  } catch (_) {

    host = r.url || '';
    path = r.url || '';
  }


  const fav1 =
    `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`;


  const fav2 =
    `https://icons.duckduckgo.com/ip3/${host}.ico`;


  const snippet =
    r.content ||
    r.snippet ||
    r.description ||
    r.summary ||
    '';


  const a =
    document.createElement('a');


  a.className =
    'wc-card';


  a.href =
    _safeUrl(r.url);


  a.target =
    '_blank';


  a.rel =
    'noopener noreferrer';


  a.innerHTML = `
    <div class="wc-meta">

      <div class="wc-fav-wrap">

        <img
          class="wc-fav"
          src="${_esc(fav1)}"
          width="16"
          height="16"
          loading="lazy"
          decoding="async"
          alt=""
        >

      </div>

      <div class="wc-meta-text">

        <span class="wc-domain">
          ${_esc(host)}
        </span>

        <span class="wc-path">
          ${_esc(path)}
        </span>

      </div>

      <span
        class="wc-dots"
        aria-hidden="true"
      >

        <svg
          viewBox="0 0 4 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="2" cy="2" r="1.5"/>
          <circle cx="2" cy="8" r="1.5"/>
          <circle cx="2" cy="14" r="1.5"/>
        </svg>

      </span>

    </div>

    <div class="wc-title">
      ${_esc(r.title)}
    </div>

    ${
      snippet
        ? `
          <div class="wc-snippet">
            ${_esc(snippet)}
          </div>
        `
        : ''
    }
  `;


  /* ── Favicon fallback ── */

  const fav =
    a.querySelector('.wc-fav');


  if (fav) {

    fav.addEventListener(
      'error',
      function () {

        if (this.src !== fav2) {

          this.src = fav2;

        } else {

          const wrapper =
            this.closest(
              '.wc-fav-wrap'
            );

          if (wrapper) {
            wrapper.style.display =
              'none';
          }
        }

      },
      {
        once: true,
        passive: true,
      }
    );
  }


  /* ═══════════════════════════════════════════════════════════
     OG IMAGE
  ═══════════════════════════════════════════════════════════ */

  if (r.image) {

    _injectOgImage(
      a,
      r.image
    );

  } else {

    _fetchOg(r.url)
      .then(image => {

        if (!image) return;

        /*
         * Card may have disappeared while OG
         * request was in flight.
         */
        if (!a.isConnected) return;

        _injectOgImage(
          a,
          image
        );

      });
  }


  return a;
}


/* ═══════════════════════════════════════════════════════════════
   KNOWLEDGE PANEL / INFOBOX
═══════════════════════════════════════════════════════════════ */

function _buildInfobox(box) {

  if (!box?.title) {
    return null;
  }


  const sourceUrl =
    box.urls?.[0]?.url || '';


  let sourceHost = '';


  try {

    sourceHost =
      new URL(sourceUrl)
        .hostname
        .replace(/^www\./, '');

  } catch (_) {}


  const sourceFav =
    sourceHost
      ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(sourceHost)}`
      : '';


  const el =
    document.createElement('div');


  el.className =
    'wc-kg-card';


  el.innerHTML = `
    <div class="wc-kg-top">

      <div class="wc-kg-title-wrap">

        <div class="wc-kg-title">
          ${_esc(box.title)}
        </div>

      </div>

      ${
        box.image
          ? `
            <div class="wc-kg-image-box">

              <img
                class="wc-kg-image"
                src="${_esc(box.image)}"
                loading="lazy"
                decoding="async"
                alt="${_esc(box.title)}"
                onerror="this.closest('.wc-kg-image-box').remove()"
              >

            </div>
          `
          : ''
      }

    </div>

    ${
      box.content
        ? `
          <div class="wc-kg-desc">
            ${_esc(box.content)}
          </div>
        `
        : ''
    }

    ${
      sourceUrl
        ? `
          <a
            class="wc-kg-source"
            href="${_safeUrl(sourceUrl)}"
            target="_blank"
            rel="noopener noreferrer"
          >

            ${
              sourceFav
                ? `
                  <span
                    class="wc-kg-source-fav"
                    style="background-image:url('${_esc(sourceFav)}')"
                  ></span>
                `
                : ''
            }

            <span class="wc-kg-source-text">
              ${_esc(sourceHost)}
            </span>

          </a>
        `
        : ''
    }

    ${
      box.urls?.length > 1
        ? `
          <div class="wc-sitelinks">

            ${box.urls
              .slice(1)
              .map(u => `
                <a
                  class="wc-sitelink"
                  href="${_safeUrl(u.url)}"
                  target="_blank"
                  rel="noopener noreferrer"
                >

                  <span class="wc-sitelink-title">
                    ${_esc(u.title)}
                  </span>

                  <svg
                    class="wc-sitelink-arrow"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>

                </a>
              `)
              .join('')}

          </div>
        `
        : ''
    }
  `;


  return el;
}


/* ═══════════════════════════════════════════════════════════════
   PEOPLE ALSO SEARCH FOR
═══════════════════════════════════════════════════════════════ */

function _buildRelated(suggestions) {

  if (!suggestions?.length) {
    return null;
  }


  const el =
    document.createElement('div');


  el.className =
    'wc-related';


  el.innerHTML =
    '<div class="wc-related-title">People also search for</div>';


  const list =
    document.createElement('div');


  list.className =
    'wc-related-list';


  suggestions.forEach(query => {

    const btn =
      document.createElement('button');


    btn.className =
      'wc-related-item';


    btn.innerHTML = `
      <svg
        class="wc-related-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >

        <circle
          cx="11"
          cy="11"
          r="8"
        />

        <line
          x1="21"
          y1="21"
          x2="16.65"
          y2="16.65"
        />

      </svg>

      <span>
        ${_esc(query)}
      </span>

      <svg
        class="wc-related-arrow"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >

        <line
          x1="7"
          y1="17"
          x2="17"
          y2="7"
        />

        <polyline
          points="7 7 17 7 17 17"
        />

      </svg>
    `;


    btn.addEventListener(
      'click',
      () => _triggerSearch(query),
      {
        passive: true,
      }
    );


    list.appendChild(btn);
  });


  el.appendChild(list);

  return el;
}


/* ═══════════════════════════════════════════════════════════════
   DDG AUTOCOMPLETE
═══════════════════════════════════════════════════════════════ */

async function _fetchSuggestions(q) {

  try {

    const resp =
      await fetch(
        `/api/suggest?q=${encodeURIComponent(q)}`,
        {
          signal: AbortSignal.timeout(4000),
        }
      );


    return resp.ok
      ? resp.json()
      : [];

  } catch (_) {

    return [];
  }
}


/* ═══════════════════════════════════════════════════════════════
   TRIGGER SEARCH
═══════════════════════════════════════════════════════════════ */

function _triggerSearch(query) {

  const cb =
    document.getElementById('cbInput');


  const pill =
    document.getElementById('pill');


  if (cb) {
    cb.value = query;
  }


  if (pill) {
    pill.classList.add(
      'has-text'
    );
  }


  sessionStorage.setItem(
    'atkyn_last_query',
    query
  );


  sessionStorage.removeItem(
    'atkyn_web_results'
  );


  _fetch(query);
}


/* ═══════════════════════════════════════════════════════════════
   RENDER RESULTS
═══════════════════════════════════════════════════════════════ */

function _render(q, data) {

  const pc =
    window._atkynPageContent;


  const frag =
    document.createDocumentFragment();


  const infobox =
    _buildInfobox(
      data.infobox
    );


  if (infobox) {
    frag.appendChild(infobox);
  }


  /*
   * Hide Wikipedia results when infobox
   * is already visible.
   */

  const results =
    data.infobox
      ? data.results.filter(
          r =>
            !String(r.url || '')
              .includes('wikipedia.org')
        )
      : data.results;


  const list =
    document.createElement('div');


  list.className =
    'wc-list';


  results.forEach(
    (r, i) => {

      list.appendChild(
        _buildCard(
          r,
          i
        )
      );

    }
  );


  frag.appendChild(list);


  pc.innerHTML = '';

  pc.appendChild(frag);


  window._atkynAnimateIn();


  _fetchSuggestions(q)
    .then(suggestions => {

      const related =
        _buildRelated(
          suggestions
        );


      if (related) {
        pc.appendChild(
          related
        );
      }

    });
}


/* ═══════════════════════════════════════════════════════════════
   FETCH SEARCH RESULTS
═══════════════════════════════════════════════════════════════ */

async function _fetch(q) {

  const pc =
    window._atkynPageContent;


  pc.innerHTML =
    '<div class="tab-skeleton">' +
      '<div class="sk-line"></div>' +
      '<div class="sk-line sk-short"></div>' +
      '<div class="sk-line"></div>' +
      '<div class="sk-line sk-short"></div>' +
    '</div>';


  try {

    const resp =
      await fetch(
        `/api/search?q=${encodeURIComponent(q)}`,
        {
          signal: AbortSignal.timeout(10000),
        }
      );


    if (!resp.ok) {

      throw new Error(
        `HTTP ${resp.status}`
      );
    }


    const data =
      await resp.json();


    if (data.error) {

      throw new Error(
        data.error
      );
    }


    const results =
      Array.isArray(data)
        ? data
        : (
            Array.isArray(data.results)
              ? data.results
              : []
          );


    if (!results.length) {

      pc.innerHTML =
        '<div class="tab-empty">' +
          '<p>No results found</p>' +
        '</div>';

      return
