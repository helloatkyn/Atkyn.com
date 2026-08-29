/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown + Math : marked.js + KaTeX
   Code highlight  : highlight.js
   [PRODUCTION-READY · KaTeX-SAFE · PRICE-PROTECTED · STREAMING-OPTIMIZED]
═══════════════════════════════════════════════════════════════ */

/* ── HTML entity escape ── */
function _he(s) {
  const src = String(s);
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if      (c === '&')  out.push('&amp;');
    else if (c === '<')  out.push('&lt;');
    else if (c === '>')  out.push('&gt;');
    else if (c === '"')  out.push('&quot;');
    else if (c === "'")  out.push('&#39;');
    else                 out.push(c);
  }
  return out.join('');
}

/* ── Cheap hash for render cache ── */
function _cheapHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h;
}

/* ── Normalize newlines ── */
function _normalizeNewlines(str) {
  let start = 0;
  while (start < str.length && str[start] === '\n') start++;
  let end = str.length - 1;
  while (end >= start && str[end] === '\n') end--;
  if (start > end) return '';
  const out = [];
  let i = start;
  while (i <= end) {
    if (str[i] !== '\n') { out.push(str[i]); i++; }
    else {
      let run = 0;
      while (i <= end && str[i] === '\n') { run++; i++; }
      out.push('\n');
      if (run > 1) out.push('\n');
    }
  }
  return out.join('');
}

/* ══════════════════════════════════════════════════════════════
   PRICE + INLINE-CODE PROTECTION
   Run before any LaTeX/markdown processing so dollar signs and
   backtick spans are never misread as math delimiters.
══════════════════════════════════════════════════════════════ */

const _PH_PRE  = '\x00PH';   // placeholder prefix
const _PH_SUF  = '\x00';     // placeholder suffix

function _protect(raw) {
  const slots = [];
  const _ph   = (val) => { const i = slots.length; slots.push(val); return _PH_PRE + i + _PH_SUF; };

  // 1. Inline code spans first (backtick content must never be touched)
  let text = raw.replace(/`+[\s\S]*?`+/g, _ph);

  // 2. Currency / price amounts: $5, $1,000, $49.99, $1,000,000.00
  //    Must NOT match things like $variable or $$
  text = text.replace(
    /(?<!\$)\$(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?!\d)/g,
    _ph
  );

  const restore = (str) =>
    str.replace(new RegExp(_PH_PRE + '(\\d+)' + _PH_SUF, 'g'),
      (_, i) => slots[+i]);

  return { text, restore };
}

/* ══════════════════════════════════════════════════════════════
   LaTeX DELIMITER NORMALISATION
   Only convert explicit LaTeX bracket / paren delimiters.
   Plain prose is not touched.
══════════════════════════════════════════════════════════════ */

function _convertLatexDelimiters(str) {
  // \[...\]  →  display math $$...$$
  str = str.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) =>
    '\n$$\n' + inner.trim() + '\n$$\n'
  );
  // \(...\)  →  inline math $...$
  str = str.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) =>
    '$' + inner.trim() + '$'
  );
  return str;
}

/* ══════════════════════════════════════════════════════════════
   MATH CONTENT VALIDATOR
   Called on the *content* inside $ ... $ or $$ ... $$
   Returns false → treat as plain text, not LaTeX.
══════════════════════════════════════════════════════════════ */

// Patterns that strongly indicate real LaTeX math
const _MATH_STRONG = [
  /\\[a-zA-Z]+/,            // any LaTeX command: \frac, \sum, \alpha …
  /\^[{0-9a-zA-Z]/,         // superscript: x^2, e^{x}
  /[_][{0-9a-zA-Z]/,        // subscript:   a_1, H_{2}
  /\{[^}]*\}/,              // brace groups: {x+1}
  /\\[(),[\]]/,             // \(, \[, etc. (nested)
  /[∑∏∫∂∇√±×÷≤≥≠≈→←]/,     // Unicode math symbols
];

// If the content matches these patterns → almost certainly NOT math
const _NOT_MATH = [
  /^[a-zA-Z]{4,}$/,                       // plain word: "hello"
  /^[a-zA-Z\s]{6,}$/,                     // plain phrase: "hello world"
  /^[A-Z][a-z]+(?:\s+[A-Za-z]+)*$/,       // sentence-case words
  /^https?:\/\//,                          // URLs
  /^[a-zA-Z0-9._%+\-]+@/,                 // email-like
];

function _looksLikeMath(text) {
  const t = text.trim();
  if (!t) return false;

  // Immediate reject: plain text patterns
  for (const re of _NOT_MATH) {
    if (re.test(t)) return false;
  }

  // Immediate accept: known LaTeX
  for (const re of _MATH_STRONG) {
    if (re.test(t)) return true;
  }

  // Heuristic: must contain at least one math operator or digit with operator
  // Single letters like $x$ are valid in real LaTeX context, but we require
  // at least an operator neighbour to avoid italicising random $words$.
  const hasMathOp = /[+\-*/=<>|^~]|(?:\d\s*[+\-*/=])/.test(t);
  const isSingleToken = /^[a-zA-Z0-9]+$/.test(t); // single identifier → risky

  if (isSingleToken && !hasMathOp) return false;  // e.g. $x$, $foo$ — reject
  return hasMathOp;
}

/* ══════════════════════════════════════════════════════════════
   KaTeX RENDER (safe wrapper)
══════════════════════════════════════════════════════════════ */

const KATEX_OPTS = {
  throwOnError : false,
  errorColor   : '#888888',
  trust        : false,
  strict       : false,
};

function _renderMath(text, displayMode) {
  if (!_looksLikeMath(text)) {
    // Return verbatim — never italicise / cursivify plain text
    return displayMode
      ? '<p>$$' + _he(text) + '$$</p>'
      : _he(text);                        // inline: just the original text
  }
  try {
    return katex.renderToString(text, { ...KATEX_OPTS, displayMode });
  } catch (_) {
    return displayMode
      ? '<p>$$' + _he(text) + '$$</p>'
      : '$' + _he(text) + '$';
  }
}

/* ══════════════════════════════════════════════════════════════
   STREAMING GUARD
   During streaming, incomplete $...  or $$... blocks at the
   very END of the buffer are held back to avoid partial renders.
══════════════════════════════════════════════════════════════ */

/**
 * Strips a potentially incomplete trailing math delimiter.
 * Returns { safe, held } where `held` goes back into the buffer.
 */
function _holdIncomplete(text) {
  // If last chars are an odd/unclosed $$ block
  const trailBlock = text.match(/((?:^|\n)\$\$(?![\s\S]*\$\$)[\s\S]*)$/);
  if (trailBlock) {
    const idx = text.lastIndexOf(trailBlock[0]);
    return { safe: text.slice(0, idx), held: trailBlock[0] };
  }
  // If last chars are an unclosed $ inline (not $$)
  // Only hold back if the $ appears in the last 120 chars (short enough to be inline)
  const tail = text.slice(-120);
  const inlineMatch = tail.match(/(?<!\$)\$(?!\$)(?:[^$\n\\]|\\.)*$/);
  if (inlineMatch) {
    const holdFrom = text.length - 120 + inlineMatch.index;
    return { safe: text.slice(0, holdFrom), held: text.slice(holdFrom) };
  }
  return { safe: text, held: '' };
}

/* ══════════════════════════════════════════════════════════════
   MARKED EXTENSIONS + RENDERER BUILD
══════════════════════════════════════════════════════════════ */

function _katexExtensions() {
  const blockKatex = {
    name      : 'blockKatex',
    level     : 'block',
    start     : src => { const i = src.indexOf('$$'); return i >= 0 ? i : undefined; },
    tokenizer(src) {
      // Must have opening AND closing $$
      const m = src.match(/^\$\$([\s\S]+?)\$\$/);
      if (m) return { type: 'blockKatex', raw: m[0], text: m[1].trim() };
    },
    renderer: token =>
      '<div class="math-display">' + _renderMath(token.text, true) + '</div>\n',
  };

  const inlineKatex = {
    name      : 'inlineKatex',
    level     : 'inline',
    start     : src => {
      // Skip $$ (block), only start on single $
      let i = src.indexOf('$');
      while (i >= 0 && src[i + 1] === '$') i = src.indexOf('$', i + 2);
      return i >= 0 ? i : undefined;
    },
    tokenizer(src) {
      // Single $ not followed by another $, not spanning newlines
      const m = src.match(/^\$(?!\$)((?:[^$\n\\]|\\.)+?)\$(?!\$)/);
      if (m) return { type: 'inlineKatex', raw: m[0], text: m[1].trim() };
    },
    renderer: token => _renderMath(token.text, false),
  };

  return { extensions: [blockKatex, inlineKatex] };
}

function _buildMarked() {
  if (typeof katex !== 'undefined') {
    marked.use(_katexExtensions());
  } else if (typeof markedKatex === 'function') {
    marked.use(markedKatex(KATEX_OPTS));
  }

  const renderer = new marked.Renderer();

  /* Code blocks */
  renderer.code = function(codeOrToken, lang) {
    let code, language;
    if (codeOrToken && typeof codeOrToken === 'object') {
      code     = codeOrToken.text ?? codeOrToken.code ?? '';
      language = (codeOrToken.lang || '').trim().toLowerCase();
    } else {
      code     = codeOrToken;
      language = (lang || '').trim().toLowerCase();
    }

    const id = 'cb' + Math.random().toString(36).slice(2, 8);
    let highlighted = _he(code);

    if (typeof hljs !== 'undefined') {
      const valid  = language && hljs.getLanguage(language);
      const result = valid
        ? hljs.highlight(code, { language, ignoreIllegals: true })
        : hljs.highlightAuto(code);
      highlighted = result.value;
    }

    return (
      '<div class="code-block" id="' + id + '">' +
        '<button class="code-copy-btn" data-target="' + id + '" aria-label="Copy">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"' +
          ' stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
            '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
          '</svg>' +
        '</button>' +
        '<pre><code class="hljs">' + highlighted + '</code></pre>' +
      '</div>'
    );
  };

  /* Tables */
  renderer.table = function(header, body) {
    return (
      '<div class="table-wrap"><table>' +
        '<thead>' + header + '</thead>' +
        '<tbody>' + body + '</tbody>' +
      '</table></div>'
    );
  };

  /* Horizontal rule */
  renderer.hr = function() { return '<hr class="md-hr">\n'; };

  marked.use({ renderer, breaks: true, gfm: true });
}

_buildMarked();

/* ══════════════════════════════════════════════════════════════
   SAFE RENDER PIPELINE
══════════════════════════════════════════════════════════════ */

function _safePipeline(raw, isStreaming = false) {
  if (!raw) return '';

  // 1. Protect inline code + currency before any mutation
  const { text: protected_, restore } = _protect(raw);

  // 2. Convert explicit LaTeX delimiters
  let text = _convertLatexDelimiters(protected_);

  // 3. Streaming guard: hold back dangling incomplete math
  let held = '';
  if (isStreaming) {
    const res = _holdIncomplete(text);
    text = res.safe;
    held = res.held;  // held stays in buffer, not rendered yet
    if (!text) return '';
  }

  // 4. Normalise newlines
  text = _normalizeNewlines(text);
  if (!text) return '';

  // 5. Render markdown + math
  let html;
  try {
    html = marked.parse(text);
  } catch (_) {
    html = '<pre class="render-fallback">' + _he(raw) + '</pre>';
  }

  // 6. Restore protected spans
  return restore(html);
}

/* ══════════════════════════════════════════════════════════════
   UniversalMessageRenderer CLASS
══════════════════════════════════════════════════════════════ */

class UniversalMessageRenderer {
  constructor() {
    this.rawContent      = '';
    this.renderedContent = '';
    this._hash           = null;
    this._buf            = '';     // accumulated streaming buffer
    this._held           = '';     // incomplete math held back during stream
    this._streaming      = false;
  }

  /* One-shot render (non-streaming) */
  render(content) {
    this.rawContent = content;
    const h = _cheapHash(content);
    if (h === this._hash && this.renderedContent) return this.renderedContent;
    this._hash = h;
    return (this.renderedContent = _safePipeline(content, false));
  }

  /* Streaming API */
  startStream() {
    this._buf            = '';
    this._held           = '';
    this._streaming      = true;
    this.rawContent      = '';
    this.renderedContent = '';
    this._hash           = null;
  }

  pushChunk(chunk) {
    if (!this._streaming) this.startStream();
    // Re-inject any previously held incomplete tail, then add new chunk
    this._buf       += chunk;
    this.rawContent  = this._buf;

    // Compute held-back tail for this frame
    const { safe, held } = _holdIncomplete(this._buf);
    this._held = held;

    this.renderedContent = _safePipeline(safe, true);
    return this.renderedContent;
  }

  finishStream() {
    this._streaming = false;
    // Flush everything including previously held tail
    this.renderedContent = _safePipeline(this._buf, false);
    return this.renderedContent;
  }

  getHTML() { return this.renderedContent; }
  getRaw()  { return this.rawContent; }
}

/* ══════════════════════════════════════════════════════════════
   STREAMING FACTORY
══════════════════════════════════════════════════════════════ */

function createStreamingRenderer(onUpdate, debounceMs = 40) {
  const renderer = new UniversalMessageRenderer();
  renderer.startStream();
  let _timer = null;
  let _done  = false;

  function _flush(final) {
    clearTimeout(_timer);
    _timer = null;
    if (typeof onUpdate === 'function') {
      onUpdate(
        final ? renderer.finishStream() : renderer.getHTML(),
        { final }
      );
    }
  }

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
    getRenderer() { return renderer; },
  };
}

/* ── Public API ── */
function universalRender(content) { return new UniversalMessageRenderer().render(content); }
function renderMarkdown(text)     { return universalRender(text); }
   
