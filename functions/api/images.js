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

  try {
    /* 2 parallel calls — 5 regions spread across both */
    const [r1, r2] = await Promise.all([
      fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, num: 100, gl: 'us' }),
      }),
      fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, num: 100, gl: 'gb' }),
      }),
    ]);

    const [d1, d2] = await Promise.all([
      r1.ok ? r1.json() : { images: [] },
      r2.ok ? r2.json() : { images: [] },
    ]);

    const seen   = new Set();
    const merged = [...(d1.images || []), ...(d2.images || [])].filter(r => {
      if (!r.imageUrl || seen.has(r.imageUrl)) return false;
      seen.add(r.imageUrl);
      return true;
    });

    const results = merged.slice(0, 200).map(r => ({
      title:         r.title        || '',
      url:           r.link         || '',
      img_src:       r.imageUrl     || '',
      thumbnail_src: r.thumbnailUrl || '',
      width:         r.imageWidth   || 0,
      height:        r.imageHeight  || 0,
    }));

    return new Response(JSON.stringify({ results }), {
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
