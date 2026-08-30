/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   marked@13 + V1 syntaxHighlight (custom tokenizer, no hljs)

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

/* ── Lightweight escape for pre/code content ── */
function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
   V1 SYNTAX HIGHLIGHTER — custom tokenizer, zero CDN dependency
══════════════════════════════════════════════════════════════ */
const _RX = {
  jsKw:        /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|super|import|export|default|from|async|await|try|catch|finally|throw|yield|static|get|set|this)\b/g,
  dartKw:      /\b(void|final|late|required|abstract|implements|mixin|with|extension|typedef|enum|factory|operator|covariant|external|dynamic|const|var|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|import|export|async|await|try|catch|finally|throw|yield|static|get|set|this|in|is|as|null|true|false)\b/g,
  jsBool:      /\b(true|false|null|undefined|NaN|Infinity)\b/g,
  pyKw:        /\b(def|class|return|if|elif|else|for|while|in|not|and|or|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|global|nonlocal|del|assert|is|True|False|None)\b/g,
  dqStr:       /"(?:[^"\\]|\\.)*"/g,
  sqStr:       /'(?:[^'\\\n]|\\.){2,}'/g,
  btStr:       /`(?:[^`\\]|\\.)*`/g,
  lineComment: /\/\/.*/g,
  hashComment: /#.*/g,
  blockComment:/\/\*[\s\S]*?\*\//g,
  numLit:      /\b\d+(\.\d+)?\b/g,
  fnCall:      /\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()/g,
  clsName:     /\b([A-Z][a-zA-Z0-9_]*)\b/g,
  propKey:     /([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*:)/g,
};

function _resetRx() {
  for (const r of Object.values(_RX)) r.lastIndex = 0;
}

function _tokenizeLine(line, lang) {
  _resetRx();

  const ph      = [];
  const protect = html => { ph.push(html); return `\x01${ph.length - 1}\x01`; };
  const span    = (cls, text) => protect(`<span class="${cls}">${_esc(text)}</span>`);

  let s = line;

  s = s.replace(_RX.blockComment, m => span('tk-cmt', m));

  const hashLangs = ['python', 'py', 'bash', 'sh', 'yaml', 'yml', 'ruby', 'rb', 'r'];
  if (hashLangs.includes(lang)) {
    s = s.replace(_RX.hashComment, m => span('tk-cmt', m));
  } else {
    s = s.replace(_RX.lineComment, m => span('tk-cmt', m));
  }

  s = s.replace(_RX.btStr,  m => span('tk-str', m));
  s = s.replace(_RX.dqStr,  m => span('tk-str', m));
  s = s.replace(_RX.sqStr,  m => span('tk-str', m));

  s = _esc(s);

  s = s.replace(_RX.numLit,  m => protect(`<span class="tk-num">${m}</span>`));
  s = s.replace(_RX.clsName, (_, p) => protect(`<span class="tk-cls">${p}</span>`));
  s = s.replace(_RX.fnCall,  (_, p) => protect(`<span class="tk-fn">${p}</span>`));

  if (lang === 'python' || lang === 'py') {
    s = s.replace(_RX.pyKw,   m => protect(`<span class="tk-kw">${m}</span>`));
  } else if (lang === 'dart') {
    s = s.replace(_RX.dartKw, m => protect(`<span class="tk-kw">${m}</span>`));
  } else {
    s = s.replace(_RX.jsKw,   m => protect(`<span class="tk-kw">${m}</span>`));
  }

  s = s.replace(_RX.jsBool,  m => protect(`<span class="tk-bool">${m}</span>`));
  s = s.replace(_RX.propKey, (_, p) => protect(`<span class="tk-prop">${p}</span>`));

  s = s.replace(/\x01(\d+)\x01/g, (_, i) => ph[+i]);

  return s || ' ';
}

function syntaxHighlight(code, lang) {
  if (!code) return '<div class="code-lines"></div>';
  const l     = (lang || '').toLowerCase();
  const lines = code.split('\n');
  let out     = '';

  for (let i = 0; i < lines.length; i++) {
    const content = _tokenizeLine(lines[i], l);
    out += `<div class="code-line"><span class="code-line-num">${i + 1}</span><span class="code-line-content">${content}</span></div>`;
  }

  return `<div class="code-lines">${out}</div>`;
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

  /* ── Custom renderer ── */
  const renderer = new marked.Renderer();

  /* ── Code block — V1 structure + custom syntaxHighlight ── */
  renderer.code = function (codeOrToken, lang) {
    let code, language;
    if (codeOrToken && typeof codeOrToken === 'object') {
      code     = codeOrToken.text ?? codeOrToken.code ?? '';
      language = (codeOrToken.lang || '').trim().toLowerCase();
    } else {
      code     = codeOrToken;
      language = (lang || '').trim().toLowerCase();
    }

    const id          = 'cb' + Math.random().toString(36).slice(2, 8);
    const langLabel   = language || 'code';
    const highlighted = syntaxHighlight(code, language);

    return (
      '<div class="code-block" id="' + id + '">' +
        '<div class="code-block-header">' +
          '<span class="code-block-lang">' + _he(langLabel) + '</span>' +
          '<button class="code-copy-btn" data-target="' + id + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
              '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
              '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
            '</svg> Copy' +
          '</button>' +
        '</div>' +
        '<pre>' + highlighted + '</pre>' +
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
  const m1 = text.match(/((?:^|\n)\$\$(?![\s\S]*?\$\$)[\s\S]*)$/);
  if (m1) return { safe: text.slice(0, text.lastIndexOf(m1[0])), held: m1[0] };
  const m2 = text.match(/(\\\[(?![\s\S]*?\\\])[\s\S]*)$/);
  if (m2) return { safe: text.slice(0, text.lastIndexOf(m2[0])), held: m2[0] };
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
  try {
    if (typeof marked === 'undefined') throw new Error('marked not loaded');
    html = marked.parse(src);
  }
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
         
