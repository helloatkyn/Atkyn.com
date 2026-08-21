/* ═══════════════════════════════════════════════════════════════
   queryClient.js — Frontend query cache manager
   Include ONCE in index.html (before tab modules load).
   Exposes: window.AtkynQuery.get(tab) → Promise<string>
   ═══════════════════════════════════════════════════════════════ */

(function () {

  /* ── sessionStorage keys ── */
  const KEY_QUERIES = 'atkyn_tab_queries';    // JSON object { answer, web, images, news, videos }
  const KEY_SOURCE  = 'atkyn_tab_queries_src'; // original user query that produced the cache

  /* ── In-flight dedup: if two tabs call get() simultaneously, share one fetch ── */
  let _inflight = null;

  /* ─────────────────────────────────────────────────────────────
     INTERNAL: fetch from /api/query and populate sessionStorage
  ───────────────────────────────────────────────────────────── */
  async function _fetchAndCache(userQuery) {
    if (_inflight) return _inflight; // already fetching for this query

    _inflight = (async () => {
      try {
        const resp = await fetch('/api/query', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ query: userQuery }),
          signal:  AbortSignal.timeout(8000),
        });

        if (!resp.ok) throw new Error(`/api/query returned ${resp.status}`);

        const { source, queries } = await resp.json();

        sessionStorage.setItem(KEY_SOURCE,  source);
        sessionStorage.setItem(KEY_QUERIES, JSON.stringify(queries));

        return queries;
      } catch (err) {
        console.warn('[AtkynQuery] extraction failed, falling back to raw query:', err);
        /* Fallback: every tab gets the raw query */
        const raw      = userQuery;
        const fallback = { answer: raw, web: raw, images: raw, news: raw, videos: raw };
        sessionStorage.setItem(KEY_SOURCE,  raw);
        sessionStorage.setItem(KEY_QUERIES, JSON.stringify(fallback));
        return fallback;
      } finally {
        _inflight = null;
      }
    })();

    return _inflight;
  }

  /* ─────────────────────────────────────────────────────────────
     PUBLIC: invalidate cache when user submits a new query.
     Call this inside send() BEFORE clearing sessionStorage.
  ───────────────────────────────────────────────────────────── */
  function invalidate() {
    sessionStorage.removeItem(KEY_QUERIES);
    sessionStorage.removeItem(KEY_SOURCE);
    _inflight = null;
  }

  /* ─────────────────────────────────────────────────────────────
     PUBLIC: get the optimised query for a specific tab.
     Returns a Promise<string>.

     Usage:
       const q = await window.AtkynQuery.get('web');
       // → "Mistral Nemo API docs"

     If cache exists and matches current atkyn_last_query → instant return.
     If cache is stale/empty → fires /api/query once, caches, then returns.
  ───────────────────────────────────────────────────────────── */
  async function get(tab) {
    const VALID_TABS = new Set(['answer', 'web', 'images', 'news', 'videos']);
    const safeTab    = VALID_TABS.has(tab) ? tab : 'web';

    /* Current user query (set by send() in search.js) */
    const userQuery = sessionStorage.getItem('atkyn_last_query') || '';
    if (!userQuery) return '';

    /* Cache hit: source matches AND queries exist */
    const cachedSource  = sessionStorage.getItem(KEY_SOURCE);
    const cachedRaw     = sessionStorage.getItem(KEY_QUERIES);

    if (cachedSource === userQuery && cachedRaw) {
      try {
        const queries = JSON.parse(cachedRaw);
        if (queries[safeTab]) return queries[safeTab];
      } catch (_) { /* corrupt cache → fall through */ }
    }

    /* Cache miss → fetch */
    const queries = await _fetchAndCache(userQuery);
    return queries[safeTab] || userQuery;
  }

  /* ── Expose ── */
  window.AtkynQuery = { get, invalidate };

})();
