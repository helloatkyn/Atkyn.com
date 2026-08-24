/* functions/api/images.js — Cloudflare Pages Function
   Two parallel Serper calls:
   1. /images  → up to 100 image results
   2. /search  → relatedSearches + organic (for suggestion + source cards)
   Both fired with Promise.all — no extra latency.
*/

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const q   = url.searchParams.get('q')?.trim();

  if (!q) {
    return new Response(JSON.stringify({ error: 'Empty query' }), {
      status: 400,
      headers: corsHeaders({ 'Content-Type': 'application/json' }),
    });
  }

  const headers = {
    'X-API-KEY':    env.SERPER_API_KEY,
    'Content-Type': 'application/json',
  };

  try {
    /* ── Two parallel Serper calls ─────────────────────────────── */
    const [imgRes, searchRes] = await Promise.all([
      fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers,
        body: JSON.stringify({ q, num: 100, gl: 'us' }),
      }),
      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({ q, num: 10, gl: 'us' }),
      }),
    ]);

    const imgData    = imgRes.ok    ? await imgRes.json()    : {};
    const searchData = searchRes.ok ? await searchRes.json() : {};

    /* ── Image results ─────────────────────────────────────────── */
    const results = (imgData.images || []).map(img => ({
      title:         img.title        || '',
      url:           img.link         || '',
      img_src:       img.imageUrl     || '',
      thumbnail_src: img.thumbnailUrl || img.imageUrl || '',
      width:         img.imageWidth   || 0,
      height:        img.imageHeight  || 0,
    }));

    /* ── Related searches (from /search) ───────────────────────── */
    const suggestions = (searchData.relatedSearches || []).map(s => ({
      query: s.query || s,
    }));

    /* ── Top sources (from /search organic) ────────────────────── */
    const sourceResults = (searchData.organic || []).slice(0, 4).map(r => ({
      title: r.title || '',
      url:   r.link  || '',
    }));

    return new Response(JSON.stringify({ results, suggestions, sourceResults }), {
      headers: corsHeaders({ 'Content-Type': 'application/json' }),
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: corsHeaders({ 'Content-Type': 'application/json' }),
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra,
  };
}
