/* ═══════════════════════════════════════════════════════════════
   functions/api/og.js — OG image fetcher
   GET /api/og?url=<encoded-url>
   Returns: JSON { image: "https://..." } or { image: null }
   ═══════════════════════════════════════════════════════════════ */

/* ── Trusted image CDNs / third-party hosts ── */
const TRUSTED_CDN = [
  'cloudfront.net',
  'amazonaws.com',
  'googleusercontent.com',
  'imgix.net',
  'cloudinary.com',
  'fastly.net',
  'akamaized.net',
  'cdn.shopify.com',
  'shopifycdn.com',
  'cdn.shopifycloud.com',
  'images.unsplash.com',
  'cdn.pixabay.com',
  'media.istockphoto.com',
  'upload.wikimedia.org',
  'static.wikimedia.org',
  'i.ytimg.com',
  'lh3.googleusercontent.com',
  'fbcdn.net',
  'twimg.com',
  'pbs.twimg.com',
  'media.licdn.com',
  'images.ctfassets.net',   // Contentful
  'assets.website-files.com', // Webflow
  'images.squarespace-cdn.com',
  'cdn.prod.website-files.com',
  'wp.com',                 // WordPress CDN
  'i0.wp.com',
  'i1.wp.com',
  'i2.wp.com',
  'images.prismic.io',
  'cdn.sanity.io',
  'res.cloudinary.com',
  'storage.googleapis.com',
  'blob.core.windows.net',
  'imagedelivery.net',      // Cloudflare Images
  'img.freepik.com',
  'cdn.pixabay.com',
];

/* ── Check if image URL is valid for the site ── */
function _isImageTrusted(imageUrl, siteUrl) {
  let imgHost, siteHost;
  try {
    imgHost  = new URL(imageUrl).hostname.replace(/^www\./, '').toLowerCase();
    siteHost = new URL(siteUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch (_) {
    return false;
  }

  // Same domain or subdomain of same root
  if (imgHost === siteHost) return true;
  const siteRoot = siteHost.split('.').slice(-2).join('.');
  const imgRoot  = imgHost.split('.').slice(-2).join('.');
  if (imgRoot === siteRoot) return true;

  // Known trusted CDN / image host
  if (TRUSTED_CDN.some(cdn => imgHost === cdn || imgHost.endsWith('.' + cdn))) return true;

  return false;
}

/* ── OG / Twitter image extractor ── */
function _extractOg(html) {
  // og:image — both attribute orders
  let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (!m) m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (m?.[1]) return m[1].trim();

  // twitter:image fallback
  m = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  if (!m) m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
  if (m?.[1]) return m[1].trim();

  return null;
}

/* ── JSON response helper ── */
function _json(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               'public, max-age=86400',
    },
  });
}

/* ── GET handler ── */
export async function onRequestGet(context) {
  const siteUrl = new URL(context.request.url).searchParams.get('url')?.trim();
  if (!siteUrl) return _json({ image: null });

  try { new URL(siteUrl); } catch (_) { return _json({ image: null }); }

  try {
    const resp = await fetch(siteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
        'Accept':     'text/html',
      },
      signal:   AbortSignal.timeout(5000),
      redirect: 'follow',
    });

    if (!resp.ok) return _json({ image: null });

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
    if (!raw) return _json({ image: null });

    // Resolve relative URLs (e.g. /og-image.png → https://site.com/og-image.png)
    let imageUrl;
    try {
      imageUrl = new URL(raw, siteUrl).href;
    } catch (_) {
      return _json({ image: null });
    }

    // Reject images that belong to a different unrelated domain
    if (!_isImageTrusted(imageUrl, siteUrl)) return _json({ image: null });

    return _json({ image: imageUrl });

  } catch (_) {
    return _json({ image: null });
  }
}

/* ── CORS preflight ── */
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
