/* ═══════════════════════════════════════════════════════════════
renderer.js — Atkyn Search
marked@13 + KaTeX (CDN) + highlight.js (CDN)
Production-stable rendering pipeline
═══════════════════════════════════════════════════════════════ */

/* ── HTML entity escape ── */
const _ENTITY_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

function _he(s) {
  return String(s).replace(/[&<>"']/g, (c) => _ENTITY_MAP[c]);
}

/* ── Cheap hash ── */
function _cheapHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
  }
  return h;
}

/* ── Normalize newlines ── */
function _normalizeNewlines(str) {
  let s = 0;
  while (s < str.length && str[s] === '\n') s++;

  let e = str.length - 1;
  while (e >= s && str[e] === '\n') e--;

  if (s > e) return '';

  const out = [];
  let i = s;

  while (i <= e) {
    if (str[i] !== '\n') {
      out.push(str[i++]);
    } else {
      let run = 0;
      while (i <= e && str[i] === '\n') {
        run++;
        i++;
      }
      out.push('\n');
      if (run > 1) out.push('\n');
    }
  }

  return out.join('');
}

/* ══════════════════════════════════════════════════════════════
KaTeX helper
══════════════════════════════════════════════════════════════ */
function _katex(tex, display) {
  if (typeof katex === 'undefined') {
    return display ? '$$' + _he(tex) + '$$' : '\\(' + _he(tex) + '\\)';
  }

  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: false
    });
  } catch (_) {
    return display ? '$$' + _he(tex) + '$$' : '\\(' + _he(tex) + '\\)';
  }
}

/* ══════════════════════════════════════════════════════════════
MARKED EXTENSIONS
══════════════════════════════════════════════════════════════ */
function _buildMarked() {
  if (typeof marked === 'undefined') return;

  const extBlockDollar = {
    name: 'blockDollar',
    level: 'block',
    start(src) {
      const i = src.indexOf('$$');
      return i === -1 ? undefined : i;
    },
    tokenizer(src) {
      const m = src.match(/^\$\$([\s\S]+?)\$\$/);
      if (m) return { type: 'blockDollar', raw: m[0], tex: m[1].trim() };
    },
    renderer(t) {
      return '<div class="math-display">' + _katex(t.tex, true) + '</div>\n';
    }
  };

  const extBlockBracket = {
    name: 'blockBracket',
    level: 'block',
    start(src) {
      const i = src.indexOf('\\[');
      return i === -1 ? undefined : i;
    },
    tokenizer(src) {
      const m = src.match(/^\\\[([\s\S]+?)\\\]/);
      if (m) return { type: 'blockBracket', raw: m[0], tex: m[1].trim() };
    },
    renderer(t) {
      return '<div class="math-display">' + _katex(t.tex, true) + '</div>\n';
    }
  };

  const extInlineParen = {
    name: 'inlineParen',
    level: 'inline',
    start(src) {
      const i = src.indexOf('\\(');
      return i === -1 ? undefined : i;
    },
    tokenizer(src) {
      const m = src.match(/^\\\(([\s\S]+?)\\\)/);
      if (m) return { type: 'inlineParen', raw: m[0], tex: m[1].trim() };
    },
    renderer(t) {
      return _katex(t.tex, false);
    }
  };

  marked.use({
    extensions: [extBlockDollar, extBlockBracket, extInlineParen]
  });

  const renderer = new marked.Renderer();

  renderer.code = function (codeOrToken, lang) {
    let code = '';
    let language = '';

    if (codeOrToken && typeof codeOrToken === 'object') {
      code = codeOrToken.text ?? codeOrToken.raw ?? '';
      language = (codeOrToken.lang || codeOrToken.language || '').trim().toLowerCase();
    } else {
      code = codeOrToken;
      language = (lang || '').trim().toLowerCase();
    }

    const id = 'cb' + Math.random().toString(36).slice(2, 8);
    let hi = _he(code);

    if (typeof hljs !== 'undefined') {
      try {
        const valid = language && hljs.getLanguage(language);
        const highlighted = valid
          ? hljs.highlight(code, { language, ignoreIllegals: true })
          : hljs.highlightAuto(code);
        hi = highlighted.value;
      } catch (_) {
        hi = _he(code);
      }
    }

    return (
      '<div class="code-block" id="' + id + '">' +
        '<button type="button" class="code-copy-btn" data-target="' + id + '" aria-label="Copy">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
          ' stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
            '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
          '</svg>' +
        '</button>' +
        '<pre><code class="hljs">' + hi + '</code></pre>' +
      '</div>'
    );
  };

  renderer.table = function (tokenOrHeader, bodyHtml) {
    let header = '';
    let body = '';

    const parsePart = (part) => {
      if (part == null) return '';
      if (typeof part === 'string') return part;
      try {
        if (this.parser && typeof this.parser.parse === 'function') {
          return this.parser.parse(part);
        }
      } catch (_) {}
      return '';
    };

    if (tokenOrHeader && typeof tokenOrHeader === 'object') {
      header = parsePart(tokenOrHeader.header);
      body = parsePart(tokenOrHeader.rows != null ? tokenOrHeader.rows : tokenOrHeader.body);
    } else {
      header = tokenOrHeader;
      body = bodyHtml;
    }

    return (
      '<div class="table-wrap">' +
        '<table>' +
          '<thead>' + header + '</thead>' +
          '<tbody>' + body + '</tbody>' +
        '</table>' +
      '</div>\n'
    );
  };

  renderer.hr = () => '<hr class="md-hr">\n';

  marked.use({
    renderer,
    breaks: true,
    gfm: true
  });
}

_buildMarked();

/* ══════════════════════════════════════════════════════════════
STREAMING GUARD
══════════════════════════════════════════════════════════════ */
function _countOccurrences(str, needle) {
  if (!needle) return 0;
  let count = 0;
  let i = 0;
  while (true) {
    i = str.indexOf(needle, i);
    if (i === -1) break;
    count++;
    i += needle.length;
  }
  return count;
}

function _holdIncomplete(text) {
  if (!text) return { safe: '', held: '' };

  /* $$ ... $$ */
  if (_countOccurrences(text, '$$') % 2 === 1) {
    const idx = text.lastIndexOf('$$');
    return {
      safe: text.slice(0, idx),
      held: text.slice(idx)
    };
  }

  /* \[ ... \] */
  const openB = text.lastIndexOf('\\[');
  const closeB = text.lastIndexOf('\\]');
  if (openB !== -1 && openB > closeB) {
    return {
      safe: text.slice(0, openB),
      held: text.slice(openB)
    };
  }

  /* \( ... \) — only hold if near the tail to avoid holding long normal text */
  const openP = text.lastIndexOf('\\(');
  const closeP = text.lastIndexOf('\\)');
  if (openP !== -1 && openP > closeP && text.length - openP <= 300) {
    return {
      safe: text.slice(0, openP),
      held: text.slice(openP)
    };
  }

  return { safe: text, held: '' };
}

/* ══════════════════════════════════════════════════════════════
PIPELINE
══════════════════════════════════════════════════════════════ */
function _safePipeline(raw, isStreaming = false) {
  if (!raw) return '';

  let src = isStreaming ? _holdIncomplete(raw).safe : raw;
  src = _normalizeNewlines(src);

  if (!src) return '';

  if (typeof marked === 'undefined') {
    return '<pre class="render-fallback">' + _he(raw) + '</pre>';
  }

  try {
    return marked.parse(src);
  } catch (_) {
    return '<pre class="render-fallback">' + _he(raw) + '</pre>';
  }
}

/* ══════════════════════════════════════════════════════════════
LIVE STREAM REGISTRY
HTML strings currently being streamed (bounded). injectCitationChips()
uses it to know a string is still incomplete → no attribution on the
unfinished tail block.
══════════════════════════════════════════════════════════════ */
const _liveStreamSet = new Set();

function _markLive(inst, html) {
  if (inst._live) _liveStreamSet.delete(inst._live);
  inst._live = html || null;
  if (html) {
    _liveStreamSet.add(html);
    if (_liveStreamSet.size > 8) _liveStreamSet.delete(_liveStreamSet.values().next().value);
  }
}

/* ══════════════════════════════════════════════════════════════
UniversalMessageRenderer
══════════════════════════════════════════════════════════════ */
class UniversalMessageRenderer {
  constructor() {
    this.rawContent = '';
    this.renderedContent = '';
    this._hash = null;
    this._buf = '';
    this._streaming = false;
    this._live = null;
  }

  render(content) {
    this.rawContent = content;
    const h = _cheapHash(content);
    if (h === this._hash && this.renderedContent) return this.renderedContent;
    this._hash = h;
    this.renderedContent = _safePipeline(content, false);
    return this.renderedContent;
  }

  startStream() {
    _markLive(this, null);
    this._buf = '';
    this._streaming = true;
    this.rawContent = '';
    this.renderedContent = '';
    this._hash = null;
  }

  pushChunk(chunk) {
    if (!this._streaming) this.startStream();
    this._buf += chunk;
    this.rawContent = this._buf;
    this.renderedContent = _safePipeline(this._buf, true);
    _markLive(this, this.renderedContent);
    return this.renderedContent;
  }

  finishStream() {
    _markLive(this, null);
    this._streaming = false;
    this.renderedContent = _safePipeline(this._buf, false);
    return this.renderedContent;
  }

  getHTML() {
    return this.renderedContent;
  }

  getRaw() {
    return this.rawContent;
  }
}

/* ══════════════════════════════════════════════════════════════
STREAMING FACTORY
══════════════════════════════════════════════════════════════ */
function createStreamingRenderer(onUpdate, debounceMs = 40) {
  const renderer = new UniversalMessageRenderer();
  renderer.startStream();

  let _timer = null;
  let _done = false;

  const _flush = (final) => {
    clearTimeout(_timer);
    _timer = null;
    if (typeof onUpdate === 'function') {
      onUpdate(final ? renderer.finishStream() : renderer.getHTML(), { final });
    }
  };

  return {
    push(chunk) {
      if (_done) return;
      renderer.pushChunk(chunk);
      clearTimeout(_timer);
      _timer = setTimeout(() => _flush(false), debounceMs);
    },
    finish() {
      if (_done) return;
      _done = true;
      clearTimeout(_timer);
      _flush(true);
    },
    getRenderer() {
      return renderer;
    }
  };
}

/* ── Public API ── */
function universalRender(content) {
  return new UniversalMessageRenderer().render(content);
}

function renderMarkdown(text) {
  return universalRender(text);
}

window.universalRender = universalRender;
window.renderMarkdown = renderMarkdown;

/* ══════════════════════════════════════════════════════════════
CITATION CHIP RENDERER
══════════════════════════════════════════════════════════════ */
const _chipRegistry = Object.create(null);
let _chipCounter = 0;

/* Global sources — search.js sets this */
window._atkynSources = [];

document.addEventListener('error', function (e) {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || !img.dataset.chipId) return;

  const id = img.dataset.chipId;
  const src = _chipRegistry[id];
  if (!src) return;

  let domain = '';
  try {
    domain = new URL(src.url).hostname.replace(/^www\./, '');
  } catch (_) {}

  const letter = (domain[0] || '?').toUpperCase();
  const span = document.createElement('span');
  span.className = 'chip-fallback';
  span.textContent = letter;

  img.replaceWith(span);
}, true);

/* Only http(s) URLs may become chips / sheet links (blocks javascript:, data: …) */
function _isSafeUrl(u) {
  if (typeof u !== 'string' || !u) return false;
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/* Escaped JSON snapshot of all sources — cached so N chips do not re-stringify N times */
const _snapCache = new WeakMap();

function _sourcesSnapshot(allSources) {
  if (!allSources || typeof allSources !== 'object') return _he('[]');

  const len = allSources.length || 0;
  let key = '';
  for (let i = 0; i < len; i++) {
    const s = allSources[i];
    key += (s && s.url ? s.url : '') + '\u0001' +
      (s && s.title ? s.title : '') + '\u0001' +
      (s && s.snippet ? String(s.snippet).length : 0) + '\u0002';
  }

  const sig = _cheapHash(key) + ':' + key.length;
  const hit = _snapCache.get(allSources);
  if (hit && hit.sig === sig) return hit.str;

  const str = _he(JSON.stringify(allSources));
  _snapCache.set(allSources, { sig, str });
  return str;
}

/* Deterministic per-URL id → registry cannot grow on re-render */
function _chipIdFor(src) {
  let id = 'chip' + _cheapHash(src.url).toString(36);
  const ex = _chipRegistry[id];
  if (ex && ex.url !== src.url) id += '_' + (++_chipCounter);
  _chipRegistry[id] = src;
  return id;
}

function buildChip(src, allSources) {
  if (!src || !src.url || !_isSafeUrl(src.url)) return '';

  let domain = '';
  try {
    domain = new URL(src.url).hostname.replace(/^www\./, '');
  } catch (_) {
    domain = src.url;
  }

  const domainRoot = domain.split('.')[0];
  const siteName = domainRoot.charAt(0).toUpperCase() + domainRoot.slice(1);
  const label = siteName.length > 22 ? siteName.slice(0, 20) + '\u2026' : siteName;

  const chipId = _chipIdFor(src);

  const faviconUrl = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=64';
  const sourcesSnap = _sourcesSnapshot(allSources || []);

  return (
    '<a class="source-chip"' +
      ' href="' + _he(src.url) + '"' +
      ' style="color:inherit;text-decoration:none"' +
      ' data-chip-url="' + _he(src.url) + '"' +
      ' data-chip-domain="' + _he(domain) + '"' +
      ' data-chip-title="' + _he(src.title || domain) + '"' +
      ' data-chip-favicon="' + _he(faviconUrl) + '"' +
      ' data-chip-sources="' + sourcesSnap + '">' +
      '<img src="' + _he(faviconUrl) + '" width="16" height="16" data-chip-id="' + chipId + '" alt="">' +
      _he(label) +
    '</a>'
  );
}

/* ══════════════════════════════════════════════════════════════
ATTRIBUTION ENGINE  (renderer-owned, DOM-first, deterministic)

  safe HTML → DOM → sentence segmentation → explicit-marker
  collection + existing-chip detection → evidence matching against
  window._atkynSources → streak de-duplication → chip injection.

  • No LLM / network / keyword-routing. Evidence = weighted lexical
    overlap (IDF over the current source set, title/host > snippet).
  • Idempotent: existing chips are re-read as anchors, so a second
    pass over its own output changes nothing.
  • Everything lives in this IIFE (one global name) so it cannot
    collide with identifiers in search.js.
══════════════════════════════════════════════════════════════ */
const _AtkynAttribution = (function () {
  'use strict';

  const MAX_SOURCES = 100;
  const MAX_AUTO = 2;        /* chips per auto-attributed claim   */
  const MAX_EXPLICIT = 3;    /* chips per explicit [n][n] group   */
  const CACHE_MAX = 24;
  const ATOM = '\uE000';
  const UNKNOWN_URL = '\u0000existing';

  const INLINE_OK = new Set(['A', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'DEL', 'INS', 'MARK', 'SMALL', 'SUB', 'SUP', 'ABBR']);
  const BLOCK_OK = new Set(['P', 'UL', 'OL', 'LI', 'BLOCKQUOTE']);
  const BLOCK_OPAQUE = new Set([
    'PRE', 'DIV', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'HR',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'FIGURE', 'DETAILS', 'SECTION', 'ARTICLE', 'ASIDE',
    'NAV', 'HEADER', 'FOOTER', 'FORM', 'FIELDSET', 'DL', 'DD', 'DT', 'ADDRESS', 'CANVAS',
    'VIDEO', 'AUDIO', 'IFRAME', 'SCRIPT', 'STYLE', 'TEMPLATE'
  ]);
  const LEAD_BLOCKS = new Set(['UL', 'OL', 'TABLE', 'PRE']);
  const HEADING_RE = /^H[1-6]$/;
  const CHIP_SEL = '.source-chip, .chip-group, .citation, .citation-ref, [data-citation], [data-chip-url]';

  /* ── sentence boundary data ── */
  const TERM = new Set(['.', '!', '?', '\u2026', '\u3002', '\uFF01', '\uFF1F', '\u0964', '\u0965', '\u061F']);
  const CJK_TERM = new Set(['\u3002', '\uFF01', '\uFF1F']);
  const CLOSE = new Set(['"', "'", '\u201D', '\u2019', '\u00BB', '\u203A', ')', ']', '}', '\u300D', '\u300F', '\uFF09']);
  const QUOTE = new Set(['"', "'", '\u201D', '\u2019', '\u00BB', '\u203A', '\u300D', '\u300F']);
  const HARD_ABBR = new Set(['e.g', 'i.e', 'mr', 'mrs', 'ms', 'dr', 'prof', 'vs', 'cf', 'st', 'jr', 'sr', 'mt', 'viz']);
  const SOFT_ABBR = new Set(['etc', 'inc', 'ltd', 'co', 'corp', 'approx', 'al', 'no', 'fig', 'eq', 'dept', 'est', 'vol', 'pp', 'ca']);

  /* function-word noise filter (NOT an attribution mechanism — evidence comes from IDF overlap) */
  const STOP = new Set((
    'a an the and or but nor so yet of in on at to for from by with without within into onto over under about above below ' +
    'between among through during before after as than then too very just also only own same such not no is am are was were ' +
    'be been being do does did doing done have has had having it its this that these those there here he she they them his ' +
    'her their theirs we us our you your i me my mine who whom whose which what when where why how if while because ' +
    'although though can could may might must shall should will would more most much many some any each every both either ' +
    'neither other another all few less least one ones via per etc ' +
    'hai hain ho tha thi ka ki ke ko se mein par pe aur ya yeh ye woh wo kya bhi to hi ' +
    '\u0939\u0948 \u0939\u0948\u0902 \u0939\u094B \u0925\u093E \u0925\u0940 \u0925\u0947 \u0915\u093E \u0915\u0940 \u0915\u0947 \u0915\u094B \u0938\u0947 \u092E\u0947\u0902 \u092A\u0930 \u0914\u0930 \u092F\u093E \u092F\u0939 \u092F\u0947 \u0935\u0939 \u0935\u094B \u0915\u094D\u092F\u093E \u092D\u0940 \u0924\u094B \u0939\u0940'
  ).split(' '));

  const TOKEN_RE = /[\p{L}\p{M}\p{N}]+(?:[.'\u2019][\p{L}\p{M}\p{N}]+)*/gu;
  const MARK_RE = /[ \t]*\[\s*\d{1,3}(?:\s*,\s*\d{1,3})*\s*\](?:[ \t]*\[\s*\d{1,3}(?:\s*,\s*\d{1,3})*\s*\])*/g;
  const MATH_RE = /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$/g;

  /* ═════════ text / token helpers ═════════ */
  function normText(s) {
    s = String(s).toLowerCase();
    try { s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (_) {}
    return s.replace(/['\u2019`]/g, '');
  }

  /* plural-only stemming: predictable, no over-merging */
  function stem(t) {
    if (t.length > 4 && /[a-z]$/.test(t)) {
      if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
      if (t.endsWith('sses')) return t.slice(0, -2);
      if (t.endsWith('s') && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
    }
    return t;
  }

  function setMax(map, k, v) {
    if ((map.get(k) || 0) < v) map.set(k, v);
  }

  function addDocTokens(text, factor, map, limit) {
    if (!text) return;
    text = String(text);
    if (limit && text.length > limit) text = text.slice(0, limit);
    for (const m of normText(text).matchAll(TOKEN_RE)) {
      const tk = m[0];
      if (STOP.has(tk) || (tk.length < 2 && !/\d/.test(tk))) continue;
      setMax(map, stem(tk), factor);
    }
  }

  function addUrlTokens(url, map) {
    let u;
    try { u = new URL(url); } catch (_) { return; }
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const labels = host.split('.');
    if (labels.length > 1) labels.pop();
    addDocTokens(labels.join(' '), 1, map, 120);
    setMax(map, normText(host), 1);
    let path = u.pathname;
    try { path = decodeURIComponent(path); } catch (_) {}
    addDocTokens(path.replace(/[-_/]+/g, ' '), 0.75, map, 200);
  }

  /* sentence tokens keep case info → proper nouns / numbers weigh more */
  function extractTokens(slice) {
    const out = [];
    const seen = new Map();
    let pos = 0;
    for (const m of slice.matchAll(TOKEN_RE)) {
      const raw = m[0];
      const low = normText(raw);
      const at = pos++;
      if (STOP.has(low) || (low.length < 2 && !/\d/.test(low))) continue;
      const st = stem(low);
      let boost = 1;
      if (/\d/.test(raw)) boost = 1.5;
      else if (at > 0 && /^\p{Lu}/u.test(raw)) boost = 1.5;
      else if (raw.length >= 2 && raw === raw.toUpperCase() && /\p{L}/u.test(raw)) boost = 1.5;
      const prev = seen.get(st);
      if (prev) { if (boost > prev.boost) prev.boost = boost; continue; }
      const t = { stem: st, boost };
      seen.set(st, t);
      out.push(t);
    }
    return out;
  }

  /* ═════════ source index (cached by content signature) ═════════ */
  const idxCache = new Map();

  function buildIndex(sources, sig) {
    const n = Math.min(sources.length, MAX_SOURCES);
    const list = Array.prototype.slice.call(sources, 0, n);
    const entries = [];
    const canon = [];
    const seen = new Map();
    const post = new Map();

    for (let i = 0; i < n; i++) {
      const s = list[i];
      const url = s && typeof s.url === 'string' ? s.url : '';
      if (!url || !_isSafeUrl(url)) { canon.push(-1); continue; }

      let ci = seen.get(url);
      if (ci === undefined) {
        ci = entries.length;
        seen.set(url, ci);
        entries.push({ src: s, url });

        const doc = new Map();
        addDocTokens(s.title, 1, doc, 300);
        addDocTokens(s.siteName || s.site || s.publisher, 1, doc, 100);
        addUrlTokens(url, doc);
        const body = [s.snippet, s.description, s.summary, s.excerpt, s.content, s.text];
        for (let b = 0; b < body.length; b++) addDocTokens(body[b], 0.75, doc, 1500);

        doc.forEach(function (f, st) {
          let p = post.get(st);
          if (!p) { p = []; post.set(st, p); }
          p.push([ci, f]);
        });
      }
      canon.push(ci);
    }

    const N = entries.length;
    return {
      sig, entries, canon, post, sources: list, groups: new Map(),
      idf(df) {
        if (df < 1) df = 1;
        return Math.max(0.05, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
      }
    };
  }

  function getIndex(sources) {
    if (!sources || !sources.length) return null;
    const n = Math.min(sources.length, MAX_SOURCES);
    let key = n + '|';
    for (let i = 0; i < n; i++) {
      const s = sources[i];
      key += (s && s.url ? s.url : '') + '\u0001' +
        (s && s.title ? s.title : '') + '\u0001' +
        (s && s.snippet ? String(s.snippet).length : 0) + '\u0002';
    }
    const sig = _cheapHash(key) + ':' + key.length;

    let idx = idxCache.get(sig);
    if (!idx) {
      idx = buildIndex(sources, sig);
      idxCache.set(sig, idx);
      if (idxCache.size > 8) idxCache.delete(idxCache.keys().next().value);
    }
    return idx.entries.length ? idx : null;
  }

  /* ═════════ evidence matching ═════════ */
  function matchTokens(toks, idx) {
    const n = toks.length;
    if (n < 2) return null;

    let total = 0;
    const acc = new Map();
    for (let i = 0; i < n; i++) {
      const t = toks[i];
      const post = idx.post.get(t.stem);
      const w = idx.idf(post ? post.length : 1) * t.boost;
      total += w;
      if (!post) continue;
      for (let k = 0; k < post.length; k++) {
        const ci = post[k][0];
        let a = acc.get(ci);
        if (!a) { a = [0, 0]; acc.set(ci, a); }
        a[0] += w * post[k][1];
        a[1]++;
      }
    }
    if (!total) return null;

    const thr = n <= 3 ? 0.66 : n <= 6 ? 0.45 : 0.34;
    const idf1 = idx.idf(1);
    const hits = [];
    acc.forEach(function (a, ci) {
      const ratio = a[0] / total;
      /* 1) coverage: enough of the claim is explained by this source (unchanged rule) */
      let ok = a[1] >= 2 && ratio >= thr;
      /* 2) long claims dilute coverage → accept on absolute evidence (≥3 matched terms, rare-term weight) with a coverage floor */
      if (!ok && a[1] >= 3 && a[0] >= 2 * idf1 && ratio >= 0.2) ok = true;
      if (ok) hits.push([ci, ratio]);
    });
    if (!hits.length) return null;

    /* ties broken by URL (not array position) → result never depends on source order */
    hits.sort(function (x, y) {
      if (y[1] !== x[1]) return y[1] - x[1];
      const ux = idx.entries[x[0]].url, uy = idx.entries[y[0]].url;
      return ux < uy ? -1 : ux > uy ? 1 : 0;
    });
    const best = hits[0][1];
    const band = function (f) { return hits.filter(function (h) { return h[1] >= best * f; }); };
    let keep = band(0.85);
    if (keep.length > MAX_AUTO) keep = band(0.95);   /* try a tighter tie band before giving up */
    if (keep.length > MAX_AUTO) return null;         /* still a genuine tie → do not pretend certainty */
    return keep.map(function (h) { return idx.entries[h[0]]; });
  }

  /* ═════════ sentence segmentation ═════════ */
  const isWsCh = (c) => c === ' ' || c === '\t' || c === '\u00a0' || c === '\u2009' || c === '\u202f';
  const isLowerCh = (c) => /\p{Ll}/u.test(c);
  const isUpperCh = (c) => /\p{Lu}/u.test(c);

  function skipAllWs(t, i) {
    while (i < t.length && (isWsCh(t[i]) || t[i] === '\n')) i++;
    return i;
  }

  function tokenBefore(t, i) {
    let j = i;
    while (j > 0 && !isWsCh(t[j - 1]) && t[j - 1] !== '\n') j--;
    return t.slice(j, i);
  }

  function isBoundary(t, i, j, k, quote) {
    const L = t.length;
    if (k >= L) return true;
    if (CJK_TERM.has(t[j - 1])) return true;
    const nc = t[k];
    if (nc === '\n') return true;
    if (!isWsCh(nc)) return false;                    /* 3.5  example.com  ?q=  */

    let n = k;
    while (n < L && isWsCh(t[n])) n++;
    if (n >= L || t[n] === '\n') return true;

    const nw = t[n];
    const lowerNext = isLowerCh(nw);
    const digitNext = /\d/.test(nw);
    if (quote && lowerNext) return false;             /* "Yes." she said */

    const run = t.slice(i, j);
    if (run.indexOf('\u2026') !== -1 || (run.length > 1 && run[0] === '.')) return !lowerNext;
    if (run !== '.') return true;

    const tok = tokenBefore(t, i);
    const lt = tok.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '');
    if (HARD_ABBR.has(lt)) return false;
    if (SOFT_ABBR.has(lt)) return !(lowerNext || digitNext);
    if (/^(?:\p{L}{1,2}\.)+\p{L}{1,2}$/u.test(lt)) return !(lowerNext || digitNext);   /* U.S.  a.m.  Ph.D. */
    if (/^\p{Lu}$/u.test(tok.replace(/^[^\p{L}]+/u, ''))) return !isUpperCh(nw);        /* J. K. Rowling */
    return true;
  }

  function segment(t) {
    const out = [];
    const L = t.length;
    const push = function (s, e) {
      while (e > s && (isWsCh(t[e - 1]) || t[e - 1] === '\n')) e--;
      if (e > s) out.push({ s, e });
    };

    let start = skipAllWs(t, 0);
    let i = start;
    while (i < L) {
      const c = t[i];
      if (c === '\n') {
        push(start, i);
        start = i = skipAllWs(t, i + 1);
        continue;
      }
      if (!TERM.has(c)) { i++; continue; }

      let j = i;
      while (j < L && TERM.has(t[j])) j++;
      let k = j;
      let quote = false;
      while (k < L && CLOSE.has(t[k])) { if (QUOTE.has(t[k])) quote = true; k++; }

      if (isBoundary(t, i, j, k, quote)) {
        push(start, k);
        start = i = skipAllWs(t, k);
      } else {
        i = j;
      }
    }
    if (start < L) push(start, L);
    return out;
  }

  function lastMeaningful(seg, s, e) {
    let i = e - 1;
    while (i >= s && CLOSE.has(seg[i])) i--;
    return i >= s ? seg[i] : '';
  }

  const endsWithQuestion = (seg, s, e) => { const c = lastMeaningful(seg, s, e); return c === '?' || c === '\uFF1F' || c === '\u061F'; };
  const endsWithColon = (seg, s, e) => { const c = lastMeaningful(seg, s, e); return c === ':' || c === '\uFF1A'; };

  function tailIsPunct(seg, from, to) {
    if (to - from > 6 || to <= from) return false;
    for (let i = from; i < to; i++) {
      if (!TERM.has(seg[i]) && !CLOSE.has(seg[i])) return false;
    }
    return true;
  }

  /* ═════════ DOM helpers ═════════ */
  const isChipEl = (n) => n.nodeType === 1 && n.matches(CHIP_SEL);

  function chipUrls(el) {
    const out = [];
    const add = (u) => { if (u && out.indexOf(u) < 0) out.push(u); };
    add(el.getAttribute('data-chip-url'));
    const inner = el.querySelectorAll('[data-chip-url]');
    for (let i = 0; i < inner.length; i++) add(inner[i].getAttribute('data-chip-url'));
    if (!out.length) add(el.getAttribute('href') || el.getAttribute('data-url'));
    if (!out.length) out.push(UNKNOWN_URL);
    return out;
  }

  function addUnique(arr, v) { if (arr.indexOf(v) < 0) arr.push(v); }

  function mergeEntries(a, b) {
    const out = [];
    const seen = new Set();
    a.concat(b).forEach(function (e) { if (!seen.has(e.url)) { seen.add(e.url); out.push(e); } });
    return out.slice(0, MAX_EXPLICIT);
  }

  /* inline runs = maximal sibling sequences of inline content inside one block container */
  function collectRuns(container, runs) {
    let cur = null;
    const flush = function () {
      if (cur && cur.nodes.length) runs.push(cur);
      cur = null;
    };

    for (let n = container.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        if (!cur) cur = { parent: container, nodes: [], info: null };
        cur.nodes.push(n);
        continue;
      }
      if (n.nodeType !== 1) continue;

      const tag = n.tagName;
      if (isChipEl(n) || (!BLOCK_OK.has(tag) && !BLOCK_OPAQUE.has(tag))) {
        if (!cur) cur = { parent: container, nodes: [], info: null };
        cur.nodes.push(n);
        continue;
      }

      flush();
      if (BLOCK_OK.has(tag)) collectRuns(n, runs);
    }
    flush();
  }

  function leadsIntoBlock(run) {
    let n = run.nodes[run.nodes.length - 1].nextSibling;
    while (n && n.nodeType === 3 && !n.data.trim()) n = n.nextSibling;
    if (!n) {
      const c = run.parent;
      if (c.tagName !== 'P' && c.tagName !== 'BLOCKQUOTE') return false;
      n = c.nextElementSibling;
    }
    if (!n || n.nodeType !== 1) return false;
    return LEAD_BLOCKS.has(n.tagName) || (n.tagName === 'DIV' && n.classList.contains('table-wrap'));
  }

  /* ═════════ explicit marker stripping ═════════ */
  function stripMarkers(data, base, idx) {
    if (data.indexOf('[') === -1) return null;

    MARK_RE.lastIndex = 0;
    let out = '';
    let last = 0;
    let found = null;
    let m;

    while ((m = MARK_RE.exec(data)) !== null) {
      const entries = [];
      const seenE = new Set();
      const nums = m[0].match(/\d{1,3}/g) || [];
      for (let k = 0; k < nums.length; k++) {
        const ci = idx.canon[parseInt(nums[k], 10) - 1];
        if (ci !== undefined && ci >= 0 && !seenE.has(ci)) {
          seenE.add(ci);
          entries.push(idx.entries[ci]);
        }
      }
      if (!entries.length) continue;          /* [7] with no source 7 → leave text alone */

      out += data.slice(last, m.index);
      const after = data.charAt(m.index + m[0].length);
      const lead = m[0].charAt(0) === ' ' || m[0].charAt(0) === '\t';
      if (lead && after && out && !/\s$/.test(out) && /[\p{L}\p{N}]/u.test(after)) out += ' ';

      if (!found) found = [];
      found.push({ off: base + out.length, entries });
      last = m.index + m[0].length;
    }

    if (!found) return null;
    return { data: out + data.slice(last), found };
  }

  function stripHeading(h, ctx) {
    let refs = [];
    const walk = function (node) {
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          const res = stripMarkers(c.data, 0, ctx.idx);
          if (res) {
            c.data = res.data;
            ctx.changed = true;
            res.found.forEach(function (f) { refs = mergeEntries(refs, f.entries); });
          }
        } else if (c.nodeType === 1 && INLINE_OK.has(c.tagName) && c.tagName !== 'A') {
          walk(c);
        }
      }
    };
    walk(h);
    return refs;
  }

  /* ═════════ run scanning → sentence units ═════════ */
  function newUnit(run, s, e, pseudo) {
    return {
      run, info: null, s, e, pseudo: !!pseudo, isLast: false,
      events: [], moves: [], explicit: [], newExplicit: [], urls: [],
      anchored: false, auto: null, inject: null
    };
  }

  function unitFor(units, off) {
    for (let i = 0; i < units.length; i++) {
      const nextStart = i + 1 < units.length ? units[i + 1].s : Infinity;
      if (off <= nextStart) return i;
    }
    return units.length - 1;
  }

  function scanRun(run, ctx) {
    const idx = ctx.idx;
    const parts = [];
    const events = [];
    const marks = [];
    let flat = '';

    const visit = function (n, inLink) {
      if (n.nodeType === 3) {
        let data = n.data;
        if (!inLink) {
          const res = stripMarkers(data, flat.length, idx);
          if (res) {
            n.data = data = res.data;
            ctx.changed = true;
            for (let i = 0; i < res.found.length; i++) marks.push(res.found[i]);
          }
        }
        if (!data) return;
        parts.push({ node: n, start: flat.length, end: flat.length + data.length, kind: 0 });
        flat += data.replace(/[\r\n\t\f\v]/g, ' ');
        return;
      }
      if (n.nodeType !== 1) return;

      if (isChipEl(n)) { events.push({ el: n, off: flat.length, urls: chipUrls(n) }); return; }

      const tag = n.tagName;
      if (tag === 'BR') {
        parts.push({ node: n, start: flat.length, end: flat.length + 1, kind: 2 });
        flat += '\n';
        return;
      }
      if (INLINE_OK.has(tag)) {
        const link = inLink || tag === 'A';
        for (let c = n.firstChild; c; c = c.nextSibling) visit(c, link);
        return;
      }
      /* inline code, KaTeX, images, raw spans … → opaque atom */
      parts.push({ node: n, start: flat.length, end: flat.length + 1, kind: 1 });
      flat += ATOM;
    };

    for (let i = 0; i < run.nodes.length; i++) visit(run.nodes[i], false);

    const seg = flat.replace(MATH_RE, function (m) { return ATOM.repeat(m.length); }).replace(/\uE000/g, '0');
    const plain = flat.replace(MATH_RE, function (m) { return ' '.repeat(m.length); }).replace(/\uE000/g, ' ');

    const sents = segment(seg);
    const units = [];
    for (let i = 0; i < sents.length; i++) units.push(newUnit(run, sents[i].s, sents[i].e, false));
    if (!units.length && (events.length || marks.length)) units.push(newUnit(run, flat.length, flat.length, true));
    if (units.length) units[units.length - 1].isLast = true;

    const info = { parts, seg, plain, units, leads: null };
    for (let i = 0; i < units.length; i++) units[i].info = info;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const u = units[unitFor(units, ev.off)];
      u.events.push(ev);
      /* legacy placement "word[chip]." → normalise to "word. [chip]" */
      if (!u.pseudo && ev.off > u.s && ev.off < u.e && tailIsPunct(seg, ev.off, u.e)) u.moves.push(ev.el);
    }
    for (let i = 0; i < marks.length; i++) {
      const u = units[unitFor(units, marks[i].off)];
      u.explicit = mergeEntries(u.explicit, marks[i].entries);
    }
    return info;
  }

  function finalize(u) {
    const existing = [];
    for (let i = 0; i < u.events.length; i++) {
      for (let k = 0; k < u.events[i].urls.length; k++) addUnique(existing, u.events[i].urls[k]);
    }
    u.newExplicit = u.explicit.filter(function (e) { return existing.indexOf(e.url) < 0; }).slice(0, MAX_EXPLICIT);
    u.urls = existing.concat(u.newExplicit.map(function (e) { return e.url; }));
    u.anchored = u.events.length > 0 || u.explicit.length > 0;
  }

  function autoMatch(u, ctx) {
    if (u.pseudo) return null;
    const info = u.info;
    if (endsWithQuestion(info.seg, u.s, u.e)) return null;       /* questions are not claims */
    if (u.isLast && endsWithColon(info.seg, u.s, u.e)) {         /* "Popular apps:" + list   */
      if (info.leads === null) info.leads = leadsIntoBlock(u.run);
      if (info.leads) return null;
    }
    return matchTokens(extractTokens(info.plain.slice(u.s, u.e)), ctx.idx);
  }

  /* A streak = consecutive claims sharing one primary source → ONE chip, at its last claim */
  function applyStreaks(units) {
    let cur = null;
    const close = function () {
      if (cur && !cur.anchored && cur.last) cur.last.inject = cur.last.auto;
      cur = null;
    };
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const urls = u.anchored ? u.urls : (u.auto ? u.auto.map(function (e) { return e.url; }) : null);
      if (!urls || !urls.length) {
        /* an unsupported claim ends the streak → earlier claims keep their own chip instead of
           being merged (and dropped) into a later same-source claim across the gap */
        if (!u.pseudo) close();
        continue;
      }
      if (!cur || cur.primary !== urls[0]) {
        close();
        cur = { primary: urls[0], anchored: false, last: null };
      }
      if (u.anchored) cur.anchored = true;
      else cur.last = u;
    }
    close();
  }

  /* ═════════ chip DOM construction + placement ═════════ */
  let chipTpl = null;

  /* chip groups are built (and parsed) once per distinct source-set, then cloned */
  function groupNode(entries, kind, idx) {
    let key = kind;
    for (let i = 0; i < entries.length; i++) key += '\u0001' + entries[i].url;

    let proto = idx.groups.get(key);
    if (!proto) {
      let html = '';
      for (let i = 0; i < entries.length; i++) html += buildChip(entries[i].src, idx.sources);
      if (!html) return null;
      if (!chipTpl) chipTpl = document.createElement('template');
      chipTpl.innerHTML = '<span class="chip-group" data-attr="' + kind + '">' + html + '</span>';
      proto = chipTpl.content.firstChild;
      if (idx.groups.size > 200) idx.groups.clear();
      idx.groups.set(key, proto);
    }
    return proto.cloneNode(true);
  }

  function isTrailing(node) {
    for (let n = node.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === 3 && !n.data.trim()) continue;
      return false;
    }
    return true;
  }

  function findPart(parts, p) {
    let lo = 0;
    let hi = parts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const pt = parts[mid];
      if (p < pt.start) hi = mid - 1;
      else if (p >= pt.end) lo = mid + 1;
      else return pt;
    }
    return null;
  }

  /* returns {parent, before} — the point right AFTER the sentence's final character */
  function locate(run, info, endOff) {
    const top = run.parent;
    let ref = null;

    const pt = endOff > 0 ? findPart(info.parts, endOff - 1) : null;
    if (pt) {
      if (pt.kind === 0) {
        const local = endOff - 1 - pt.start + 1;
        if (local < pt.node.data.length) pt.node.splitText(local);
      }
      ref = pt.node;
    } else {
      ref = run.nodes[run.nodes.length - 1];
    }
    if (!ref || !ref.parentNode) return null;

    let cur = ref;
    while (cur.parentNode && cur.parentNode !== top && isTrailing(cur)) cur = cur.parentNode;
    if (!cur.parentNode) return null;

    /* a chip is an <a> — never nest it inside another link */
    for (let a = cur.parentNode; a && a !== top; a = a.parentNode) {
      if (a.tagName === 'A') return null;
    }
    return { parent: cur.parentNode, before: cur.nextSibling };
  }

  function applyUnit(run, u, ctx) {
    const adds = [];
    const doc = run.parent.ownerDocument;

    if (u.moves.length) for (let i = 0; i < u.moves.length; i++) adds.push(u.moves[i]);
    if (u.newExplicit.length) { const g = groupNode(u.newExplicit, 'explicit', ctx.idx); if (g) adds.push(g); }
    if (u.inject && u.inject.length) { const g = groupNode(u.inject, 'auto', ctx.idx); if (g) adds.push(g); }
    if (!adds.length) return;

    const info = u.info;
    const pos = locate(run, info, u.e);
    if (!pos) return;

    for (let i = 0; i < u.moves.length; i++) {
      const el = u.moves[i];
      if (pos.before === el) pos.before = el.nextSibling;
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    const df = doc.createDocumentFragment();
    const prev = u.e > 0 ? info.seg.charAt(u.e - 1) : '';
    if (prev && !/\s/.test(prev)) df.appendChild(doc.createTextNode(' '));
    for (let i = 0; i < adds.length; i++) {
      if (i) df.appendChild(doc.createTextNode(' '));
      df.appendChild(adds[i]);
    }
    pos.parent.insertBefore(df, pos.before);
    ctx.changed = true;
  }

  /* reverse order: later splits never invalidate earlier offsets */
  function applyRun(run, ctx) {
    const us = run.info.units;
    for (let i = us.length - 1; i >= 0; i--) applyUnit(run, us[i], ctx);
  }

  /* ═════════ scopes ═════════ */
  function processRuns(runs, ctx, pending, noAuto) {
    const units = [];
    for (let i = 0; i < runs.length; i++) {
      runs[i].info = scanRun(runs[i], ctx);
      for (let k = 0; k < runs[i].info.units.length; k++) units.push(runs[i].info.units[k]);
    }

    if (pending.length && units.length) {        /* refs that sat on a heading */
      units[0].explicit = mergeEntries(pending, units[0].explicit);
      pending = [];
    }

    for (let i = 0; i < units.length; i++) {
      finalize(units[i]);
      if (!units[i].anchored && !noAuto) units[i].auto = autoMatch(units[i], ctx);
    }

    applyStreaks(units);
    for (let i = 0; i < runs.length; i++) applyRun(runs[i], ctx);
    return pending;
  }

  function processTable(el, ctx, pending) {
    const table = el.tagName === 'TABLE' ? el : el.querySelector('table');
    if (!table) return pending;

    const rows = [];
    const allRuns = [];
    const trs = table.querySelectorAll('tr');
    for (let i = 0; i < trs.length; i++) {
      const tr = trs[i];
      const head = !!(tr.parentNode && tr.parentNode.tagName === 'THEAD');
      const runs = [];
      let cells = 0;
      for (let c = tr.firstElementChild; c; c = c.nextElementSibling) {
        if (c.tagName === 'TD' || c.tagName === 'TH') { cells++; collectRuns(c, runs); }
      }
      for (let k = 0; k < runs.length; k++) {
        runs[k].info = scanRun(runs[k], ctx);
        allRuns.push(runs[k]);
      }
      rows.push({ tr, head, runs, cells });
    }

    const rowUnits = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      let anchored = false;
      let plain = '';
      const urls = [];
      for (let k = 0; k < r.runs.length; k++) {
        const us = r.runs[k].info.units;
        for (let q = 0; q < us.length; q++) {
          finalize(us[q]);
          if (us[q].anchored) { anchored = true; us[q].urls.forEach(function (x) { addUnique(urls, x); }); }
        }
        plain += ' ' + r.runs[k].info.plain;
      }
      if (r.head) continue;

      const ru = { tr: r.tr, anchored, urls, auto: null, inject: null };
      if (!anchored && r.cells >= 2) ru.auto = matchTokens(extractTokens(plain), ctx.idx);
      rowUnits.push(ru);
    }

    applyStreaks(rowUnits);
    for (let i = 0; i < allRuns.length; i++) applyRun(allRuns[i], ctx);

    for (let i = 0; i < rowUnits.length; i++) {
      const ru = rowUnits[i];
      if (!ru.inject || !ru.inject.length) continue;
      const cell = ru.tr.lastElementChild;
      if (!cell) continue;
      const g = groupNode(ru.inject, 'auto', ctx.idx);
      if (!g) continue;
      const doc = cell.ownerDocument;
      cell.appendChild(doc.createTextNode(' '));
      cell.appendChild(g);
      ctx.changed = true;
    }
    return pending;
  }

  function processScope(el, ctx, pending) {
    const tag = el.tagName;
    if (HEADING_RE.test(tag)) {
      return mergeEntries(pending, stripHeading(el, ctx));   /* headings never get chips */
    }
    if (tag === 'P' || tag === 'UL' || tag === 'OL' || tag === 'BLOCKQUOTE') {
      const runs = [];
      collectRuns(el, runs);
      return processRuns(runs, ctx, pending, tag === 'BLOCKQUOTE');
    }
    if (tag === 'TABLE' || (tag === 'DIV' && el.classList.contains('table-wrap'))) {
      return processTable(el, ctx, pending);
    }
    return pending;   /* pre / code-block / math-display / hr / raw html → untouched */
  }

  function run(root, idx, opts) {
    const ctx = { idx, changed: false };
    const kids = Array.prototype.slice.call(root.children || []);
    /* streaming: the last top-level block may still be growing → leave it alone */
    const limit = opts && opts.streaming ? kids.length - 1 : kids.length;
    let pending = [];
    for (let i = 0; i < limit; i++) pending = processScope(kids[i], ctx, pending);
    return ctx.changed;
  }

  /* ═════════ string API (+ small result cache) ═════════ */
  const resultCache = new Map();

  function isLiveStreamHtml(html) {
    return typeof _liveStreamSet !== 'undefined' && _liveStreamSet.has(html);
  }

  function process(html, sources, opts) {
    if (typeof html !== 'string' || !html) return html;
    const idx = getIndex(sources);
    if (!idx) return html;

    const streaming = opts && typeof opts.streaming === 'boolean' ? opts.streaming : isLiveStreamHtml(html);
    const key = idx.sig + (streaming ? 's' : 'f') + ':' + html.length + ':' + _cheapHash(html);
    const hit = resultCache.get(key);
    if (hit && hit.html === html) return hit.out;

    const tpl = document.createElement('template');
    tpl.innerHTML = html;                 /* inert: nothing executes / loads */
    const changed = run(tpl.content, idx, { streaming });
    const out = changed ? tpl.innerHTML : html;

    resultCache.set(key, { html, out });
    if (resultCache.size > CACHE_MAX) resultCache.delete(resultCache.keys().next().value);
    return out;
  }

  function applyToDOM(root, sources, opts) {
    const idx = getIndex(sources);
    if (!idx || !root) return false;
    return run(root, idx, { streaming: !!(opts && opts.streaming) });
  }

  return { process, applyToDOM };
})();

/* Public API — signature unchanged. Optional 3rd arg: { streaming: true|false }.
   Without it, HTML that is still being streamed by createStreamingRenderer() is detected automatically. */
function injectCitationChips(html, sources, opts) {
  if (!html || !sources || !sources.length) return html;
  return _AtkynAttribution.process(html, sources, opts);
}

window.injectCitationChips = injectCitationChips;
window.injectCitationChipsDOM = function (root, sources, opts) {
  return _AtkynAttribution.applyToDOM(root, sources, opts);
};

/* ══════════════════════════════════════════════════════════════
SOURCE CHIP BOTTOM SHEET — Google Web Results Style
══════════════════════════════════════════════════════════════ */
(function initChipSheet() {
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', initChipSheet, { once: true });
    return;
  }

  const sheet = document.createElement('div');
  sheet.id = 'chipSheet';
  sheet.innerHTML =
    '<div id="chipSheetBackdrop"></div>' +
    '<div id="chipSheetCard">' +
      '<div id="chipSheetList"></div>' +
    '</div>';

  document.body.appendChild(sheet);

  function _domain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {
      return url;
    }
  }

  function _favicon(domain) {
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=64';
  }

  function _shortUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.length > 1
        ? u.hostname.replace(/^www\./, '') + u.pathname
        : u.hostname.replace(/^www\./, '');
      return path.length > 48 ? path.slice(0, 46) + '\u2026' : path;
    } catch (_) {
      return url.length > 48 ? url.slice(0, 46) + '\u2026' : url;
    }
  }

  function _cleanTrail(s) {
    return String(s || '').replace(/[\s\u00a0](\u2026|.{2,3})$/, '').trimEnd();
  }

  function _fetchOg(url) {
    let signal;

    try {
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        signal = AbortSignal.timeout(6000);
      }
    } catch (_) {}

    return fetch('/api/og?url=' + encodeURIComponent(url), signal ? { signal } : undefined)
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        return d && d.image ? d.image : null;
      })
      .catch(function () {
        return null;
      });
  }

  function _injectOg(cardEl, image) {
    if (!image || !cardEl) return;

    const titleEl = cardEl.querySelector('.csi-title');
    if (!titleEl) return;

    const img = document.createElement('img');
    img.src = image;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';

    img.addEventListener('load', function () {
      const ratio = img.naturalWidth / img.naturalHeight;

      if (ratio >= 1.3) {
        img.className = 'csi-og-full';
        const wrap = document.createElement('div');
        wrap.className = 'csi-og-full-wrap';
        wrap.appendChild(img);

        if (titleEl.nextSibling) {
          titleEl.parentNode.insertBefore(wrap, titleEl.nextSibling);
        } else {
          titleEl.parentNode.appendChild(wrap);
        }
      } else {
        img.className = 'csi-og-thumb';
        const snippetEl = cardEl.querySelector('.csi-snippet');
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'csi-og-thumb-wrap';
        thumbWrap.appendChild(img);

        const row = document.createElement('div');
        row.className = 'csi-og-inline-row';

        if (snippetEl) {
          snippetEl.parentNode.insertBefore(row, snippetEl);
          row.appendChild(snippetEl);
        }

        row.appendChild(thumbWrap);
      }
    }, { once: true });

    img.addEventListener('error', function () {
      img.remove();
    }, { once: true });
  }

  function _buildSheetItem(src) {
    const domain = _domain(src.url);
    const favicon = _favicon(domain);
    const title = _cleanTrail(src.title || domain);
    const snippet = src.snippet ? _cleanTrail(src.snippet) : '';

    return (
      '<a class="csi" href="' + _he(src.url) + '" target="_blank" rel="noopener">' +
        '<div class="csi-top">' +
          '<div class="csi-favicon-wrap">' +
            '<img class="csi-favicon" src="' + _he(favicon) + '" width="16" height="16" alt="" onerror="this.style.visibility=\'hidden\'">' +
          '</div>' +
          '<div class="csi-site">' +
            '<div class="csi-domain">' + _he(domain) + '</div>' +
            '<div class="csi-url">' + _he(_shortUrl(src.url)) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="csi-title">' + _he(title) + '</div>' +
        (snippet ? '<div class="csi-snippet">' + _he(snippet) + '</div>' : '') +
      '</a>'
    );
  }

  function openSheet(clickedUrl, chipSources) {
    const sources = ((chipSources && chipSources.length)
      ? chipSources
      : (window._atkynSources || [])).filter((s) => s && _isSafeUrl(s.url));

    if (!sources.length) return;

    const clickedSrc = sources.find((s) => s.url === clickedUrl) || sources[0];
    if (!clickedSrc) return;

    const sorted = [
      clickedSrc,
      ...sources.filter((s) => s.url !== clickedSrc.url)
    ];

    const list = document.getElementById('chipSheetList');
    if (!list) return;

    list.innerHTML = sorted.map((s) => _buildSheetItem(s)).join('');

    const cards = list.querySelectorAll('.csi');

    sorted.forEach(function (src, i) {
      const cardEl = cards[i];
      if (!cardEl) return;
      _fetchOg(src.url).then(function (img) {
        _injectOg(cardEl, img);
      });
    });

    sheet.classList.add('open');
  }

  function closeSheet() {
    sheet.classList.remove('open');
  }

  const backdrop = document.getElementById('chipSheetBackdrop');
  if (backdrop) {
    backdrop.addEventListener('click', closeSheet);
  }

  document.addEventListener('click', function (e) {
    const chip = e.target.closest('.source-chip[data-chip-url]');
    if (!chip) return;

    e.preventDefault();

    let chipSources = null;
    try {
      chipSources = JSON.parse(chip.dataset.chipSources || 'null');
    } catch (_) {}

    openSheet(chip.dataset.chipUrl, chipSources);
  });
})();
