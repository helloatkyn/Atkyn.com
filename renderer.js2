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
UniversalMessageRenderer
══════════════════════════════════════════════════════════════ */
class UniversalMessageRenderer {
  constructor() {
    this.rawContent = '';
    this.renderedContent = '';
    this._hash = null;
    this._buf = '';
    this._streaming = false;
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
    return this.renderedContent;
  }

  finishStream() {
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

function buildChip(src, allSources) {
  if (!src || !src.url) return '';

  let domain = '';
  try {
    domain = new URL(src.url).hostname.replace(/^www\./, '');
  } catch (_) {
    domain = src.url;
  }

  const domainRoot = domain.split('.')[0];
  const siteName = domainRoot.charAt(0).toUpperCase() + domainRoot.slice(1);
  const label = siteName.length > 22 ? siteName.slice(0, 20) + '\u2026' : siteName;

  const chipId = 'chip' + (++_chipCounter);
  _chipRegistry[chipId] = src;

  const faviconUrl = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=64';
  const sourcesSnap = _he(JSON.stringify(allSources || []));

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

/* ──────────────────────────────────────────────────────────────
AUTOMATIC CITATION ATTRIBUTION (claim → existing source)

Supplements explicit [n] markers; never replaces them.
Deterministic and offline: each finished sentence is matched against the
title + snippet of the EXISTING source objects (the same text the model
was given). No new fetch, no new LLM call, no new source schema.

Prefix-stable: the decision for a sentence depends only on that sentence
and the sentences before it in the same block, so re-rendering a growing
streamed answer from fresh HTML never flickers or duplicates chips.

Uncertain → no citation. Chips are only built through buildChip().
────────────────────────────────────────────────────────────── */
const _AUTO_CITE = {
  MIN_SENTENCE_TOKENS: 4,   /* ignore short / filler sentences */
  MIN_MATCHED: 3,           /* distinct content words shared with the source */
  MIN_COVERAGE: 0.45        /* share of the sentence's content words found in the source */
};

const _AUTO_STOPWORDS = new Set((
  'about above after again all also and any are because been before being between both but can could did does doing ' +
  'down during each few for from further had has have having her here hers him his how into its itself just more most ' +
  'nor not now off once only other our out over own same she should some such than that the their them then there ' +
  'these they this those through under until very was were what when where which while who whom why will with would ' +
  'you your yours'
).split(/\s+/));

const _AUTO_ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'inc', 'ltd', 'co', 'corp', 'no', 'fig', 'approx'
]);

const _AUTO_VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'
]);

const _AUTO_BLOCK = new Set([
  'p', 'li', 'ul', 'ol', 'div', 'blockquote', 'br', 'hr', 'pre', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
]);

const _AUTO_SKIP_TAGS = new Set([
  'pre', 'code', 'a', 'button', 'script', 'style', 'svg', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
]);

const _AUTO_SKIP_CLASS = /(?:^|\s)(?:math-display|katex[\w-]*|code-block|chip-group|source-chip|render-fallback)(?:\s|$)/;

function _autoPlain(s) {
  return String(s).replace(/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, ' ');
}

function _autoTokens(text) {
  const out = new Set();
  const words = String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

  for (let w of words) {
    if (/^\d+$/.test(w)) {
      if (w.length >= 2) out.add(w);
      continue;
    }
    if (w.length < 3 || _AUTO_STOPWORDS.has(w)) continue;
    if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    out.add(w);
  }

  return out;
}

/* Token sets aligned 1:1 with the sources array (null = not citable). */
function _autoSourceTokens(sources) {
  return sources.map(function (s) {
    if (!s || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) return null;
    const title = s.title && s.title !== 'Untitled' ? s.title : '';
    const snippet = s.snippet && s.snippet !== 'No snippet available.' ? s.snippet : '';
    const tokens = _autoTokens(title + ' ' + snippet);
    return tokens.size ? tokens : null;
  });
}

/* Returns the 0-based index of the best-supporting source, or -1. */
function _autoPickSource(sentence, srcTokens) {
  const toks = _autoTokens(sentence);
  if (toks.size < _AUTO_CITE.MIN_SENTENCE_TOKENS) return -1;

  const nums = [];
  toks.forEach(function (t) {
    if (/^\d+$/.test(t)) nums.push(t);
  });

  let best = -1;
  let bestCoverage = 0;

  for (let i = 0; i < srcTokens.length; i++) {
    const st = srcTokens[i];
    if (!st) continue;

    /* A source that lacks a number the sentence asserts cannot support it. */
    let numsOk = true;
    for (let n = 0; n < nums.length; n++) {
      if (!st.has(nums[n])) { numsOk = false; break; }
    }
    if (!numsOk) continue;

    let matched = 0;
    toks.forEach(function (t) {
      if (st.has(t)) matched++;
    });

    if (matched < _AUTO_CITE.MIN_MATCHED) continue;

    const coverage = matched / toks.size;
    if (coverage < _AUTO_CITE.MIN_COVERAGE) continue;

    if (coverage > bestCoverage) {
      bestCoverage = coverage;
      best = i;
    }
  }

  return best;
}

function _autoIsAbbrev(sentenceSoFar) {
  const m = /([\p{L}\p{N}.]+)$/u.exec(sentenceSoFar);
  if (!m) return false;
  const w = m[1].toLowerCase();
  return _AUTO_ABBREV.has(w) || /^(?:\p{L}\.)*\p{L}$/u.test(w);
}

/* Walks rendered HTML; inserts a chip before the closing punctuation of
   each sentence that a source supports. Never touches code, math, links,
   headings, existing chips, or sentences that already carry [n] markers. */
function _autoAttributeCitations(html, sources) {
  const srcTokens = _autoSourceTokens(sources);
  if (!srcTokens.some(Boolean)) return html;

  const parts = html.split(/(<[^>]*>)/);
  const out = [];

  let skipName = '';
  let skipDepth = 0;
  let buf = '';
  let cited = false;
  let lastSrc = -1;

  const resetBlock = function () {
    buf = '';
    cited = false;
    lastSrc = -1;
  };

  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    if (!part) continue;

    /* ── tag ── */
    if (part.charAt(0) === '<') {
      out.push(part);

      const close = /^<\/\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(part);
      const open = close ? null : /^<\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(part);
      if (!close && !open) continue;

      const name = (close ? close[1] : open[1]).toLowerCase();
      const selfClosing = /\/\s*>$/.test(part);

      if (skipDepth > 0) {
        if (name === skipName && !_AUTO_VOID.has(name)) {
          if (close) skipDepth--;
          else if (!selfClosing) skipDepth++;
        }
        continue;
      }

      if (open && !_AUTO_VOID.has(name) && !selfClosing) {
        const clsMatch = /class\s*=\s*["']([^"']*)["']/i.exec(part);
        const cls = clsMatch ? clsMatch[1] : '';

        if (_AUTO_SKIP_TAGS.has(name) || _AUTO_SKIP_CLASS.test(cls)) {
          if (_AUTO_BLOCK.has(name)) resetBlock();
          skipName = name;
          skipDepth = 1;
          if (/(?:^|\s)(?:chip-group|source-chip)(?:\s|$)/.test(cls)) cited = true;
          continue;
        }
      }

      if (_AUTO_BLOCK.has(name)) resetBlock();
      continue;
    }

    /* ── text ── */
    if (skipDepth > 0) {
      out.push(part);
      continue;
    }

    let piece = '';
    let emitted = 0;
    let bufStart = 0;
    const re = /[.!?](?=\s|$)/g;
    let m;

    while ((m = re.exec(part)) !== null) {
      const p = m.index;
      const sentence = buf + _autoPlain(part.slice(bufStart, p));

      if (part.charAt(p) === '.' && _autoIsAbbrev(sentence)) continue;

      let insert = '';
      let attributed = -1;

      if (part.charAt(p) !== '?' && !cited && !/\[\d+\]/.test(sentence)) {
        const idx = _autoPickSource(sentence, srcTokens);

        if (idx >= 0) {
          attributed = idx;

          /* Same source as the sentence just before it → that chip already covers this run. */
          if (idx !== lastSrc) {
            const chip = buildChip(sources[idx], sources);
            if (chip) {
              const before = part.slice(emitted, p);
              const needsSpace = !(before.length && /\s$/.test(before));
              insert = (needsSpace ? ' ' : '') + '<span class="chip-group">' + chip + '</span>';
            }
          }
        }
      }

      piece += part.slice(emitted, p) + insert;
      emitted = p;
      bufStart = p + 1;
      buf = '';
      cited = false;
      lastSrc = attributed;
    }

    buf += _autoPlain(part.slice(bufStart));
    piece += part.slice(emitted);
    out.push(piece);
  }

  return out.join('');
}

function injectCitationChips(html, sources) {
  if (!html || !sources || !sources.length) return html;

  /* 1) Existing explicit [n] markers — unchanged behavior. */
  const withExplicit = html.replace(/((?:\[\d+\])+)([.,;:!?])/g, function (_, refs, punct) {
    const nums = [];
    const re = /\[(\d+)\]/g;
    let m;

    while ((m = re.exec(refs)) !== null) {
      nums.push(parseInt(m[1], 10));
    }

    const unique = [...new Set(nums)];
    let inner = '';

    const src = sources[unique[0] - 1];
    if (src) inner = buildChip(src, sources);

    return inner
      ? '<span class="chip-group">' + inner + '</span>' + punct
      : refs + punct;
  });

  /* 2) Automatic attribution for supported sentences that carry no marker. */
  try {
    return _autoAttributeCitations(withExplicit, sources);
  } catch (_) {
    return withExplicit;
  }
}

window.injectCitationChips = injectCitationChips;

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
    const sources = (chipSources && chipSources.length)
      ? chipSources
      : (window._atkynSources || []);

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
