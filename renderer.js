/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   marked@13 + KaTeX (CDN)

   MATH POLICY:
   • $price   → plain text, never math  (price protection)
   • $...$    → NEVER math              (disabled — too many false positives)
   • $$...$$  → display math            (marked block extension)
   • \[...\]  → display math            (marked block extension)
   • \(...\)  → inline math             (marked inline extension)
═══════════════════════════════════════════════════════════════ */

/* ── HTML entity escape ── */
function _he(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
   Protect BEFORE marked sees the text — $ never reaches KaTeX.
══════════════════════════════════════════════════════════════ */
const _PH_PRE = '\x00PH', _PH_SUF = '\x00';

function _protect(raw) {
  const slots = [];
  const ph = v => { const i = slots.length; slots.push(v); return _PH_PRE + i + _PH_SUF; };

  let t = raw;
  t = t.replace(/```[\s\S]*?```/g, ph);          // fenced code blocks
  t = t.replace(/`[^`\n]+`/g, ph);               // inline code
  // Currency $5  $1,000  $49.99 — skip $$ (math opener)
  t = t.replace(
    /(?<!\$)\$(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?!\d)/g,
    ph
  );

  const restore = s =>
    s.replace(new RegExp(_PH_PRE + '(\\d+)' + _PH_SUF, 'g'), (_, i) => slots[+i]);
  return { text: t, restore };
}

/* ══════════════════════════════════════════════════════════════
   KaTeX helper
══════════════════════════════════════════════════════════════ */
function _katex(tex, display) {
  if (typeof katex === 'undefined')
    return display ? '$$' + _he(tex) + '$$' : '\\(' + _he(tex) + '\\)';
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: false });
  } catch (_) {
    return display ? '$$' + _he(tex) + '$$' : '\\(' + _he(tex) + '\\)';
  }
}

/* ══════════════════════════════════════════════════════════════
   MARKED EXTENSIONS
   All three math delimiters handled here — no post-render pass needed.
   marked-katex-extension CDN plugin is NOT used.
══════════════════════════════════════════════════════════════ */
function _buildMarked() {

  /* ── Block: $$...$$ ── */
  const extBlockDollar = {
    name: 'blockDollar', level: 'block',
    start: src => src.indexOf('$$'),
    tokenizer(src) {
      const m = src.match(/^\$\$([\s\S]+?)\$\$/);
      if (m) return { type: 'blockDollar', raw: m[0], tex: m[1].trim() };
    },
    renderer: t => '<div class="math-display">' + _katex(t.tex, true) + '</div>\n',
  };

  /* ── Block: \[...\] ── */
  const extBlockBracket = {
    name: 'blockBracket', level: 'block',
    start: src => src.indexOf('\\['),
    tokenizer(src) {
      const m = src.match(/^\\\[([\s\S]+?)\\\]/);
      if (m) return { type: 'blockBracket', raw: m[0], tex: m[1].trim() };
    },
    renderer: t => '<div class="math-display">' + _katex(t.tex, true) + '</div>\n',
  };

  /* ── Inline: \(...\) ── */
  const extInlineParen = {
    name: 'inlineParen', level: 'inline',
    start: src => src.indexOf('\\('),
    tokenizer(src) {
      const m = src.match(/^\\\(([\s\S]+?)\\\)/);
      if (m) return { type: 'inlineParen', raw: m[0], tex: m[1].trim() };
    },
    renderer: t => _katex(t.tex, false),
  };

  marked.use({ extensions: [extBlockDollar, extBlockBracket, extInlineParen] });

  /* ── Custom renderer (code, table, hr) ── */
  const renderer = new marked.Renderer();

  renderer.code = function (token) {
    // Handle both new marked v13+ (object) and old versions (string)
    let code, language;
    
    if (token && typeof token === 'object') {
      // marked v13+ passes token object
      code = token.text || token.code || '';
      language = (token.lang || '').trim().toLowerCase();
    } else {
      // Old version passes string directly
      code = token || '';
      language = (language || '').trim().toLowerCase();
    }

    const id = 'cb' + Math.random().toString(36).slice(2, 8);
    const hi = _he(code);

    return (
      '<div class="code-block" id="' + id + '">' +
        '<button class="code-copy-btn" data-target="' + id + '" aria-label="Copy">' +
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

  renderer.table = (h, b) =>
    '<div class="table-wrap"><table><thead>' + h + '</thead><tbody>' + b + '</tbody></table></div>';

  renderer.hr = () => '<hr class="md-hr">\n';

  marked.use({ renderer, breaks: true, gfm: true });
}

_buildMarked();

/* ══════════════════════════════════════════════════════════════
   STREAMING GUARD — hold back unclosed $$ or \[ at buffer tail
══════════════════════════════════════════════════════════════ */
function _holdIncomplete(text) {
  // Unclosed fenced code block — ``` without a closing ```
  const m0 = text.match(/((?:^|\n)```[\s\S]*)$/);
  if (m0 && !m0[1].slice(3).includes('```'))
    return { safe: text.slice(0, text.lastIndexOf(m0[0])), held: m0[0] };
  // Unclosed $$
  const m1 = text.match(/((?:^|\n)\$\$(?![\s\S]*?\$\$)[\s\S]*)$/);
  if (m1) return { safe: text.slice(0, text.lastIndexOf(m1[0])), held: m1[0] };
  // Unclosed \[
  const m2 = text.match(/(\\\[(?![\s\S]*?\\\])[\s\S]*)$/);
  if (m2) return { safe: text.slice(0, text.lastIndexOf(m2[0])), held: m2[0] };
  // Unclosed \(
  const m3 = text.match(/(\\\((?![\s\S]*?\\\))[\s\S]{0,300})$/);
  if (m3) return { safe: text.slice(0, text.lastIndexOf(m3[0])), held: m3[0] };
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
