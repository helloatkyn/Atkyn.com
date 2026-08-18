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
    const searxResp = await fetch(
      `${env.SEARXNG_URL}/search?q=${encodeURIComponent(q)}&format=json&categories=images&language=en`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (!searxResp.ok) throw new Error('SearXNG error');

    const data    = await searxResp.json();
    const results = (data.results || []).slice(0, 30).map(r => ({
      title:         r.title         || '',
      url:           r.url           || '',
      img_src:       r.img_src       || '',
      thumbnail_src: r.thumbnail_src || '',
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
