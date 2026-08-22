/* ═══════════════════════════════════════════════════════════════
   functions/api/og.js — OG image fetcher
   GET /api/og?url=<encoded-url>
   Returns: JSON { image: "https://..." } or { image: null }
   ═══════════════════════════════════════════════════════════════ */

export async function onRequestGet(context) {
  const url = new URL(context.request.url).searchParams.get('url')?.trim();
  if (!url) return _json({ image: null });

  try {
    new URL(url); // validate
  } catch (_) {
    return _json({ image: null });
  }

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(5000),
      redirect: 'follow',
    });

    if (!resp.ok) return _json({ image: null });

    // Read only first 50KB — og:image is always in <head>
    const reader = resp.body.getReader();
    let html = '';
    let bytes = 0;
    const limit = 50_000;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
      bytes += value.length;
      if (bytes >= limit) { reader.cancel(); break; }
    }

    const image = _extractOg(html);
    return _json({ image });

  } catch (_) {
    return _json({ image: null });
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

function _extractOg(html) {
  // og:image
  let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (!m) m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (m?.[1]) return m[1].trim();

  // twitter:image fallback
  m = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  if (!m) m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
  if (m?.[1]) return m[1].trim();

  return null;
}

function _json(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               'public, max-age=86400',
    },
  });
}
