/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown : marked.js  |  Math : KaTeX auto-render  |  Code : highlight.js
   ═══════════════════════════════════════════════════════════════ */

/* ── HTML escape (used only for code blocks) ── */
function _he(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── marked.js — custom renderer for code blocks with copy button ── */
function _buildMarked() {
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

/* ── KaTeX auto-render config ── */
const _KATEX_OPTIONS = {
  delimiters: [
    { left: '$$',  right: '$$',  display: true  },
    { left: '\\[', right: '\\]', display: true  },
    { left: '\\(', right: '\\)', display: false },
    { left: '$',   right: '$',   display: false },
  ],
  throwOnError: false,
  errorColor:   '#888888',
  trust:        false,
};

/* ── Queue: bubbles that arrived before KaTeX loaded ── */
const _mathQueue = [];
let   _katexReady = false;

/* Called by index.html onload on auto-render script */
window._onKatexReady = function () {
  _katexReady = true;
  _mathQueue.forEach(el => renderMathInElement(el, _KATEX_OPTIONS));
  _mathQueue.length = 0;
};

function _renderMathInEl(el) {
  if (_katexReady) {
    renderMathInElement(el, _KATEX_OPTIONS);
  } else {
    _mathQueue.push(el);
  }
}

/* ── MutationObserver — auto-renders math in every new bot bubble ──
   Watches #msgWrap; when a new .msg.bot lands, runs KaTeX on its
   .bubble. Works even if KaTeX loads after the first message.      ── */
function _initMathObserver() {
  const host = document.getElementById('msgWrap');
  if (!host) return;

  new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.classList.contains('msg') && node.classList.contains('bot')) {
          const bubble = node.querySelector('.bubble');
          if (bubble) _renderMathInEl(bubble);
        }
      }
    }
  }).observe(host, { childList: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initMathObserver);
} else {
  _initMathObserver();
}

/* ── Main pipeline ── */
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

/* ── Memoization hash ── */
function _cheapHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return h;
}

/* ── UniversalMessageRenderer ── */
class UniversalMessageRenderer {
  constructor() {
    this.rawContent      = '';
    this.renderedContent = '';
    this._hash           = null;
    this._buf            = '';
    this._streaming      = false;
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
function renderMarkdown(text)  { return universalRender(text); }
     
