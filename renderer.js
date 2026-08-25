/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown + Math : marked.js + KaTeX
   Code highlight  : highlight.js
   [KATeX-SAFE · PRICE-PROTECTED · STREAMING-OPTIMIZED]
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

/* ── Price pattern protection (CRITICAL FIX) ── */
const PRICE_PH_PREFIX = '\x00PRICE_';
const PRICE_PH_SUFFIX = '\x00';

function _protectAndRestore(raw) {
  const placeholders = [];
  
  // Protect: $100, $1,000, $50.99, $1,000,000.50
  let text = raw.replace(
    /\$(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g,
    (match) => {
      const idx = placeholders.length;
      placeholders.push(match);
      return PRICE_PH_PREFIX + idx + PRICE_PH_SUFFIX;
    }
  );
  
  const restore = (str) => str.replace(
    new RegExp(PRICE_PH_PREFIX + '(\\d+)' + PRICE_PH_SUFFIX, 'g'),
    (_, idx) => placeholders[parseInt(idx, 10)]
  );
  
  return { text, restore };
}

/* ── Smart math detection (prevents false positives) ── */
function _looksLikeMath(text) {
  // Reject plain text with only letters/numbers/spaces
  if (/^\s*[a-zA-Z0-9\s,.'"]+\s*$/.test(text)) return false;
  
  // Accept if contains math indicators
  const mathPatterns = [
    /[+\-*/=^_]/,        // operators
    /\\[a-zA-Z]+/,       // LaTeX commands (\frac, \sqrt, etc.)
    /[{}]/,              // braces (grouping)
    /\d+\s*[+\-*/=]/,    // numbers with operators
    /[+\-*/=]\s*\d+/,    // operators with numbers
  ];
  
  return mathPatterns.some(regex => regex.test(text));
}

/* ── \[...\] → $$...$$ and \(...\) → $...$ ── */
function _convertLatexDelimiters(str) {
  str = str.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) =>
    '\n$$\n' + inner.trim() + '\n$$\n'
  );
  str = str.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) =>
    '$' + inner.trim() + '$'
  );
  return str;
}

/* ── KaTeX with smart validation ── */
const KATEX_OPTS = {
  throwOnError: false,
  errorColor: '#888888',
  trust: false,
  strict: false
};

function _renderMath(text, displayMode) {
  // Smart validation: only render if it looks like math
  if (!_looksLikeMath(text)) {
    // Graceful fallback: return original text
    return displayMode ? '$$' + _he(text) + '$$' : '$' + _he(text) + '$';
  }
  
  try {
    return katex.renderToString(text, { ...KATEX_OPTS, displayMode });
  } catch (_) {
    // Graceful fallback: return original text, NOT error span
    return displayMode ? '$$' + _he(text) + '$$' : '$' + _he(text) + '$';
  }
}

function _katexExtensions() {
  const blockKatex = {
    name: 'blockKatex', level: 'block',
    start: src => { const i = src.indexOf('$$'); return i >= 0 ? i : undefined; },
    tokenizer(src) {
      const m = src.match(/^\$\$([\s\S]+?)\$\$/);
      if (m) return { type: 'blockKatex', raw: m[0], text: m[1].trim() };
    },
    renderer: token =>
      '<div class="math-display">' + _renderMath(token.text, true) + '</div>\n'
  };

  const inlineKatex = {
    name: 'inlineKatex', level: 'inline',
    start: src => { const i = src.indexOf('$'); return i >= 0 ? i : undefined; },
    tokenizer(src) {
      const m = src.match(/^\$(?!\$)((?:[^$\n\\]|\\.)+?)\$(?!\$)/);
      if (m) return { type: 'inlineKatex', raw: m[0], text: m[1].trim() };
    },
    renderer: token => _renderMath(token.text, false)
  };

  return { extensions: [blockKatex, inlineKatex] };
}

/* ── Build marked ── */
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
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
            '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
          '</svg>' +
        '</button>' +
        '<pre><code class="hljs">' + highlighted + '</code></pre>' +
      '</div>'
    );
  };

  /* Tables — wrapped for horizontal scroll */
  renderer.table = function(header, body) {
    return (
      '<div class="table-wrap"><table>' +
        '<thead>' + header + '</thead>' +
        '<tbody>' + body + '</tbody>' +
      '</table></div>'
    );
  };

  marked.use({ renderer, breaks: true, gfm: true });
}

_buildMarked();

/* ── Safe render pipeline with price protection ── */
function _safePipeline(raw, isStreaming = false) {
  if (!raw) return '';
  
  // Step 1: Protect prices before any processing
  const { text: protectedText, restore } = _protectAndRestore(raw);
  
  // Step 2: Normalize and convert delimiters
  let text = _normalizeNewlines(_convertLatexDelimiters(protectedText));
  if (!text) return '';
  
  // Step 3: Render markdown + math
  try {
    let html = marked.parse(text);
    // Step 4: Restore prices after rendering
    return restore(html);
  } catch (_) {
    // Fallback with price restoration
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
    if (typeof onUpdate === 'function')
      onUpdate(final ? renderer.finishStream() : renderer.getHTML(), { final });
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
