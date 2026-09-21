/* ════════════════════════════════════════════════════════════════
   functions/api/og.js
   Cloudflare Pages Function

   Route:
   GET /api/og?url=https://article-url.com

   Returns:
   { "og": "https://full-res-image.jpg" }
   or
   { "og": null }
════════════════════════════════════════════════════════════════ */

const CACHE_TTL = 21600;      // 6 hours
const MAX_HTML_BYTES = 98304; // 96 KB
const FETCH_TIMEOUT = 8000;   // 8 seconds

const JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control':
    'public, max-age=' + CACHE_TTL + ', s-maxage=' + CACHE_TTL,
};

/* ────────────────────────────────────────────────────────────────
   JSON RESPONSE
──────────────────────────────────────────────────────────────── */
function json(data, status, extraHeaders) {
  return new Response(
    JSON.stringify(data),
    {
      status: status || 200,
      headers: Object.assign(
        {},
        JSON_HEADERS,
        extraHeaders || {}
      ),
    }
  );
}

/* ────────────────────────────────────────────────────────────────
   HTML ENTITY DECODER
──────────────────────────────────────────────────────────────── */
function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x2f;/gi, '/');
}

/* ────────────────────────────────────────────────────────────────
   PARSE HTML TAG ATTRIBUTES

   Handles:
   property="..."
   content="..."

   and also the reverse order:

   content="..." property="..."
──────────────────────────────────────────────────────────────── */
function parseAttributes(tag) {
  const attrs = {};

  const re =
    /([a-zA-Z_:][a-zA-Z0-9:._-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

  let match;

  while ((match = re.exec(tag)) !== null) {
    const key = match[1].toLowerCase();

    const value =
      match[2] !== undefined
        ? match[2]
        : match[3] !== undefined
        ? match[3]
        : match[4] !== undefined
        ? match[4]
        : '';

    attrs[key] = decodeHtmlEntities(value.trim());
  }

  return attrs;
}

/* ────────────────────────────────────────────────────────────────
   VALID HTTP(S) IMAGE URL
──────────────────────────────────────────────────────────────── */
function resolveHttpUrl(candidate, baseUrl) {
  if (!candidate) return null;

  try {
    const resolved = new URL(candidate, baseUrl);

    if (
      resolved.protocol !== 'http:' &&
      resolved.protocol !== 'https:'
    ) {
      return null;
    }

    return resolved.href;
  } catch (_) {
    return null;
  }
}

/* ────────────────────────────────────────────────────────────────
   EXTRACT IMAGE FROM HEAD

   Priority:
   1. og:image:secure_url
   2. og:image
   3. twitter:image
   4. twitter:image:src
   5. <link rel="image_src">
──────────────────────────────────────────────────────────────── */
function extractOgImage(html, articleUrl) {
  const candidates = [];

  /* ── META TAGS ── */
  const metaRe = /<meta\b[^>]*>/gi;

  let metaMatch;

  while ((metaMatch = metaRe.exec(html)) !== null) {
    const attrs = parseAttributes(metaMatch[0]);

    const property = String(
      attrs.property || ''
    ).toLowerCase();

    const name = String(
      attrs.name || ''
    ).toLowerCase();

    const content = attrs.content || '';

    if (!content) continue;

    if (
      property === 'og:image:secure_url'
    ) {
      candidates.push({
        priority: 1,
        value: content,
      });

    } else if (
      property === 'og:image'
    ) {
      candidates.push({
        priority: 2,
        value: content,
      });

    } else if (
      name === 'twitter:image'
    ) {
      candidates.push({
        priority: 3,
        value: content,
      });

    } else if (
      name === 'twitter:image:src'
    ) {
      candidates.push({
        priority: 4,
        value: content,
      });
    }
  }

  /* ── LINK IMAGE ── */
  const linkRe = /<link\b[^>]*>/gi;

  let linkMatch;

  while ((linkMatch = linkRe.exec(html)) !== null) {
    const attrs = parseAttributes(linkMatch[0]);

    const rel = String(
      attrs.rel || ''
    ).toLowerCase();

    const href = attrs.href || '';

    if (!href) continue;

    const relParts = rel
      .split(/\s+/)
      .filter(Boolean);

    if (
      relParts.indexOf('image_src') !== -1
    ) {
      candidates.push({
        priority: 5,
        value: href,
      });
    }
  }

  /* ── SORT BY PRIORITY ── */
  candidates.sort(function (a, b) {
    return a.priority - b.priority;
  });

  /* ── RESOLVE URL ── */
  for (const candidate of candidates) {
    const resolved = resolveHttpUrl(
      candidate.value,
      articleUrl
    );

    if (resolved) {
      return resolved;
    }
  }

  return null;
}

/* ────────────────────────────────────────────────────────────────
   READ ONLY THE HEAD / FIRST 96 KB

   We stop immediately once </head> is found.
──────────────────────────────────────────────────────────────── */
async function readHead(response) {
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let html = '';
  let totalBytes = 0;

  try {
    while (totalBytes < MAX_HTML_BYTES) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      const chunk = result.value;

      totalBytes += chunk.byteLength;

      html += decoder.decode(
        chunk,
        { stream: true }
      );

      if (
        html.toLowerCase().includes('</head>')
      ) {
        break;
      }
    }

    html += decoder.decode();

  } finally {
    try {
      await reader.cancel();
    } catch (_) {}
  }

  return html;
}

/* ────────────────────────────────────────────────────────────────
   FETCH ARTICLE HTML
──────────────────────────────────────────────────────────────── */
async function fetchArticle(articleUrl) {
  const controller = new AbortController();

  const timeout = setTimeout(function () {
    controller.abort();
  }, FETCH_TIMEOUT);

  try {
    const response = await fetch(
      articleUrl.href,
      {
        method: 'GET',

        redirect: 'follow',

        signal: controller.signal,

        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/140.0.0.0 Safari/537.36',

          'Accept':
            'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',

          'Accept-Language':
            'en-US,en;q=0.9',

          'Cache-Control':
            'no-cache',
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const contentType =
      response.headers.get('content-type') || '';

    /*
      Some servers omit content-type.
      In that case we still try parsing.
    */
    if (
      contentType &&
      !contentType.toLowerCase().includes('text/html') &&
      !contentType.toLowerCase().includes('application/xhtml+xml')
    ) {
      return null;
    }

    const html = await readHead(response);

    if (!html) {
      return null;
    }

    return extractOgImage(
      html,
      articleUrl.href
    );

  } catch (_) {
    return null;

  } finally {
    clearTimeout(timeout);
  }
}

/* ────────────────────────────────────────────────────────────────
   GET
──────────────────────────────────────────────────────────────── */
export async function onRequestGet(context) {
  const requestUrl = new URL(
    context.request.url
  );

  const rawUrl =
    requestUrl.searchParams.get('url');

  if (!rawUrl) {
    return json(
      { og: null },
      400
    );
  }

  let articleUrl;

  try {
    articleUrl = new URL(rawUrl);

    if (
      articleUrl.protocol !== 'http:' &&
      articleUrl.protocol !== 'https:'
    ) {
      return json(
        { og: null },
        400
      );
    }

  } catch (_) {
    return json(
      { og: null },
      400
    );
  }

  /* ──────────────────────────────────────────────────────────
     CLOUDFLARE CACHE

     Pages Functions support the Cache API.
     Cache key is the normalized article URL.
  ────────────────────────────────────────────────────────── */
  const cacheKeyUrl =
    new URL(
      '/api/og',
      requestUrl.origin
    );

  cacheKeyUrl.searchParams.set(
    'url',
    articleUrl.href
  );

  const cacheKey = new Request(
    cacheKeyUrl.href,
    {
      method: 'GET',
    }
  );

  try {
    const cached =
      await caches.default.match(cacheKey);

    if (cached) {
      return cached;
    }
  } catch (_) {
    /* Cache failure should never break OG fetching. */
  }

  /* ──────────────────────────────────────────────────────────
     FETCH + PARSE
  ────────────────────────────────────────────────────────── */
  const ogImage =
    await fetchArticle(articleUrl);

  const response = json(
    {
      og: ogImage || null,
    },
    200
  );

  /* ──────────────────────────────────────────────────────────
     SAVE RESPONSE TO CLOUDFLARE CACHE
  ────────────────────────────────────────────────────────── */
  try {
    if (context && typeof context.waitUntil === 'function') {
      context.waitUntil(
        caches.default.put(
          cacheKey,
          response.clone()
        )
      );
    } else {
      await caches.default.put(
        cacheKey,
        response.clone()
      );
    }
  } catch (_) {
    /* Cache failure should never break the response. */
  }

  return response;
}

/* ────────────────────────────────────────────────────────────────
   OPTIONS
──────────────────────────────────────────────────────────────── */
export async function onRequestOptions() {
  return new Response(
    null,
    {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    }
  );
}
