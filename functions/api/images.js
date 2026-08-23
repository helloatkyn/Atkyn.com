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

  // Offset ke hisaab se query variation
  const suffixes = [
    '',
    ' photo',
    ' image',
    ' wallpaper',
    ' logo',
    ' hd',
    ' 4k',
    ' background',
    ' pictures',
    ' illustration',
  ];

  const suffix = suffixes[offset % suffixes.length] || '';
  const finalQ = suffix ? `${q}${suffix}` : q;

  try {
    const r = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY':    env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: finalQ, num: 100, gl: 'us' }),
    });

    const data = r.ok ? await r.json() : { images: [] };

    const results = (data.images || []).map(img => ({
      title:         img.title        || '',
      url:           img.link         || '',
      img_src:       img.imageUrl     || '',
      thumbnail_src: img.thumbnailUrl || img.imageUrl || '',
      width:         img.imageWidth   || 0,
      height:        img.imageHeight  || 0,
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
