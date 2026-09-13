/**
 * workers/news-worker.js — Cloudflare Worker
 *
 * Two endpoints:
 *   GET /api/news?q=<query>          → parse Google News RSS → JSON
 *   GET /api/og-proxy?url=<url>      → fetch article page → { og: "..." }
 *
 * Deploy:
 *   wrangler deploy workers/news-worker.js --name atkyn-news
 *
 * Add routes in Cloudflare Pages > Functions > Routes  OR  wrangler.toml:
 *   /api/news        → atkyn-news
 *   /api/og-proxy    → atkyn-news
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const GOOGLE_NEWS_RSS =
  'https://news.google.com/rss/search?q={Q}&hl=en-IN&gl=IN&ceid=IN:en';

const MAX_ITEMS      = 20;
const OG_TIMEOUT_MS  = 5000;
const MAX_HTML_BYTES = 80_000;

/* ── Router ─────────────────────────────────────────────────── */
export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url      = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.endsWith('/api/news')) {
      return handleNews(url.searchParams.get('q') || '');
    }

    if (pathname.endsWith('/api/og-proxy')) {
      return handleOG(url.searchParams.get('url') || '');
    }

    return new Response('Not found', { status: 404 });
  },
};

/* ══════════════════════════════════════════════════════════════
   /api/news
══════════════════════════════════════════════════════════════ */
async function handleNews(q) {
  if (!q) return jsonResp({ results: [] }, 400);

  const rssUrl = GOOGLE_NEWS_RSS.replace('{Q}', encodeURIComponent(q));

  let xml;
  try {
    const r = await fetch(rssUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!r.ok) throw new Error(`rss ${r.status}`);
    xml = await r.text();
  } catch (e) {
    return jsonResp({ error: 'rss_fetch_failed', results: [] }, 502);
  }

  const items = parseRSS(xml).slice(0, MAX_ITEMS);
  return jsonResp({ results: items });
}

/* ── RSS parser (regex — no DOM needed in Workers) ── */
function parseRSS(xml) {
  const items  = [];
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];

  for (const block of blocks) {
    const raw = block[1];

    const title       = xmlText(raw, 'title');
    const link        = resolveGoogleLink(xmlText(raw, 'link') || xmlText(raw, 'guid'));
    const pubDate     = xmlText(raw, 'pubDate');
    const description = stripHtml(xmlText(raw, 'description') || '');

    /* Google News RSS wraps publisher + source in description HTML:
       e.g. <a href="...">Title</a><br><font color="#6f6f6f">Source</font>
       We already stripped the HTML above. */

    /* source name from <source> tag */
    const sourceMatch = raw.match(/<source[^>]*>([^<]*)<\/source>/i);
    const source      = sourceMatch ? decode(sourceMatch[1]) : '';

    items.push({ title, url: link, publishedDate: pubDate, content: description, source });
  }

  return items;
}

/* Google News links are redirects: https://news.google.com/rss/articles/...
   We return them as-is; the browser will follow the redirect transparently. */
function resolveGoogleLink(raw) {
  if (!raw) return '';
  /* Sometimes it's inside <link><![CDATA[...]]></link> */
  const cdata = raw.match(/<!\[CDATA\[(.*?)\]\]>/s);
  return cdata ? cdata[1].trim() : raw.trim();
}

function xmlText(block, tag) {
  /* Handles <tag>text</tag>  and  <tag><![CDATA[text]]></tag> */
  const re    = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = block.match(re);
  if (!match) return '';
  const inner = match[1];
  const cdata = inner.match(/<!\[CDATA\[([\s\S]*?)\]\]>/s);
  return decode(cdata ? cdata[1] : inner).trim();
}

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/* ══════════════════════════════════════════════════════════════
   /api/og-proxy
══════════════════════════════════════════════════════════════ */
async function handleOG(targetUrl) {
  if (!targetUrl || !targetUrl.startsWith('http')) {
    return jsonResp({ og: null }, 400);
  }

  try {
    const ctrl    = new AbortController();
    const timeout = new Promise((_, rej) =>
      setTimeout(() => { ctrl.abort(); rej(new Error('timeout')); }, OG_TIMEOUT_MS)
    );

    const fetchP = fetch(targetUrl, {
      signal:  ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      cf: { cacheTtl: 3600, cacheEverything: true },
    });

    const response = await Promise.race([fetchP, timeout]);
    if (!response.ok) return jsonResp({ og: null });

    const ct = response.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return jsonResp({ og: null });

    /* Read only first MAX_HTML_BYTES */
    const reader = response.body.getReader();
    const chunks = [];
    let   total  = 0;

    while (total < MAX_HTML_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); total += value.byteLength; }
    }
    try { await reader.cancel(); } catch (_) {}

    const html = new TextDecoder().decode(mergeChunks(chunks));
    const og   = extractOG(html);
    return jsonResp({ og });

  } catch (_) {
    return jsonResp({ og: null });
  }
}

function extractOG(html) {
  const patterns = [
    /property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
    /name=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*name=["']og:image["']/i,
    /property=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*property=["']twitter:image["']/i,
    /name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*name=["']twitter:image(?::src)?["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1] && m[1].startsWith('http')) return m[1];
  }
  return null;
}

/* ── Shared utils ───────────────────────────────────────────── */
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
