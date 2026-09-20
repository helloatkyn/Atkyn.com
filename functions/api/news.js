/* ═══════════════════════════════════════════════════════════════
   functions/api/news.js — Atkyn News tab
   Serper.dev news proxy — same API key as search.js
   Returns: JSON { results }
═══════════════════════════════════════════════════════════════ */

export async function onRequestGet(context) {
  const { request, env } = context;
  const q = new URL(request.url).searchParams.get('q')?.trim();

  if (!q) {
    return _json({ error: 'Empty query' }, 400);
  }

  try {
    const serperResp = await fetch('https://google.serper.dev/news', {
      method: 'POST',
      headers: {
        'X-API-KEY':    env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q, num: 20, gl: 'in', hl: 'en' }),
      signal: AbortSignal.timeout(8000),
    });

    if (!serperResp.ok) return _json({ error: 'News backend error' }, 502);

    const data = await serperResp.json();

    const results = (data.news || []).slice(0, 20).map(r => ({
      title:         r.title        || '',
      url:           r.link         || '',
      snippet:       r.snippet      || '',
      source:        r.source       || '',
      publishedDate: r.date         || '',
      img_src:       r.imageUrl     || '',
    }));

    return _json({ results });

  } catch (err) {
    return _json({ error: String(err) }, 502);
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

function _json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               'no-cache',
    },
  });
}
