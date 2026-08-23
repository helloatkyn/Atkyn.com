/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown + Math : marked.js + marked-katex-extension + KaTeX
   Code highlight  : highlight.js

   FIX: LaTeX \[...\] and \(...\) pre-processed to $$...$$ and $...$
        BEFORE marked.parse() runs — otherwise marked tokenizer
        breaks multi-line math blocks into paragraphs first.
   ═══════════════════════════════════════════════════════════════ */

/* ── HTML escape (code blocks only) ── */
function _he(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── LaTeX delimiter pre-processor ──────────────────────────────
   Converts \[...\] → $$...$$ and \(...\) → $...$
   MUST run on raw text BEFORE marked.parse() is called.
   This is necessary because marked.js tokenizes paragraph breaks
   first, splitting multi-line \[...\] blocks before the KaTeX
   extension ever sees them.
   ────────────────────────────────────────────────────────────── */
function _normalizeMathDelimiters(text) {
  if (!text) return text;

  /* Step 1: \[...\]  →  $$...$$ (display/block math)
     Use[\s\S] to match across newlines, non-greedy */
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, function (_, inner) {
    return '$$' + inner + '$$';
  });

  /* Step 2: \(...\)  →  $...$ (inline math)
     Exclude newlines to avoid accidentally swallowing paragraphs */
  text = text.replace(/\\\(([^]*?)\\\)/g, function (_, inner) {
    /* If inner contains a newline it was probably \[ intended as display */
    if (/\n/.test(inner)) return '$$' + inner + '$$';
    return '$' + inner + '$';
  });

  return text;
}

/* ── marked.js setup ─────────────────────────────────────────────
   marked-katex-extension handles $…$ / $$…$$ inline via marked.
   We pre-normalize \[…\] / \(…\) above so they arrive as $$/$$.  ── */
function _buildMarked() {
  /* KaTeX extension — must be registered before setOptions */
  marked.use(markedKatex({
    throwOnError: false,
    errorColor:   '#888888',
    trust:        false,
    nonStandard:  false,   /* We handle \[..\] ourselves via pre-processor */
  }));

  /* Custom code-block renderer with copy button */
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

/* ── Main pipeline ── */
function _safePipeline(raw) {
  if (!raw || !raw.trim()) return '';
  try {
    /* CRITICAL: normalize math delimiters BEFORE marked sees the text */
    const normalized = _normalizeMathDelimiters(raw);

    const text = normalized
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
