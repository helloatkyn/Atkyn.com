/* ═══════════════════════════════════════════════════════════════
   functions/api/og.js — OG image fetcher
   GET /api/og?url=<encoded-url>
   [PRODUCTION READY: Modern UA · 7-Day Edge Cache · Expanded CDN Trust]
   ═══════════════════════════════════════════════════════════════ */

/* ── Expanded Trusted image CDNs ── */
const TRUSTED_CDN = [
  'cloudfront.net', 'amazonaws.com', 'googleusercontent.com', 'imgix.net',
  'cloudinary.com', 'fastly.net', 'akamaized.net', 'cdn.shopify.com',
  'shopifycdn.com', 'cdn.shopifycloud.com', 'images.unsplash.com',
  'cdn.pixabay.com', 'media.istockphoto.com', 'upload.wikimedia.org',
  'static.wikimedia.org', 'i.ytimg.com', 'lh3.googleusercontent.com',
  'fbcdn.net', 'twimg.com', 'pbs.twimg.com', 'media.licdn.com',
  'images.ctfassets.net', 'assets.website-files.com', 'images.squarespace-cdn.com',
  'cdn.prod.website-files.com', 'wp.com', 'i0.wp.com', 'i1.wp.com', 'i2.wp.com',
  'images.prismic.io', 'cdn.sanity.io', 'res.cloudinary.com',
  'storage.googleapis.com', 'blob.core.windows.net', 'imagedelivery.net',
  'img.freepik.com', 'githubusercontent.com', 'vercel.app', 'netlify.app',
  'cloudflare.com', 'cloudflareinsights.com'
];

function _isImageTrusted(imageUrl, siteUrl) {
  let imgHost, siteHost;
  try {
    imgHost  = new URL(imageUrl).hostname.replace(/^www\./, '').toLowerCase();
    siteHost = new URL(siteUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch (_) {
    return false;
  }

  if (imgHost === siteHost) return true;
  
  const siteRoot = siteHost.split('.').slice(-2).join('.');
  const imgRoot  = imgHost.split('.').slice(-2).join('.');
  if (imgRoot === siteRoot) return true;

  if (TRUSTED_CDN.some(cdn => imgHost === cdn || imgHost.endsWith('.' + cdn))) return true;

  return false;
}

function _extractOg(html) {
  // og:image (both attribute orders)
  let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (!m) m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (m?.[1]) return m[1].trim();

  // twitter:image fallback
  m = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  if (!m) m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
  if (m?.[1]) return m[1].trim();

  return null;
}

export async function onRequestGet(context) {
  const siteUrl = new URL(context.request.url).searchParams.get('url')?.trim();
  if (!siteUrl) return _json({ image: null }, 86400);

  try { new URL(siteUrl); } catch (_) { return _json({ image: null }, 86400); }

  // ── CLOUDFLARE EDGE CACHE (7 days for OG images — they rarely change) ──
  const cacheKey = new Request(`https://og.cache/${encodeURIComponent(siteUrl)}`, context.request);
  const cache = caches.default;

  try {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
  } catch (_) {}

  try {
    const resp = await fetch(siteUrl, {
      headers: {
        // CRITICAL FIX: Modern Chrome UA avoids anti-bot blocks that Googlebot faces
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal:   AbortSignal.timeout(5000),
      redirect: 'follow',
    });

    if (!resp.ok) return _json({ image: null }, 604800); // Cache negative result for 7 days

    // Read only first 50 KB — og tags are always in <head>
    const reader = resp.body.getReader();
    let html = '', bytes = 0;
    const LIMIT = 50_000;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      html  += new TextDecoder().decode(value);
      bytes += value.length;
      if (bytes >= LIMIT) { reader.cancel(); break; }
    }

    const raw = _extractOg(html);
    if (!raw) return _json({ image: null }, 604800);

    // Resolve relative URLs
    let imageUrl;
    try {
      imageUrl = new URL(raw, siteUrl).href;
    } catch (_) {
      return _json({ image: null }, 604800);
    }

    // Security check
    if (!_isImageTrusted(imageUrl, siteUrl)) return _json({ image: null }, 604800);

    // Cache successful result for 7 days
    const response = _json({ image: imageUrl }, 604800);
    context.waitUntil(cache.put(cacheKey, response.clone()));
    
    return response;

  } catch (_) {
    return _json({ image: null }, 604800);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function _json(data, maxAge = 86400) {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`,
    },
  });
}
