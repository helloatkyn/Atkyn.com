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

  try {
    // Single Serper call — num:100 is max per call
    const r = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY':    env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q, num: 100, gl: 'us' }),
    });

    const data = r.ok ? await r.json() : {};

    const results = (data.images || []).map(img => ({
      title:         img.title        || '',
      url:           img.link         || '',
      img_src:       img.imageUrl     || '',
      thumbnail_src: img.thumbnailUrl || img.imageUrl || '',
      width:         img.imageWidth   || 0,
      height:        img.imageHeight  || 0,
    }));

    // Related searches — Serper returns these as `relatedSearches`
    const suggestions = (data.relatedSearches || []).map(s => ({
      query: s.query || s,
    }));

    return new Response(JSON.stringify({ results, suggestions }), {
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
