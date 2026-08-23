/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown : markdown-it  |  Math : KaTeX  |  Code : highlight.js
   ═══════════════════════════════════════════════════════════════ */

/* ── HTML escape ── */
function _he(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── KaTeX ── */
function _katexRender(tex, display) {
  if (typeof katex === 'undefined') return `<span class="math-fallback">${_he(tex)}</span>`;
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, errorColor: '#888888', trust: false });
  } catch (_) {
    return `<span class="math-fallback">${_he(tex)}</span>`;
  }
}

/* ── Math extractor — protects $…$ / $$…$$ / \(…\) / \[…\] from markdown-it ── */
function _extractMath(text) {
  const math = [];
  const ph = (inner, display) => { math.push({ inner: inner.trim(), display }); return `\x00M${math.length - 1}\x00`; };
  text = text.replace(/\\\[([\s\S]*?)(?:\\\]|$)/g,  (_, i) => ph(i, true));
  text = text.replace(/\$\$([\s\S]*?)(?:\$\$|$)/g,  (_, i) => ph(i, true));
  text = text.replace(/\\\(([\s\S]*?)(?:\\\)|$)/g,  (_, i) => ph(i, false));
  text = text.replace(/\$([^\$\n]{1,500}?)\$/g,      (_, i) => ph(i, false));
  return { text, math };
}

function _restoreMath(html, math) {
  return html.replace(/\x00M(\d+)\x00/g, (_, i) => {
    const { inner, display } = math[+i] || {};
    if (!inner) return '';
    const rendered = _katexRender(inner, display);
    return display ? `<div class="math-display-block">${rendered}</div>` : rendered;
  });
}

/* ── markdown-it instance (built once) ── */
function _buildMd() {
  const md = window.markdownit({
    html:    false,
    breaks:  true,
    linkify: true,
    highlight(code, lang) {
      if (typeof hljs === 'undefined') return _he(code);
      const valid = lang && hljs.getLanguage(lang);
      const result = valid
        ? hljs.highlight(code, { language: lang, ignoreIllegals: true })
        : hljs.highlightAuto(code);
      return result.value;
    },
  });

  /* Custom fence renderer: add header + copy button */
  md.renderer.rules.fence = (tokens, idx) => {
    const token  = tokens[idx];
    const lang   = (token.info || '').trim().toLowerCase();
    const label  = lang || 'code';
    const id     = 'cb' + Math.random().toString(36).slice(2, 8);
    const hi     = md.options.highlight(token.content, lang);
    return (
      `<div class="code-block" id="${id}">` +
        `<div class="code-block-header">` +
          `<span class="code-block-lang">${_he(label)}</span>` +
          `<button class="code-copy-btn" data-target="${id}">` +
            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">` +
              `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>` +
              `<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>` +
            `</svg> Copy` +
          `</button>` +
        `</div>` +
        `<pre><code class="hljs">${hi}</code></pre>` +
      `</div>`
    );
  };
  return md;
}

let _md = null;
function _getMd() { return (_md = _md || _buildMd()); }

/* ── Main pipeline ── */
function _safePipeline(raw) {
  if (!raw || !raw.trim()) return '';
  try {
    let text = raw.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
    const { text: mathText, math } = _extractMath(text);
    let html = _getMd().render(mathText);
    html = _restoreMath(html, math);
    return html;
  } catch (_) {
    return `<pre class="render-fallback">${_he(raw)}</pre>`;
  }
}

/* ── Memoization hash ── */
function _cheapHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return h;
}

/* ── UniversalMessageRenderer ── */
class UniversalMessageRenderer {
  constructor() { this.rawContent = ''; this.renderedContent = ''; this._hash = null; this._buf = ''; this._streaming = false; }
  render(content) {
    this.rawContent = content;
    const h = _cheapHash(content);
    if (h === this._hash && this.renderedContent) return this.renderedContent;
    this._hash = h;
    return (this.renderedContent = _safePipeline(content));
  }
  startStream()    { this._buf = ''; this._streaming = true; this.rawContent = ''; this.renderedContent = ''; }
  pushChunk(chunk) { if (!this._streaming) this.startStream(); this.rawContent = (this._buf += chunk); return (this.renderedContent = _safePipeline(this._buf)); }
  finishStream()   { this._streaming = false; return (this.renderedContent = _safePipeline(this._buf)); }
  getHTML()        { return this.renderedContent; }
  getRaw()         { return this.rawContent; }
}

/* ── createStreamingRenderer ── */
function createStreamingRenderer(onUpdate, debounceMs = 40) {
  const r = new UniversalMessageRenderer();
  r.startStream();
  let _t = null, _done = false;
  const flush = (final = false) => { clearTimeout(_t); _t = null; if (typeof onUpdate === 'function') onUpdate(final ? r.finishStream() : r.getHTML(), { final }); };
  return {
    push:        chunk => { if (_done) return; r.pushChunk(chunk); clearTimeout(_t); _t = setTimeout(() => flush(false), debounceMs); },
    finish:      ()    => { if (_done) return; _done = true; flush(true); },
    getRenderer: ()    => r,
  };
}

/* ── Public aliases ── */
function universalRender(content, role = 'user', streaming = false) {
  const r = new UniversalMessageRenderer();
  if (streaming) { r.startStream(); r.pushChunk(content); return r.getHTML(); }
  return r.render(content);
}
function renderMathBubble(_el) {}
function renderMarkdown(text) { return universalRender(text); }
