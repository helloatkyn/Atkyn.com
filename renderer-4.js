/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Text rendering: marked.js  |  Math: KaTeX  |  Code: syntaxHighlight
   ═══════════════════════════════════════════════════════════════ */

/* ── HTML escape helpers ── */
function _he(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── KaTeX renderer ── */
function _katexRender(tex, display) {
  if (typeof katex === 'undefined') return `<span class="math-fallback">${_he(tex)}</span>`;
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, errorColor: '#888888', trust: false });
  } catch (_) {
    return `<span class="math-fallback">${_he(tex)}</span>`;
  }
}

/* ── Math extractor — runs before marked so $ / \ are never touched.
   Order: display ($$, \[) before inline ($, \() to avoid double-parse. ── */
function _extractMath(text) {
  const math = [];
  const ph = (inner, display) => { math.push({ inner: inner.trim(), display }); return `\x00M${math.length - 1}\x00`; };
  text = text.replace(/\\\[([\s\S]*?)(?:\\\]|$)/g,    (_, i) => ph(i, true));
  text = text.replace(/\$\$([\s\S]*?)(?:\$\$|$)/g,    (_, i) => ph(i, true));
  text = text.replace(/\\\(([\s\S]*?)(?:\\\)|$)/g,    (_, i) => ph(i, false));
  text = text.replace(/\$([^\$\n]{1,500}?)\$/g,        (_, i) => ph(i, false));
  return { text, math };
}

/* ── Restore math placeholders in final HTML ── */
function _restoreMath(html, math) {
  return html.replace(/\x00M(\d+)\x00/g, (_, i) => {
    const idx = +i;
    if (!math || idx >= math.length) return '';
    const { inner, display } = math[idx];
    const rendered = _katexRender(inner, display);
    return display ? `<div class="math-display-block">${rendered}</div>` : rendered;
  });
}

/* ── Syntax highlighter ── */
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
function _resetRx() { for (const r of Object.values(_RX)) r.lastIndex = 0; }

function syntaxHighlight(code, lang) {
  if (!code) return '<div class="code-lines"></div>';
  const l = (lang || '').toLowerCase();
  let out = '';
  for (let i = 0, lines = code.split('\n'); i < lines.length; i++) {
    out += `<div class="code-line"><span class="code-line-num">${i + 1}</span><span class="code-line-content">${_tokenizeLine(lines[i], l)}</span></div>`;
  }
  return `<div class="code-lines">${out}</div>`;
}

function _tokenizeLine(line, lang) {
  _resetRx();
  const ph = [];
  const protect = html => { const idx = ph.length; ph.push(html); return `\x02z${idx}z\x02`; };
  const span    = (cls, t) => protect(`<span class="${cls}">${_esc(t)}</span>`);

  let s = line;
  s = s.replace(_RX.blockComment, m => span('tk-cmt', m));
  const hashLangs = ['python', 'py', 'bash', 'sh', 'yaml', 'yml', 'ruby', 'rb', 'r'];
  s = hashLangs.includes(lang)
    ? s.replace(_RX.hashComment, m => span('tk-cmt', m))
    : s.replace(_RX.lineComment, m => span('tk-cmt', m));
  s = s.replace(_RX.btStr,  m => span('tk-str', m));
  s = s.replace(_RX.dqStr,  m => span('tk-str', m));
  s = s.replace(_RX.sqStr,  m => span('tk-str', m));
  s = _esc(s);
  s = s.replace(_RX.numLit,  m => protect(`<span class="tk-num">${m}</span>`));
  s = s.replace(_RX.clsName, (_, p) => protect(`<span class="tk-cls">${p}</span>`));
  s = s.replace(_RX.fnCall,  (_, p) => protect(`<span class="tk-fn">${p}</span>`));
  if      (lang === 'python' || lang === 'py') s = s.replace(_RX.pyKw,   m => protect(`<span class="tk-kw">${m}</span>`));
  else if (lang === 'dart')                    s = s.replace(_RX.dartKw, m => protect(`<span class="tk-kw">${m}</span>`));
  else                                         s = s.replace(_RX.jsKw,   m => protect(`<span class="tk-kw">${m}</span>`));
  s = s.replace(_RX.jsBool,  m => protect(`<span class="tk-bool">${m}</span>`));
  s = s.replace(_RX.propKey, (_, p) => protect(`<span class="tk-prop">${p}</span>`));
  s = s.replace(/\x02z(\d+)z\x02/g, (_, i) => ph[+i]);
  return s || ' ';
}

/* ════════════════════════════════════════════════════════════════
   UNIVERSAL PIPELINE LAYER
   repairMarkdown → repairMathFragments → marked.parse → restoreMath → autoLinkUrls
   ════════════════════════════════════════════════════════════════ */

/* Conservative markdown repair */
function repairMarkdown(text) {
  if (!text) return text;
  text = text.replace(/^(#{1,6})([^#\s])/gm, '$1 $2');
  text = text.replace(/(\*\*[^*\n]+?\*\*)([a-zA-Z\u0900-\u097F])/g, '$1 $2');
  text = text.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)([a-zA-Z\u0900-\u097F])/g, (_, i, a) => `*${i}* ${a}`);
  text = text.replace(/([A-Za-z\u0900-\u097F0-9]):\$/g, '$1: $');
  text = text.replace(/([A-Za-z\u0900-\u097F]):(\d)/g, '$1: $2');
  text = text.replace(/:-([^\s])/g, ':\n- $1');
  text = text.replace(/^(?!---)-([A-Za-z\u0900-\u097F\u00C0-\u024F])/gm, '- $1');
  return text;
}

/* Broken math fragment reassembly */
const _MATH_OP   = /^[+\-\u2212\u00D7\u00F7\/*=\u2248<>\u00B1]\s*$/;
const _MATH_PAR  = /^[()[\]]\s*$/;
const _MATH_NUM  = /^\d{1,15}(\.\d{1,10})?\s*$/;
const _MATH_WORD = /^(high|low|close|open|max|min|avg|mean|sum|price|eps|pe|ratio)\s*$/i;

function repairMathFragments(text) {
  if (!text) return text;
  const lines = text.split('\n'), result = [];
  let i = 0;
  while (i < lines.length) {
    const run = []; let j = i;
    while (j < lines.length && j - i < 9) {
      const l = lines[j].trim();
      if (!l) break;
      if (!_MATH_OP.test(l) && !_MATH_PAR.test(l) && !_MATH_NUM.test(l) && !_MATH_WORD.test(l)) break;
      run.push(l); j++;
    }
    if (run.length >= 2 && run.some(l => _MATH_OP.test(l)) && run.some(l => _MATH_NUM.test(l))) {
      result.push('$' + run.join(' ').replace(/\u2212/g, '-') + '$'); i = j;
    } else { result.push(lines[i]); i++; }
  }
  return result.join('\n');
}

/* Whitespace normalization */
function normalizeWhitespace(text) {
  if (!text) return text;
  return text.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

/* Auto-link bare https URLs in final HTML */
function _autoLinkUrls(html) {
  const URL_RE = /\bhttps?:\/\/[^\s<>"')[\]]+/gi;
  return html
    .split(/(<a\s[\s\S]*?<\/a>|<[^>]+>)/gi)
    .map((chunk, idx) => {
      if (idx % 2 === 1 || chunk.startsWith('<')) return chunk;
      return chunk.replace(URL_RE, url => {
        const label = url.length > 60 ? url.slice(0, 57) + '…' : url;
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${_he(label)}</a>`;
      });
    })
    .join('');
}

/* marked.js — custom renderer: code blocks use syntaxHighlight */
function _buildMarkedRenderer() {
  const renderer = new marked.Renderer();
  renderer.code = ({ text, lang }) => {
    const l = (lang || '').toLowerCase();
    const langLabel = l || 'code';
    const blockId = 'cb' + Math.random().toString(36).slice(2, 8);
    return (
      `<div class="code-block" id="${blockId}">` +
        `<div class="code-block-header">` +
          `<span class="code-block-lang">${_he(langLabel)}</span>` +
          `<button class="code-copy-btn" data-target="${blockId}">` +
            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">` +
              `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>` +
              `<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>` +
            `</svg> Copy` +
          `</button>` +
        `</div>` +
        `<pre>${syntaxHighlight(text, l)}</pre>` +
      `</div>`
    );
  };
  return renderer;
}

/* Internal pipeline */
function _safePipeline(raw) {
  if (!raw || !raw.trim()) return '';
  try {
    let text = raw;
    try { text = normalizeWhitespace(text);    } catch (_) {}
    try { text = repairMarkdown(text);         } catch (_) {}
    try { text = repairMathFragments(text);    } catch (_) {}

    // Extract math before marked touches $
    const { text: mathText, math } = _extractMath(text);

    let html;
    try {
      html = marked.parse(mathText, {
        renderer: _buildMarkedRenderer(),
        breaks: true,
        gfm: true,
      });
    } catch (_) {
      html = `<pre class="render-fallback">${_he(raw)}</pre>`;
    }

    // Restore KaTeX math
    try { html = _restoreMath(html, math);  } catch (_) {}
    try { html = _autoLinkUrls(html);       } catch (_) {}
    return html;
  } catch (_) {
    return `<pre class="render-fallback">${_he(raw)}</pre>`;
  }
}

/* Fast hash for memoization */
function _cheapHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return h;
}

/* ── UniversalMessageRenderer ── */
class UniversalMessageRenderer {
  constructor() {
    this.rawContent = ''; this.renderedContent = '';
    this._hash = null; this._buf = ''; this._streaming = false;
  }
  render(content, { role = 'user' } = {}) {
    this.rawContent = content;
    const h = _cheapHash(content);
    if (h === this._hash && this.renderedContent) return this.renderedContent;
    this._hash = h;
    return (this.renderedContent = _safePipeline(content));
  }
  startStream() { this._buf = ''; this._streaming = true; this.rawContent = ''; this.renderedContent = ''; }
  pushChunk(chunk) {
    if (!this._streaming) this.startStream();
    this.rawContent = (this._buf += chunk);
    return (this.renderedContent = _safePipeline(this._buf));
  }
  finishStream() { this._streaming = false; return (this.renderedContent = _safePipeline(this._buf)); }
  getHTML() { return this.renderedContent; }
  getRaw()  { return this.rawContent; }
}

/* ── createStreamingRenderer(onUpdate, debounceMs) ── */
function createStreamingRenderer(onUpdate, debounceMs = 40) {
  const r = new UniversalMessageRenderer();
  r.startStream();
  let _t = null, _done = false;
  const flush = (final = false) => {
    clearTimeout(_t); _t = null;
    if (typeof onUpdate === 'function') onUpdate(final ? r.finishStream() : r.getHTML(), { final });
  };
  return {
    push:        chunk => { if (_done) return; r.pushChunk(chunk); clearTimeout(_t); _t = setTimeout(() => flush(false), debounceMs); },
    finish:      ()    => { if (_done) return; _done = true; flush(true); },
    getRenderer: ()    => r,
  };
}

/* ── universalRender ── */
function universalRender(content, role = 'user', streaming = false) {
  const r = new UniversalMessageRenderer();
  if (streaming) { r.startStream(); r.pushChunk(content); return r.getHTML(); }
  return r.render(content, { role });
}

/* renderMathBubble — no-op retained for call-site compatibility */
function renderMathBubble(_el) {}
