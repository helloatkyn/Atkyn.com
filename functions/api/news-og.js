/* functions/api/og.js — Cloudflare Pages Function
   Route: GET /api/og?url=https://article-url.com
   Returns: { "og": "https://full-res-image.jpg" } or { "og": null }
*/

export async function onRequestGet(context) {
  const url        = new URL(context.request.url);
  const articleUrl = url.searchParams.get('url');

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (!articleUrl) {
    return new Response(JSON.stringify({ og: null }), { headers: CORS });
  }

  let ogImage = null;

  try {
    const res = await fetch(articleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (res.ok) {
      /* Read only first 32 KB — og:image is always in <head> */
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let html = '';

      while (html.length < 32768) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        if (html.includes('</head>')) break;
      }
      reader.cancel();

      /* Parse og:image / twitter:image — priority order */
      const matchers = [
        /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["']/i,
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
      ];

      for (const re of matchers) {
        const m = html.match(re);
        if (m && m[1] && m[1].startsWith('http')) {
          ogImage = m[1].trim();
          break;
        }
      }
    }
  } catch (_) {}

  return new Response(JSON.stringify({ og: ogImage }), {
    headers: {
      ...CORS,
      'Cache-Control': 'public, max-age=21600', // 6hr browser cache
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}
