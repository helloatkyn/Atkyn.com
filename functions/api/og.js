/* ═══════════════════════════════════════════════════════════════
   functions/api/og.js — OG image fetcher
   GET /api/og?url=<encoded-url>   →   { image, width?, height? }

   • Reads every image the page declares (og:image + secure_url + size,
     twitter:image, image_src, JSON-LD) and returns the LARGEST one.
   • HTML entities in URLs are decoded (&amp; used to corrupt query strings).
   • Only public http(s) pages / images are fetched or returned.
   • Cache: found 7d at the edge (1d in the browser), "no image" 1d,
     transient failures 5 min and never cached at the edge.
   ═══════════════════════════════════════════════════════════════ */

/* true  → any public https image host is accepted (news sites serve OG images from separate
           domains: s.yimg.com, ichef.bbci.co.uk, i.guim.co.uk …)
   false → old behaviour: same site, or a host in TRUSTED_CDN */
const ALLOW_ANY_HTTPS_IMAGE_HOST = true;

const CACHE_VERSION    = 'v2';        /* bump to invalidate every cached edge entry */
const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES   = 400_000;     /* read stops earlier at </head> */
const WEAK_W = 600;                   /* a declared size below this is "probably a small thumb" */
const WEAK_H = 315;

const TTL = {
  found:     604800,   /* edge: 7 days */
  foundUser:  86400,   /* browser: 1 day */
  empty:      86400,   /* page has no usable image / is not HTML / 404 / 410 */
  retry:       3600,   /* 403, other 4xx */
  transient:    300,   /* 429, 5xx, timeout, network error */
};

/* ── Trusted image CDNs (only used when ALLOW_ANY_HTTPS_IMAGE_HOST is false) ── */
const TRUSTED_CDN = [
  'cloudfront.net', 'amazonaws.com', 'googleusercontent.com', 'imgix.net',
  'cloudinary.com', 'fastly.net', 'akamaized.net', 'cdn.shopify.com',
  'shopifycdn.com', 'cdn.shopifycloud.com', 'images.unsplash.com',
  'cdn.pixabay.com', 'media.istockphoto.com', 'upload.wikimedia.org',
  'static.wikimedia.org', 'i.ytimg.com', 'lh3.googleusercontent.com',
  'fbcdn.net', 'twimg.com', 'pbs.twimg.com', 'media.licdn.com',
  'images.ctfassets.net', 'assets.website-files.com', 'images.squarespace-cdn.com',
  'cdn.prod.website-files.com', 'wp.com', 'i0.wp.com', 'i1.wp.com', 'i2.wp.com',
  'images.prismic.io', 'cdn.sanity.io', 'res.cloudinary.com',
  'storage.googleapis.com', 'blob.core.windows.net', 'imagedelivery.net',
  'img.freepik.com', 'githubusercontent.com', 'vercel.app', 'netlify.app',
  'cloudflare.com', 'cloudflareinsights.com'
];

/* two-label public suffixes, so "a.co.uk" and "b.co.uk" are not treated as one site */
const MULTI_PART_SUFFIX = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.in', 'net.in',
  'org.in', 'co.jp', 'com.br', 'co.nz', 'co.za', 'com.cn', 'com.hk', 'com.sg', 'com.tr', 'com.mx'
]);

/* ═════════ URL safety ═════════ */
function _isPublicHost(host) {
  if (!host || host.indexOf('.') === -1) return false;                /* localhost, intranet names */
  if (host.charAt(0) === '[' || host.indexOf(':') !== -1) return false; /* IPv6 literal */
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;           /* IPv4 literal */
  if (/\.(?:local|localhost|internal|lan|home|corp|intranet)$/i.test(host)) return false;
  return true;
}

/* → URL for a public http(s) address (no credentials, default port), else null */
function _parseUrl(value, base) {
  let u;
  try { u = new URL(value, base); } catch (_) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  if (!_isPublicHost(u.hostname.toLowerCase())) return null;
  return u;
}

function _bare(host) {
  return host.toLowerCase().replace(/^www\./, '');
}

function _registrable(host) {
  const p = host.split('.');
  if (p.length <= 2) return host;
  const last2 = p.slice(-2).join('.');
  return MULTI_PART_SUFFIX.has(last2) ? p.slice(-3).join('.') : last2;
}

function _isImageAllowed(imgHost, siteHosts) {
  if (ALLOW_ANY_HTTPS_IMAGE_HOST) return true;

  const host = _bare(imgHost);
  const root = _registrable(host);

  if (siteHosts.some((h) => h === host || _registrable(h) === root)) return true;
  return TRUSTED_CDN.some((cdn) => host === cdn || host.endsWith('.' + cdn));
}

/* ═════════ HTML parsing ═════════ */
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function _decode(s) {
  return String(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, function (m, e) {
    if (e.charAt(0) === '#') {
      const cp = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    const named = NAMED_ENTITIES[e.toLowerCase()];
    return named === undefined ? m : named;
  });
}

/* Linear tag scanner (no backtracking regexes: a hostile page must not be able to burn CPU).
   A tag ends at the first ">" outside quotes; a raw "<" outside quotes or 8 KB without ">" means it is broken. */
const MAX_TAG_CHARS = 8000;

function _scanTags(html, lower, name, max) {
  const out = [];
  const needle = '<' + name;
  let i = lower.indexOf(needle);

  while (i !== -1 && out.length < max) {
    const next = lower.charAt(i + needle.length);
    let end = -1;

    if (next === ' ' || next === '\t' || next === '\n' || next === '\r' || next === '/' || next === '>') {
      const limit = Math.min(html.length, i + MAX_TAG_CHARS);
      let quote = '';
      for (let j = i + needle.length; j < limit; j++) {
        const c = html.charAt(j);
        if (quote) { if (c === quote) quote = ''; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '>') { end = j; break; }
        if (c === '<') break;
      }
    }

    if (end !== -1) {
      out.push({ text: html.slice(i, end + 1), end });
      i = lower.indexOf(needle, end + 1);
    } else {
      i = lower.indexOf(needle, i + needle.length);
    }
  }
  return out;
}

function _attrs(tag) {
  const out = Object.create(null);
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const body = tag.replace(/^<[a-z]+/i, '').replace(/\/?>$/, '');
  let m;
  while ((m = re.exec(body)) !== null) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
  }
  return out;
}

const _dim = (v) => {
  const n = parseInt(v, 10);
  return n > 0 && n < 100000 ? n : 0;
};

/* ── JSON-LD: only content types (never Organization logos) ── */
const LD_TYPE_RE = /Article|Posting|Product|Video|WebPage|Recipe|Event|ImageObject|Review|Movie|Book|Course/i;

function _ldNum(v) {
  if (v && typeof v === 'object') v = v.value;
  return _dim(v);
}

function _ldImage(v, out) {
  if (!v) return;
  if (Array.isArray(v)) { v.slice(0, 6).forEach(function (x) { _ldImage(x, out); }); return; }
  if (typeof v === 'string') { out.push({ url: v.trim(), w: 0, h: 0 }); return; }
  if (typeof v === 'object') {
    const u = v.url || v.contentUrl;
    if (typeof u === 'string') out.push({ url: u.trim(), w: _ldNum(v.width), h: _ldNum(v.height) });
  }
}

function _collectLd(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 4) return;
  if (Array.isArray(node)) { node.slice(0, 20).forEach(function (n) { _collectLd(n, out, depth + 1); }); return; }

  const type = [].concat(node['@type'] || []).join(' ');
  if (LD_TYPE_RE.test(type)) {
    if (/ImageObject/i.test(type)) _ldImage(node, out);
    _ldImage(node.image, out);
    _ldImage(node.primaryImageOfPage, out);
  }
  if (node['@graph']) _collectLd(node['@graph'], out, depth + 1);
  if (node.mainEntity && typeof node.mainEntity === 'object') _collectLd(node.mainEntity, out, depth + 1);
}

/* → candidates in priority order: og → twitter → image_src → JSON-LD */
function _extractCandidates(html) {
  const og = [];
  const tw = [];
  const link = [];
  const ld = [];
  let cur = null;

  const lower = html.toLowerCase();

  for (const t of _scanTags(html, lower, 'meta', 600)) {
    const a = _attrs(t.text);
    const key = String(a.property || a.name || '').toLowerCase();
    if (!key || a.content === undefined) continue;
    const val = _decode(a.content).trim();

    if (key === 'og:image' || key === 'og:image:url') {
      cur = { url: val, w: 0, h: 0 };
      og.push(cur);
    } else if (key === 'og:image:secure_url') {
      if (cur && !cur.secure) cur.secure = val;
      else if (!cur) { cur = { url: val, w: 0, h: 0 }; og.push(cur); }
    } else if (key === 'og:image:width') {
      if (cur) cur.w = _dim(val);
    } else if (key === 'og:image:height') {
      if (cur) cur.h = _dim(val);
    } else if (key === 'twitter:image' || key === 'twitter:image:src') {
      tw.push({ url: val, w: 0, h: 0 });
    }
  }
  og.forEach(function (c) { if (c.secure) c.url = c.secure; });

  for (const t of _scanTags(html, lower, 'link', 300)) {
    const a = _attrs(t.text);
    if (a.href && /(?:^|\s)image_src(?:\s|$)/i.test(a.rel || '')) {
      link.push({ url: _decode(a.href).trim(), w: 0, h: 0 });
    }
  }

  let parsed = 0;
  for (const t of _scanTags(html, lower, 'script', 200)) {
    if (!/ld\+json/i.test(_attrs(t.text).type || '')) continue;

    const close = lower.indexOf('</script', t.end + 1);
    if (close === -1) break;                         /* head was cut inside this script → nothing after it is complete */
    if (++parsed > 6) break;
    if (close - t.end > 200000) continue;

    try { _collectLd(JSON.parse(html.slice(t.end + 1, close).trim()), ld, 0); } catch (_) { /* malformed JSON-LD is common */ }
  }

  return og.concat(tw, link, ld);
}

/* resolve, make https, drop unsafe / disallowed / duplicate; duplicates keep a known size */
function _finalize(cands, base, siteHosts) {
  const seen = new Map();
  const list = [];

  for (const c of cands) {
    if (!c.url) continue;
    const u = _parseUrl(c.url, base);
    if (!u) continue;
    if (u.protocol === 'http:') u.protocol = 'https:';

    const href = u.href;
    if (href.length > 2048) continue;
    if (!_isImageAllowed(u.hostname, siteHosts)) continue;

    const prev = seen.get(href);
    if (prev) {
      if (!(prev.w > 0 && prev.h > 0) && c.w > 0 && c.h > 0) { prev.w = c.w; prev.h = c.h; }
      continue;
    }
    const item = { url: href, w: c.w, h: c.h };
    seen.set(href, item);
    list.push(item);
  }
  return list;
}

/* largest declared size wins; if that is only a small thumb and a candidate has no declared size, try that one */
function _pickBest(list) {
  if (!list.length) return null;

  let best = null;
  for (const c of list) {
    if (c.w > 0 && c.h > 0 && (!best || c.w * c.h > best.w * best.h)) best = c;
  }
  if (!best) return list[0];

  if (best.w < WEAK_W || best.h < WEAK_H) {
    const unknown = list.find(function (c) { return !(c.w > 0 && c.h > 0); });
    if (unknown) return unknown;
  }
  return best;
}

/* ═════════ network ═════════ */
async function _readHead(resp) {
  if (!resp.body) return '';

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let html = '';
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytes += value.length;
      const from = Math.max(0, html.length - 12);
      html += decoder.decode(value, { stream: true });

      if (/<\/head\s*>/i.test(html.slice(from)) || bytes >= MAX_HTML_BYTES) break;
    }
  } catch (_) {
    /* timeout / reset mid-body: keep what was read, the tags are usually already in it */
  } finally {
    try { await reader.cancel(); } catch (_) {}
  }
  return html;
}

function _result(data, browserTtl, edgeTtl) {
  return { data, browserTtl, edgeTtl };
}

async function _lookup(site) {
  const resp = await fetch(site.href, {
    headers: {
      /* Modern Chrome UA avoids anti-bot blocks that Googlebot faces */
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    signal:   AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });

  if (!resp.ok) {
    try { await resp.body?.cancel(); } catch (_) {}
    if (resp.status === 404 || resp.status === 410) return _result({ image: null }, TTL.empty, TTL.empty);
    if (resp.status === 429 || resp.status >= 500) return _result({ image: null }, TTL.transient, 0);
    return _result({ image: null }, TTL.retry, 0);
  }

  const type = (resp.headers.get('content-type') || '').toLowerCase();
  if (type && !/html|xml/.test(type)) {
    try { await resp.body?.cancel(); } catch (_) {}
    return _result({ image: null }, TTL.empty, TTL.empty);
  }

  /* relative image paths resolve against the page we actually landed on (after redirects) */
  const landed = _parseUrl(resp.url) || site;
  const html = await _readHead(resp);

  const siteHosts = [_bare(site.hostname), _bare(landed.hostname)];
  const list = _finalize(_extractCandidates(html), landed.href, siteHosts);
  const best = _pickBest(list);

  if (!best) return _result({ image: null }, TTL.empty, TTL.empty);

  const data = { image: best.url };
  if (best.w > 0 && best.h > 0) { data.width = best.w; data.height = best.h; }
  return _result(data, TTL.foundUser, TTL.found);
}

/* ═════════ handlers ═════════ */
export async function onRequestGet(context) {
  const raw = new URL(context.request.url).searchParams.get('url');
  const site = raw ? _parseUrl(raw.trim()) : null;
  if (!site) return _json({ image: null }, TTL.empty);

  /* ── Cloudflare edge cache ── */
  const cacheKey = new Request(`https://og.cache/${CACHE_VERSION}/${encodeURIComponent(site.href)}`);
  const cache = caches.default;

  try {
    const hit = await cache.match(cacheKey);
    if (hit) return _json(await hit.json(), TTL.foundUser);
  } catch (_) {}

  let res;
  try {
    res = await _lookup(site);
  } catch (_) {
    res = _result({ image: null }, TTL.transient, 0);
  }

  if (res.edgeTtl > 0) {
    const stored = new Response(JSON.stringify(res.data), {
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': `public, max-age=${res.edgeTtl}`,
      },
    });
    context.waitUntil(cache.put(cacheKey, stored).catch(() => {}));
  }

  return _json(res.data, res.browserTtl);
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

function _json(data, maxAge) {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               `public, max-age=${maxAge}`,
    },
  });
       }
