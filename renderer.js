/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search [PRODUCTION-READY v2]
   Markdown + Math : marked.js + KaTeX
   Code highlight  : highlight.js
   [ZERO FALSE POSITIVES · PRICE-SAFE · NO CURSIVE BUGS]
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

/* ── Normalize newlines (SAFE — preserves all spaces) ── */
function _normalizeNewlines(str) {
  // Only collapse 3+ consecutive newlines into 2. Preserve ALL spaces/tabs.
  return str.replace(/\n{3,}/g, '\n\n');
}

/* ═══════════════════════════════════════════════════════════════
   PRICE PROTECTION — THE REAL FIX
   Problem: "$100 and another for $1,250.50" was being parsed as
   inline math $...$ by marked, making middle text italic/cursive.
   
   Solution: Replace $PRICE with placeholders that CANNOT form
   $...$ pairs, and run this BEFORE marked.parse().
═══════════════════════════════════════════════════════════════ */
const PRICE_PH = '\x01PRICE';  // Use SOH control char — never appears in normal text
const PRICE_PH_END = '\x01';

function _protectPrices(raw) {
  const placeholders = [];
  
  // Match $100, $1,000, $50.99, $1,250.50, $1,000,000.50
  // Handles trailing punctuation: $100. or $1,250.50,
  let text = raw.replace(
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?=[\s,;:.\)!?\]}]|$)/g,
    (match, price) => {
      const idx = placeholders.length;
      placeholders.push('$' + price);
      return PRICE_PH + idx + PRICE_PH_END;
    }
  );
  
  const restore = (str) => {
    let result = str;
    for (let i = 0; i < placeholders.length; i++) {
      const ph = PRICE_PH + i + PRICE_PH_END;
      // Use split/join instead of regex to avoid escaping issues
      result = result.split(ph).join(placeholders[i]);
    }
    return result;
  };
  
  return { text, restore };
}

/* ══════════════════════════════════════════════════════════════
   SMART MATH DETECTION — STRICT MODE
   Only render as math if it contains UNAMBIGUOUS math indicators.
   Rejects: plain words, plain numbers, mixed word+number without operators.
═══════════════════════════════════════════════════════════════ */
function _looksLikeMath(text) {
  const t = text.trim();
  if (!t) return false;
  
  // Hard rejects
  if (/^[a-zA-Z\s]+$/.test(t)) return false;           // pure words
  if (/^[\d,]+\.?\d*$/.test(t)) return false;           // pure numbers (with commas/decimals)
  if (t.length < 2) return false;                       // single char
  if (/^\d+\s+\w+\s+\d+$/.test(t)) return false;        // "100 and 200" pattern
  
  // Must contain at least ONE of these unambiguous math indicators:
  const mathIndicators = [
    /\\[a-zA-Z]+/,       // LaTeX commands: \frac, \sqrt, \alpha, \sum, etc.
    /[{}]/,              // Grouping braces (KaTeX uses these heavily)
    /[\^_]\s*[a-zA-Z0-9]/, // Superscript/subscript: x^2, a_b
    /\\[{}]/,            // Escaped braces
    /\d+\s*[+\-*/=]\s*\d+/, // "2 + 3" pattern
    /[+\-*/=]\s*[a-zA-Z]/,  // "= x" or "+ y" pattern
    /[a-zA-Z]\s*[+\-*/=]/,  // "x =" or "y +" pattern
  ];
  
  return mathIndicators.some(regex => regex.test(t));
}

/* ── Convert \[...\] to $$...$$ ONLY (never introduce $...$) ── */
function _convertLatexDelimiters(str) {
  // Convert block delimiters \[ ... \] → $$ ... $$
  str = str.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, '\n$$\n$1\n$$\n');
  // Leave \( ... \) as-is — our custom tokenizer handles it directly
  return str;
}

/* ── KaTeX rendering with strict validation ── */
const KATEX_OPTS = {
  throwOnError: false,
  errorColor: '#cc0000',
  trust: false,
  strict: false
};

function _renderMath(text, displayMode) {
  if (!_looksLikeMath(text)) {
    // NOT math — return original text safely escaped
    return _he(text);
  }
  
  try {
    return katex.renderToString(text, { ...KATEX_OPTS, displayMode });
  } catch (_) {
    // KaTeX failed — return original text, NOT an error span
    return _he(text);
  }
}

/* ═══════════════════════════════════════════════════════════════
   MARKED.JS KATEX EXTENSIONS — STRICT DELIMITERS ONLY
   Supports: $$...$$ (block) and \(...\) (inline)
   DOES NOT support $...$ — this is the root cause of cursive bugs.
═══════════════════════════════════════════════════════════════ */
function _katexExtensions() {
  // Block math: $$ ... $$
  const blockKatex = {
    name: 'blockKatex',
    level: 'block',
    start: (src) => {
      const m = src.match(/^\$\$/m);
      return m ? m.index : undefined;
    },
    tokenizer(src) {
      const m = /^\$\$([\s\S]+?)\$\$/.exec(src);
      if (m) {
        return { type: 'blockKatex', raw: m[0], text: m[1].trim() };
      }
    },
    renderer: (token) =>
      '<div class="math-display">' + _renderMath(token.text, true) + '</div>\n'
  };

  // Inline math: \( ... \) — NO $...$ SUPPORT
  const inlineKatex = {
    name: 'inlineKatex',
    level: 'inline',
    start: (src) => {
      const m = src.match(/\\\(/);
      return m ? m.index : undefined;
    },
    tokenizer(src) {
      const m = /^\\\(([\s\S]*?)\\\)/.exec(src);
      if (m) {
        return { type: 'inlineKatex', raw: m[0], text: m[1].trim() };
      }
    },
    renderer: (token) => _renderMath(token.text, false)
  };

  return { extensions: [blockKatex, inlineKatex] };
}

/* ── Build Marked ── */
function _buildMarked() {
  if (typeof marked.setOptions === 'function') {
    marked.setOptions({});
  }

  if (typeof katex !== 'undefined') {
    marked.use(_katexExtensions());
  } else if (typeof markedKatex === 'function') {
    marked.use(markedKatex(KATEX_OPTS));
  }

  const renderer = new marked.Renderer();

  /* Code blocks — compatible with old & new marked.js */
  renderer.code = function(tokenOrCode, lang) {
    const code = (tokenOrCode && typeof tokenOrCode === 'object')
      ? (tokenOrCode.text ?? tokenOrCode.code ?? '')
      : tokenOrCode;
    const language = (tokenOrCode && typeof tokenOrCode === 'object')
      ? (tokenOrCode.lang || '').trim().toLowerCase()
      : (lang || '').trim().toLowerCase();

    const id = 'cb' + Math.random().toString(36).slice(2, 8);
    let highlighted = _he(code);

    if (typeof hljs !== 'undefined') {
      const valid = language && hljs.getLanguage(language);
      const result = valid
        ? hljs.highlight(code, { language, ignoreIllegals: true })
        : hljs.highlightAuto(code);
      highlighted = result.value;
    }

    return (
      '<div class="code-block" id="' + id + '">' +
        '<button class="code-copy-btn" data-target="' + id + '" aria-label="Copy code">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
            '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
          '</svg>' +
        '</button>' +
        '<pre><code class="hljs' + (language ? ' language-' + language : '') + '">' + highlighted + '</code></pre>' +
      '</div>'
    );
  };

  renderer.table = function(header, body) {
    return (
      '<div class="table-wrap"><table>' +
        '<thead>' + header + '</thead>' +
        '<tbody>' + body + '</tbody>' +
      '</table></div>'
    );
  };

  renderer.hr = function() {
    return '<hr class="md-hr">\n';
  };

  marked.use({ renderer, breaks: true, gfm: true });
}

_buildMarked();

/* ═══════════════════════════════════════════════════════════════
   SAFE RENDER PIPELINE — ORDER MATTERS
   1. Protect prices (BEFORE marked sees $ signs)
   2. Normalize newlines
   3. Convert \[...\] → $$...$$
   4. Parse markdown + math
   5. Restore prices
═══════════════════════════════════════════════════════════════ */
function _safePipeline(raw, isStreaming = false) {
  if (!raw) return '';
  
  // STEP 1: Protect prices BEFORE anything else
  // This prevents "$100 ... $1,250.50" from being parsed as inline math
  const { text: protectedText, restore } = _protectPrices(raw);
  
  // STEP 2: Normalize newlines (preserves spaces)
  let text = _normalizeNewlines(protectedText);
  if (!text) return '';
  
  // STEP 3: Convert \[...\] → $$...$$ (never introduces $...$)
  text = _convertLatexDelimiters(text);
  
  // STEP 4: Parse markdown + math
  try {
    let html = marked.parse(text);
    
    // STEP 5: Restore prices
    return restore(html);
  } catch (e) {
    console.warn('Markdown parse error:', e);
    const fallback = '<pre class="render-fallback">' + _he(raw) + '</pre>';
    return restore(fallback);
  }
}

/* ── Universal renderer class ── */
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
    return (this.renderedContent = _safePipeline(content));
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
    this.rawContent = (this._buf += chunk);
    return (this.renderedContent = _safePipeline(this._buf, true));
  }

  finishStream() {
    this._streaming = false;
    return (this.renderedContent = _safePipeline(this._buf, false));
  }

  getHTML() { return this.renderedContent; }
  getRaw()  { return this.rawContent; }
}

/* ── Streaming renderer factory ── */
function createStreamingRenderer(onUpdate, debounceMs = 40) {
  const renderer = new UniversalMessageRenderer();
  renderer.startStream();
  let _timer = null, _done = false;

  function _flush(final) {
    clearTimeout(_timer);
    _timer = null;
    if (typeof onUpdate === 'function') {
      onUpdate(final ? renderer.finishStream() : renderer.getHTML(), { final });
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
    getRenderer() { return renderer; }
  };
}

/* ── Public API ── */
function universalRender(content) { return new UniversalMessageRenderer().render(content); }
function renderMarkdown(text)     { return universalRender(text); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { universalRender, renderMarkdown, createStreamingRenderer, UniversalMessageRenderer };
}
