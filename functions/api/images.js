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

  // Har offset pe alag region + alag hl taaki fresh results milein
  const slots = [
    { gl: 'us', hl: 'en' },
    { gl: 'gb', hl: 'en' },
    { gl: 'in', hl: 'en' },
    { gl: 'ca', hl: 'en' },
    { gl: 'au', hl: 'en' },
    { gl: 'de', hl: 'de' },
    { gl: 'fr', hl: 'fr' },
    { gl: 'jp', hl: 'ja' },
    { gl: 'br', hl: 'pt' },
    { gl: 'mx', hl: 'es' },
  ];

  const slot = slots[offset % slots.length];

  try {
    const r = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY':    env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q, num: 100, gl: slot.gl, hl: slot.hl }),
    });

    const data = r.ok ? await r.json() : { images: [] };

    const results = (data.images || []).map(r => ({
      title:         r.title        || '',
      url:           r.link         || '',
      img_src:       r.imageUrl     || '',
      thumbnail_src: r.thumbnailUrl || r.imageUrl || '',
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
