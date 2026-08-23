export async function onRequestGet(context) {
  const { request, env } = context;

  const url    = new URL(request.url);
  const q      = url.searchParams.get('q')?.trim();
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  if (!q) {
    return new Response(JSON.stringify({ error: 'Empty query' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const serperResp = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY':    env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q, num: 100, start: offset }),
    });

    if (!serperResp.ok) throw new Error('Serper error');

    const data    = await serperResp.json();
    const results = (data.images || []).map(r => ({
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
