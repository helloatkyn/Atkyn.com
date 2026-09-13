/**
 * workers/og-proxy.js — Cloudflare Worker
 *
 * Fetches a news article URL and returns its og:image.
 *
 * Deploy:
 *   wrangler deploy og-proxy.js --name og-proxy
 *
 * Then add a route in your wrangler.toml or Cloudflare dashboard:
 *   /api/og-proxy  →  this worker
 *
 * Request:  GET /api/og-proxy?url=https%3A%2F%2F...
 * Response: { "og": "https://image-url..." }  or  { "og": null }
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES   = 80_000;   /* read only first ~80 KB — og tags are in <head> */

export default {
  async fetch(request) {
    /* Preflight */
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl || !targetUrl.startsWith('http')) {
      return json({ og: null }, 400);
    }

    try {
      /* Timeout via AbortController + Promise.race */
      const ctrl    = new AbortController();
      const timeout = new Promise((_, reject) =>
        setTimeout(() => { ctrl.abort(); reject(new Error('timeout')); }, FETCH_TIMEOUT_MS)
      );

      const fetchPromise = fetch(targetUrl, {
        signal:  ctrl.signal,
        headers: {
          /* Appear as a browser so sites don't block us */
          'User-Agent':      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept':          'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        cf: {
          /* Cache successful results for 1 hour at the edge */
          cacheTtl: 3600,
          cacheEverything: true,
        },
      });

      const response = await Promise.race([fetchPromise, timeout]);

      if (!response.ok) return json({ og: null });

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) return json({ og: null });

      /* Read only the first MAX_HTML_BYTES bytes */
      const reader  = response.body.getReader();
      const chunks  = [];
      let   total   = 0;
      let   done    = false;

      while (!done && total < MAX_HTML_BYTES) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
        }
      }

      /* Cancel the rest of the stream */
      try { await reader.cancel(); } catch (_) {}

      /* Decode */
      const html = new TextDecoder().decode(_concat(chunks));

      /* Extract og:image with a fast regex — no DOM parser needed */
      const ogImg = _extractOg(html);

      return json({ og: ogImg });

    } catch (_) {
      return json({ og: null });
    }
  },
};

/* ── Helpers ──────────────────────────────────────────────── */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function _concat(chunks) {
  const total  = chunks.reduce((n, c) => n + c.byteLength, 0);
  const result = new Uint8Array(total);
  let   offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function _extractOg(html) {
  /*
   * Match any of:
   *   <meta property="og:image" content="..." />
   *   <meta name="og:image" content="..." />
   *   <meta content="..." property="og:image" />
   *
   * Also falls back to twitter:image.
   */
  const patterns = [
    /property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
    /name=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*name=["']og:image["']/i,
    /property=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*property=["']twitter:image["']/i,
    /name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1] && m[1].startsWith('http')) return m[1];
  }

  return null;
}
