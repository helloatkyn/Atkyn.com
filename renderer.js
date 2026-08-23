/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown : markdown-it  |  Math : texmath + KaTeX  |  Code : highlight.js
   ═══════════════════════════════════════════════════════════════ */

/* ── HTML escape ── */
function _he(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  }).use(texmath, {
    engine:       katex,
    delimiters:   ['dollars', 'brackets'],  // $..$ + $$..$$ + \(..\) + \[..\]
    katexOptions: { throwOnError: false, errorColor: '#c0392b', trust: false },
  });

  /* Custom fence renderer: header + copy button */
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const lang  = (token.info || '').trim().toLowerCase();
    const label = lang || 'code';
    const id    = 'cb' + Math.random().toString(36).slice(2, 8);
    const hi    = md.options.highlight(token.content, lang);
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
    const text = raw.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
    return _getMd().render(text);
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
