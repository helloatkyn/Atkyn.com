/* ═══════════════════════════════════════════════════════════════
   modules/web/web.js — Atkyn Web tab
   SearXNG proxy via /api/search — zero AI calls.
   Requires: core.js globals (_atkynPageContent, _atkynAnimateIn)
   ═══════════════════════════════════════════════════════════════ */

(function () {

/* ── Helpers ── */
const _esc = s => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const _safeUrl = u => {
  try {
    const p = new URL(u);
    return (p.protocol === 'https:' || p.protocol === 'http:')
      ? u
      : '#';
  } catch (_) {
    return '#';
  }
};


/* ═══════════════════════════════════════════════════════════════
   FETCH OG IMAGE FROM WORKER
═══════════════════════════════════════════════════════════════ */

function _fetchOg(url) {
  return fetch(`/api/og?url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(6000),
  })
    .then(r => r.ok ? r.json() : null)
    .then(d => d?.image || null)
    .catch(() => null);
}


/* ═══════════════════════════════════════════════════════════════
   IMAGE INJECTION
   Square       → right-side thumbnail
   Rectangle    → centered full-width image
   Portrait     → centered full-width image
   No crop · No distortion
═══════════════════════════════════════════════════════════════ */

function _injectOgImage(cardEl, image) {
  if (!image) return;

  const img = document.createElement('img');

  img.src = image;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';

  img.addEventListener(
    'error',
    () => {
      const host = img.closest('.wc-image-host');
      if (host) host.remove();
    },
    { once: true }
  );


  /* ────────────────────────────────────────────────────────────
     Decide layout only after the real image dimensions exist.
  ──────────────────────────────────────────────────────────── */
  const render = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;

    const ratio =
      img.naturalWidth / img.naturalHeight;


    /* ═══════════════════════════════════════════════════════════
       SQUARE / NEAR-SQUARE
       Example: Investing.com square image

       Text LEFT
       Image RIGHT
    ═══════════════════════════════════════════════════════════ */

    if (ratio >= 0.78 && ratio <= 1.30) {

      const snippet =
        cardEl.querySelector('.wc-snippet');

      if (!snippet) return;

      const row =
        document.createElement('div');

      row.className =
        'wc-inline-row wc-image-host';

      const thumbWrap =
        document.createElement('div');

      thumbWrap.className =
        'wc-thumb-inline-wrap';


      img.className =
        'wc-thumb-inline';


      /* ── Row ── */

      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.width = '100%';
      row.style.gap = '14px';


      /* ── Text ── */

      snippet.style.flex = '1 1 auto';
      snippet.style.minWidth = '0';


      /* ── Image viewport ── */

      thumbWrap.style.flex = '0 0 150px';
      thumbWrap.style.width = '150px';
      thumbWrap.style.height = '110px';

      thumbWrap.style.display = 'flex';
      thumbWrap.style.alignItems = 'center';
      thumbWrap.style.justifyContent = 'center';

      thumbWrap.style.overflow = 'hidden';


      /* ── Image ── */

      img.style.display = 'block';

      img.style.width = 'auto';
      img.style.height = 'auto';

      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';

      img.style.objectFit = 'contain';
      img.style.objectPosition = 'center center';


      /* ── DOM ── */

      snippet.parentNode.insertBefore(
        row,
        snippet
      );

      row.appendChild(snippet);
      row.appendChild(thumbWrap);

      thumbWrap.appendChild(img);

      return;
    }


    /* ═══════════════════════════════════════════════════════════
       LANDSCAPE / RECTANGULAR / PORTRAIT
       Example: rectangular StockAnalysis image

       Title
       ↓
       CENTERED IMAGE
       ↓
       Snippet
    ═══════════════════════════════════════════════════════════ */

    const title =
      cardEl.querySelector('.wc-title');

    const wrap =
      document.createElement('div');

    wrap.className =
      'wc-thumb-full-wrap wc-image-host';


    /* ── Wrapper ── */

    wrap.style.width = '100%';

    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';

    wrap.style.overflow = 'hidden';


    /* ── Image ── */

    img.className =
      'wc-thumb-full';

    img.style.display = 'block';

    img.style.width = '100%';
    img.style.height = 'auto';

    img.style.maxWidth = '100%';
    img.style.maxHeight = '300px';

    img.style.objectFit = 'contain';
    img.style.objectPosition = 'center center';


    wrap.appendChild(img);


    /* ── Insert directly after title ── */

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
  };


  /* ── Wait for actual image dimensions ── */

  if (img.complete && img.naturalWidth) {
    render();
  } else {
    img.addEventListener(
      'load',
      render,
      { once: true }
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

    const u = new URL(r.url);

    host =
      u.hostname.replace(/^www\./, '');

    path =
      (host + u.pathname)
        .replace(/\/$/, '')
        .substring(0, 60);

  } catch (_) {

    host = r.url;
    path = r.url;
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

  a.className = 'wc-card';

  a.href = _safeUrl(r.url);

  a.target = '_blank';

  a.rel = 'noopener noreferrer';


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
        ? `<div class="wc-snippet">${_esc(snippet)}</div>`
        : ''
    }
  `;


  /* ── Favicon fallback ── */

  a.querySelector('.wc-fav')
    .addEventListener(
      'error',
      function () {

        if (this.src !== fav2) {

          this.src = fav2;

        } else {

          const wrap =
            this.closest('.wc-fav-wrap');

          if (wrap) {
            wrap.style.display = 'none';
          }
        }

      },
      {
        once: true,
        passive: true,
      }
    );


  /* ═══════════════════════════════════════════════════════════
     IMAGE
     Layout is determined by actual image aspect ratio.
  ═══════════════════════════════════════════════════════════ */

  if (r.image) {

    _injectOgImage(
      a,
      r.image
    );

  } else {

    _fetchOg(r.url)
      .then(img => {

        _injectOgImage(
          a,
          img
        );

      });
  }


  return a;
}


/* ═══════════════════════════════════════════════════════════════
   KNOWLEDGE PANEL / INFOBOX
═══════════════════════════════════════════════════════════════ */

function _buildInfobox(box) {

  if (!box?.title) return null;


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
        <circle cx="11" cy="11" r="8"/>
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
      { passive: true }
    );


    list.appendChild(btn);
  });


  el.appendChild(list);

  return el;
}


/* ═══════════════════════════════════════════════════════════════
   DDG AUTOCOMPLETE SUGGESTIONS
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
   TRIGGER NEW SEARCH
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
    pill.classList.add('has-text');
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
   * is already shown.
   */

  const results =
    data.infobox
      ? data.results.filter(
          r =>
            !r.url.includes(
              'wikipedia.org'
            )
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
        pc.appendChild(related);
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
        : (data.results || []);


    if (!results.length) {

      pc.innerHTML =
        '<div class="tab-empty">' +
          '<p>No results found</p>' +
        '</div>';

      return;
    }


    const payload =
      Array.isArray(data)
        ? {
            results,
            infobox: null,
          }
        : {
            results,
            infobox:
              data.infobox || null,
          };


    try {

      sessionStorage.setItem(
        'atkyn_web_results',
        JSON.stringify({
          q,
          ...payload,
        })
      );

    } catch (_) {}


    _render(
      q,
      payload
    );


  } catch (_) {

    pc.innerHTML =
      '<div class="tab-empty">' +
        '<p>Could not load results. Try again.</p>' +
      '</div>';
  }
}


/* ═══════════════════════════════════════════════════════════════
   SYNC CHATBAR
═══════════════════════════════════════════════════════════════ */

function _syncChatbar(q) {

  const cb =
    document.getElementById('cbInput');

  const pill =
    document.getElementById('pill');


  if (cb) {
    cb.value = q;
  }


  if (pill) {

    pill.classList.toggle(
      'has-text',
      q.length > 0
    );
  }
}


/* ═══════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════ */

function _init() {

  const q =
    sessionStorage.getItem(
      'atkyn_last_query'
    ) || '';


  const pc =
    window._atkynPageContent;


  _syncChatbar(q);


  const cached =
    sessionStorage.getItem(
      'atkyn_web_results'
    );


  if (cached) {

    try {

      const saved =
        JSON.parse(cached);


      if (
        saved.q === q &&
        saved.results?.length
      ) {

        _render(
          q,
          saved
        );

        return;
      }

    } catch (_) {}
  }


  if (q) {

    _fetch(q);

    return;
  }


  pc.innerHTML =
    '<div class="tab-empty">' +
      '<p>Search something to see web results</p>' +
    '</div>';
}


window._atkynInit_web = _init;

_init();

}());
