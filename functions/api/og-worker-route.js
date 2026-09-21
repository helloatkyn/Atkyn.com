/* ─────────────────────────────────────────────────────────────
   /api/og  — OG image fetcher
   Add this as a new route in your existing Cloudflare Worker.

   Usage: GET /api/og?url=https://article-url-here.com

   Returns JSON: { "og": "https://full-res-image-url.com/..." }
   or on failure: { "og": null }

   In wrangler.toml / worker routes, this sits alongside your
   existing /api/news, /api/search etc. routes.
───────────────────────────────────────────────────────────── */

/* Paste this handler block inside your main fetch() switch/if chain */

if (pathname === '/api/og') {

  /* ── CORS preflight ── */
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  const articleUrl = url.searchParams.get('url');
  if (!articleUrl) {
    return new Response(JSON.stringify({ og: null }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }


  /* ── Fetch article HTML ── */
  let ogImage = null;
  try {
    const res = await fetch(articleUrl, {
      headers: {
        /* Pretend to be a browser so sites don't block us */
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      cf: { cacheTtl: 300, cacheEverything: false }
    });

    if (res.ok) {
      /* Read only first 32 KB — og:image is always in <head> */
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let html = '';
      let done = false;

      while (!done && html.length < 32768) {
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) html += decoder.decode(chunk.value, { stream: true });
        /* Stop as soon as we have </head> */
        if (html.includes('</head>')) break;
      }
      reader.cancel();

      /* ── Parse og:image / twitter:image from raw HTML ──
         We do this with regex — no DOM available in Workers.
         Priority: og:image:secure_url > og:image > twitter:image  */

      const matchers = [
        /* og:image:secure_url */
        /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["']/i,
        /* og:image */
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
        /* twitter:image */
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
        /* twitter:image:src */
        /<meta[^>]+name=["']twitter:image:src["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image:src["']/i,
      ];

      for (const re of matchers) {
        const m = html.match(re);
        if (m && m[1] && m[1].startsWith('http')) {
          ogImage = m[1].trim();
          break;
        }
      }
    }
  } catch(e) {
    /* fetch failed — ogImage stays null, we'll return null */
  }

  const body = JSON.stringify({ og: ogImage });

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=21600'
    }
  });

}
/* ── end /api/og ── */
