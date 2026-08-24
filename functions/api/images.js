/* functions/api/images.js — Cloudflare Pages Function */

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const q   = url.searchParams.get('q')?.trim();

  if (!q) {
    return new Response(JSON.stringify({ error: 'Empty query' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 3 suffix variants — parallel fetch, ~300 unique results max
  const suffixes = ['', ' photo', ' hd wallpaper'];
  const queries  = suffixes.map(s => (s ? `${q}${s}` : q));

  const headers = {
    'X-API-KEY':    env.SERPER_API_KEY,
    'Content-Type': 'application/json',
  };

  try {
    // All 3 fire simultaneously — fastest wins, rest follow
    const fetches = queries.map(finalQ =>
      fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers,
        body: JSON.stringify({ q: finalQ, num: 100, gl: 'us' }),
      }).then(r => r.ok ? r.json() : { images: [] })
        .catch(() => ({ images: [] }))
    );

    const responses = await Promise.all(fetches);

    // Merge + dedupe by imageUrl
    const seen   = new Set();
    const merged = [];

    for (const data of responses) {
      for (const img of (data.images || [])) {
        const key = img.imageUrl;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push({
          title:         img.title        || '',
          url:           img.link         || '',
          img_src:       img.imageUrl     || '',
          thumbnail_src: img.thumbnailUrl || img.imageUrl || '',
          width:         img.imageWidth   || 0,
          height:        img.imageHeight  || 0,
        });
      }
    }

    return new Response(JSON.stringify({ results: merged }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
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
