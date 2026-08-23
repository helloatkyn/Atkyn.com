/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown : marked.js  |  Math : KaTeX (direct)  |  Code : highlight.js

   marked-katex-extension removed — it loses to marked's paragraph
   tokenizer on multiline $$..$$ blocks. All four math delimiters
   handled via marked's own extension API (block before inline):
     Block  : $$..$$  and  \[..\]
     Inline : $..$   and  \(..\)
   ═══════════════════════════════════════════════════════════════ */

/* ── HTML escape ── */
function _he(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── KaTeX render helper ── */
function _katexRender(tex, display) {
  try {
    return katex.renderToString(tex, {
      throwOnError: false,
      errorColor:   '#888888',
      displayMode:  display,
      trust:        false,
    });
  } catch (_) {
    return `<span class="katex-error">${_he(tex)}</span>`;
  }
}

/* ── marked setup ── */
function _buildMarked() {

  /* ── BLOCK: $$..$$ ── */
  const extDollarBlock = {
    name:  'mathDollarBlock',
    level: 'block',
    start(src) { return src.indexOf('$$'); },
    tokenizer(src) {
      if (!src.startsWith('$$')) return;
      const close = src.indexOf('$$', 2);
      if (close === -1) return;
      const raw  = src.slice(0, close + 2);
      const text = src.slice(2, close).trim();
      return { type: 'mathDollarBlock', raw, text };
    },
    renderer(t) { return '<div class="math-block">' + _katexRender(t.text, true) + '</div>\n'; },
  };

  /* ── BLOCK: \[..\] ── */
  const extBracketBlock = {
    name:  'mathBracketBlock',
    level: 'block',
    start(src) { return src.indexOf('\\['); },
    tokenizer(src) {
      if (!src.startsWith('\\[')) return;
      const close = src.indexOf('\\]');
      if (close === -1) return;
      const raw  = src.slice(0, close + 2);
      const text = src.slice(2, close).trim();
      return { type: 'mathBracketBlock', raw, text };
    },
    renderer(t) { return '<div class="math-block">' + _katexRender(t.text, true) + '</div>\n'; },
  };

  /* ── INLINE: $..$  (not $$) ── */
  const extDollarInline = {
    name:  'mathDollarInline',
    level: 'inline',
    start(src) {
      let i = src.indexOf('$');
      while (i !== -1) {
        if (src[i + 1] !== '$') return i;
        i = src.indexOf('$', i + 2);
      }
    },
    tokenizer(src) {
      if (src[0] !== '$' || src[1] === '$') return;
      const close = src.indexOf('$', 1);
      if (close === -1) return;
      const raw  = src.slice(0, close + 1);
      const text = src.slice(1, close).trim();
      return { type: 'mathDollarInline', raw, text };
    },
    renderer(t) { return _katexRender(t.text, false); },
  };

  /* ── INLINE: \(..\) ── */
  const extParenInline = {
    name:  'mathParenInline',
    level: 'inline',
    start(src) { return src.indexOf('\\('); },
    tokenizer(src) {
      if (!src.startsWith('\\(')) return;
      const close = src.indexOf('\\)');
      if (close === -1) return;
      const raw  = src.slice(0, close + 2);
      const text = src.slice(2, close).trim();
      return { type: 'mathParenInline', raw, text };
    },
    renderer(t) { return _katexRender(t.text, false); },
  };

  /* ── register: block first, then inline ── */
  marked.use({ extensions: [extDollarBlock, extBracketBlock, extDollarInline, extParenInline] });

  /* ── code block renderer with copy button ── */
  const renderer = new marked.Renderer();
  renderer.code = function (code, lang) {
    const language = (lang || '').trim().toLowerCase();
    const label    = language || 'code';
    const id       = 'cb' + Math.random().toString(36).slice(2, 8);
    let hi = _he(code);
    if (typeof hljs !== 'undefined') {
      const valid  = language && hljs.getLanguage(language);
      const result = valid
        ? hljs.highlight(code, { language, ignoreIllegals: true })
        : hljs.highlightAuto(code);
      hi = result.value;
    }
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

  marked.setOptions({ renderer, breaks: true, gfm: true });
}

_buildMarked();

/* ── pipeline ── */
function _safePipeline(raw) {
  if (!raw || !raw.trim()) return '';
  try {
    const text = raw
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '');
    return marked.parse(text);
  } catch (_) {
    return `<pre class="render-fallback">${_he(raw)}</pre>`;
  }
}

/* ── hash ── */
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
  const flush = (final = false) => {
    clearTimeout(_t);
    _t = null;
    if (typeof onUpdate === 'function') onUpdate(final ? r.finishStream() : r.getHTML(), { final });
  };
  return {
    push:    chunk => { if (_done) return; r.pushChunk(chunk); clearTimeout(_t); _t = setTimeout(() => flush(false), debounceMs); },
    finish:  ()    => { if (_done) return; _done = true; flush(true); },
    getRenderer: () => r,
  };
}

/* ── public aliases ── */
function universalRender(content, role = 'user', streaming = false) {
  const r = new UniversalMessageRenderer();
  if (streaming) { r.startStream(); r.pushChunk(content); return r.getHTML(); }
  return r.render(content);
}
function renderMathBubble(_el) {}
function renderMarkdown(text)  { return universalRender(text); }
