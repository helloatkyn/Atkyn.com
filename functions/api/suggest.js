/* ═══════════════════════════════════════════════════════════════
   functions/api/suggest.js — Atkyn search suggestions
   DuckDuckGo autocomplete proxy — no key, no cost.
   Returns: JSON string[] of suggestions
   ═══════════════════════════════════════════════════════════════ */

export async function onRequestGet(context) {
  const q = new URL(context.request.url).searchParams.get('q')?.trim();
  if (!q) return _json([]);

  try {
    const resp = await fetch(
      `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`,
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!resp.ok) return _json([]);

    // DDG returns [query, [suggestions]]
    const data = await resp.json();
    const suggestions = Array.isArray(data[1]) ? data[1].slice(0, 8) : [];
    return _json(suggestions);

  } catch (_) {
    return _json([]);
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

function _json(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               'public, max-age=300',
    },
  });
}
