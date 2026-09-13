/**
 * workers/news-worker.js — Cloudflare Worker
 *
 * GET /api/news?q=<query>       → fetches SearXNG HTML, parses news results → JSON
 * GET /api/og-proxy?url=<url>   → fetches article page → { og: "..." }
 *
 * Deploy:
 *   wrangler deploy workers/news-worker.js --name atkyn-news
 * Routes (Cloudflare Pages → Settings → Functions → Route):
 *   /api/news      → atkyn-news
 *   /api/og-proxy  → atkyn-news
 *
 * Multiple SearXNG instances as fallback — first one that returns results wins.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* Public instances that are known to NOT block HTML scraping.
   Worker rotates through these if one fails / returns no results. */
const SEARX_INSTANCES = [
  'https://searxng.website',
  'https://baresearch.org',
  'https://priv.au',
  'https://paulgo.io',
  'https://anonsearch.win',
];

const OG_TIMEOUT_MS  = 5000;
const MAX_HTML_BYTES = 80_000;

/* ── Router ───────────────────────────────────────────────── */
export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    const url  = new URL(request.url);
    const path = url.pathname;

    if (path.endsWith('/api/news'))     return handleNews(url.searchParams.get('q') || '');
    if (path.endsWith('/api/og-proxy')) return handleOG(url.searchParams.get('url') || '');

    return new Response('Not found', { status: 404 });
  },
};

/* ══════════════════════════════════════════════════════════════
   /api/news  — HTML scrape → JSON
══════════════════════════════════════════════════════════════ */
async function handleNews(q) {
  if (!q) return jsonResp({ results: [] }, 400);

  for (const base of SEARX_INSTANCES) {
    const url = base + '/search?q=' + encodeURIComponent(q)
      + '&categories=news&language=en-IN&pageno=1';

    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 '
            + '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        cf: { cacheTtl: 180, cacheEverything: true },
      });

      if (!r.ok) continue;

      const html    = await r.text();
      const results = parseNewsHTML(html);
      if (!results.length) continue;

      return jsonResp({ results });

    } catch (_) { continue; }
  }

  return jsonResp({ results: [] }, 502);
}

/* ── Parse SearXNG news HTML ── */
function parseNewsHTML(html) {
  const results = [];

  /* SearXNG wraps each result in <article class="result ..."> */
  const articleRe = /<article[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let   artMatch;

  while ((artMatch = articleRe.exec(html)) !== null && results.length < 20) {
    const block = artMatch[1];

    /* Title + URL from the main <a> inside <h3> */
    const titleRe = /<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
    const tMatch  = block.match(titleRe);
    if (!tMatch) continue;

    const url   = decodeHtmlEntities(tMatch[1].trim());
    const title = stripTags(tMatch[2]).trim();
    if (!url || !title) continue;

    /* Snippet / description */
    const snipRe  = /<p[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/p>/i;
    const snipM   = block.match(snipRe);
    const content = snipM ? stripTags(snipM[1]).trim() : '';

    /* Published date */
    const dateRe  = /<time[^>]*datetime="([^"]+)"[^>]*>/i;
    const dateM   = block.match(dateRe);
    const pubDate = dateM ? dateM[1] : '';

    /* Source / engine tag */
    const srcRe  = /class="[^"]*engine-tag[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i;
    const srcM   = block.match(srcRe);
    const source = srcM ? stripTags(srcM[1]).trim() : '';

    /* Thumbnail */
    const imgRe  = /<img[^>]*src="([^"]+)"[^>]*>/i;
    const imgM   = block.match(imgRe);
    const img    = imgM && imgM[1].startsWith('http') ? imgM[1] : '';

    results.push({ title, url, content, publishedDate: pubDate, source, img_src: img });
  }

  return results;
}

/* ══════════════════════════════════════════════════════════════
   /api/og-proxy
══════════════════════════════════════════════════════════════ */
async function handleOG(targetUrl) {
  if (!targetUrl || !targetUrl.startsWith('http')) return jsonResp({ og: null }, 400);

  try {
    const ctrl    = new AbortController();
    const timeout = new Promise((_, rej) =>
      setTimeout(() => { ctrl.abort(); rej(new Error('timeout')); }, OG_TIMEOUT_MS)
    );
    const fetchP = fetch(targetUrl, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      cf: { cacheTtl: 3600, cacheEverything: true },
    });

    const res = await Promise.race([fetchP, timeout]);
    if (!res.ok) return jsonResp({ og: null });

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return jsonResp({ og: null });

    const reader = res.body.getReader();
    const chunks = [];
    let   total  = 0;
    while (total < MAX_HTML_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); total += value.byteLength; }
    }
    try { await reader.cancel(); } catch (_) {}

    const html = new TextDecoder().decode(mergeChunks(chunks));
    return jsonResp({ og: extractOG(html) });
  } catch (_) {
    return jsonResp({ og: null });
  }
}

function extractOG(html) {
  const pats = [
    /property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
    /name=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*name=["']og:image["']/i,
    /property=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*property=["']twitter:image["']/i,
  ];
  for (const re of pats) {
    const m = html.match(re);
    if (m && m[1] && m[1].startsWith('http')) return m[1];
  }
  return null;
}

/* ── Utils ─────────────────────────────────────────────────── */
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function mergeChunks(chunks) {
  const total  = chunks.reduce((n, c) => n + c.byteLength, 0);
  const result = new Uint8Array(total);
  let   offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.byteLength; }
  return result;
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}
