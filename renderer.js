/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   marked@13 + KaTeX auto-render + highlight.js  (all CDN)

   MATH POLICY:
   • $...$ single-dollar  → NEVER rendered as math (price/variable safe)
   • $$...$$              → display math  (our custom marked extension)
   • \[...\]              → display math  (KaTeX auto-render post-pass)
   • \(...\)              → inline math   (KaTeX auto-render post-pass)
   • marked-katex-extension CDN plugin is NOT used (no singleDollar toggle)
═══════════════════════════════════════════════════════════════ */

/* ── HTML entity escape ── */
function _he(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Cheap hash ── */
function _cheapHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
  return h;
}

/* ── Normalize newlines ── */
function _normalizeNewlines(str) {
  let s = 0; while (s < str.length && str[s] === '\n') s++;
  let e = str.length - 1; while (e >= s && str[e] === '\n') e--;
  if (s > e) return '';
  const out = []; let i = s;
  while (i <= e) {
    if (str[i] !== '\n') { out.push(str[i++]); }
    else {
      let run = 0; while (i <= e && str[i] === '\n') { run++; i++; }
      out.push('\n'); if (run > 1) out.push('\n');
    }
  }
  return out.join('');
}

/* ══════════════════════════════════════════════════════════════
   PRICE + CODE PROTECTION
   Runs before marked — $ signs never reach any math parser.
══════════════════════════════════════════════════════════════ */
const _PH_PRE = '\x00PH', _PH_SUF = '\x00';

function _protect(raw) {
  const slots = [];
  const ph = v => { const i = slots.length; slots.push(v); return _PH_PRE + i + _PH_SUF; };

  // 1. Fenced code blocks
  let t = raw.replace(/```[\s\S]*?```/g, ph);
  // 2. Inline code
  t = t.replace(/`[^`\n]+`/g, ph);
  // 3. Currency: $5  $1,000  $49.99 — NOT $$ (display math)
  t = t.replace(
    /(?<!\$)\$(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?!\d)/g,
    ph
  );

  const restore = s => s.replace(new RegExp(_PH_PRE + '(\\d+)' + _PH_SUF, 'g'), (_, i) => slots[+i]);
  return { text: t, restore };
}

/* ══════════════════════════════════════════════════════════════
   MARKED SETUP
   • We register ONE extension: $$ block math only.
   • marked-katex-extension CDN plugin is intentionally skipped.
   • \(...\) and \[...\] are handled by KaTeX auto-render AFTER
     marked produces HTML (see _postRenderMath).
══════════════════════════════════════════════════════════════ */
function _buildMarked() {
  // Display-math-only extension: $$ ... $$ (block level)
  // Single $ is NOT intercepted — ever.
  const blockMath = {
    name: 'blockMath',
    level: 'block',
    start: src => src.indexOf('$$'),
    tokenizer(src) {
      const m = src.match(/^\$\$([\s\S]+?)\$\$/);
      if (m) return { type: 'blockMath', raw: m[0], text: m[1].trim() };
    },
    renderer(token) {
      if (typeof katex === 'undefined') {
        return '<div class="math-display">$$' + _he(token.text) + '$$</div>\n';
      }
      try {
        return '<div class="math-display">' +
          katex.renderToString(token.text, { displayMode: true, throwOnError: false }) +
          '</div>\n';
      } catch (_) {
        return '<div class="math-display">$$' + _he(token.text) + '$$</div>\n';
      }
    },
  };

  marked.use({ extensions: [blockMath] });

  const renderer = new marked.Renderer();

  renderer.code = function (codeOrToken, lang) {
    let code, language;
    if (codeOrToken && typeof codeOrToken === 'object') {
      code = codeOrToken.text ?? codeOrToken.code ?? '';
      language = (codeOrToken.lang || '').trim().toLowerCase();
    } else {
      code = codeOrToken; language = (lang || '').trim().toLowerCase();
    }
    const id = 'cb' + Math.random().toString(36).slice(2, 8);
    let hi = _he(code);
    if (typeof hljs !== 'undefined') {
      const valid = language && hljs.getLanguage(language);
      hi = (valid ? hljs.highlight(code, { language, ignoreIllegals: true }) : hljs.highlightAuto(code)).value;
    }
    return (
      '<div class="code-block" id="' + id + '">' +
        '<button class="code-copy-btn" data-target="' + id + '" aria-label="Copy">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
            '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
          '</svg>' +
        '</button>' +
        '<pre><code class="hljs">' + hi + '</code></pre>' +
      '</div>'
    );
  };

  renderer.table = (header, body) =>
    '<div class="table-wrap"><table><thead>' + header + '</thead><tbody>' + body + '</tbody></table></div>';

  renderer.hr = () => '<hr class="md-hr">\n';

  marked.use({ renderer, breaks: true, gfm: true });
}

_buildMarked();

/* ══════════════════════════════════════════════════════════════
   POST-RENDER MATH  (\[...\] and \(...\) via KaTeX auto-render)
   Called on the container DOM element after innerHTML is set.
══════════════════════════════════════════════════════════════ */
function _postRenderMath(el) {
  if (!el || typeof renderMathInElement === 'undefined') return;
  renderMathInElement(el, {
    delimiters: [
      { left: '\\[', right: '\\]', display: true  },
      { left: '\\(', right: '\\)', display: false },
    ],
    throwOnError: false,
  });
}

/* ══════════════════════════════════════════════════════════════
   STREAMING GUARD — hold back unclosed $$ at buffer tail
══════════════════════════════════════════════════════════════ */
function _holdIncomplete(text) {
  const m = text.match(/((?:^|\n)\$\$(?![\s\S]*?\$\$)[\s\S]*)$/);
  if (m) { const idx = text.lastIndexOf(m[0]); return { safe: text.slice(0, idx), held: m[0] }; }
  return { safe: text, held: '' };
}

/* ══════════════════════════════════════════════════════════════
   PIPELINE
══════════════════════════════════════════════════════════════ */
function _safePipeline(raw, isStreaming = false) {
  if (!raw) return '';
  const { text, restore } = _protect(raw);
  let src = isStreaming ? _holdIncomplete(text).safe : text;
  src = _normalizeNewlines(src);
  if (!src) return '';
  let html;
  try { html = marked.parse(src); }
  catch (_) { html = '<pre class="render-fallback">' + _he(raw) + '</pre>'; }
  return restore(html);
}

/* ══════════════════════════════════════════════════════════════
   UniversalMessageRenderer
══════════════════════════════════════════════════════════════ */
class UniversalMessageRenderer {
  constructor() {
    this.rawContent = ''; this.renderedContent = '';
    this._hash = null; this._buf = ''; this._streaming = false;
  }
  render(content) {
    this.rawContent = content;
    const h = _cheapHash(content);
    if (h === this._hash && this.renderedContent) return this.renderedContent;
    this._hash = h;
    return (this.renderedContent = _safePipeline(content, false));
  }
  startStream() {
    this._buf = ''; this._streaming = true;
    this.rawContent = ''; this.renderedContent = ''; this._hash = null;
  }
  pushChunk(chunk) {
    if (!this._streaming) this.startStream();
    this._buf += chunk; this.rawContent = this._buf;
    this.renderedContent = _safePipeline(_holdIncomplete(this._buf).safe, true);
    return this.renderedContent;
  }
  finishStream() {
    this._streaming = false;
    return (this.renderedContent = _safePipeline(this._buf, false));
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
  let _timer = null, _done = false;
  const _flush = final => {
    clearTimeout(_timer); _timer = null;
    if (typeof onUpdate === 'function')
      onUpdate(final ? renderer.finishStream() : renderer.getHTML(), { final });
  };
  return {
    push(chunk) {
      if (_done) return;
      renderer.pushChunk(chunk);
      clearTimeout(_timer);
      _timer = setTimeout(() => _flush(false), debounceMs);
    },
    finish() {
      if (_done) return; _done = true;
      clearTimeout(_timer); _flush(true);
    },
    getRenderer() { return renderer; },
  };
}

/* ── Public API ── */
function universalRender(content) { return new UniversalMessageRenderer().render(content); }
function renderMarkdown(text)     { return universalRender(text); }
   
