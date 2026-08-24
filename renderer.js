/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown + Math : marked.js@13 + marked-katex-extension + KaTeX
   Code highlight  : highlight.js
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

/* ── Cheap string hash for render caching ── */
function _cheapHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h;
}

/* ── Collapse excessive blank lines, strip leading/trailing newlines ── */
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

/* ── Normalize all LaTeX delimiter variants before parsing ──
   Handles every format LLMs emit — don't rely on AI to use
   one consistent style.

   \[...\]       →  block $$...$$   (LaTeX display math)
   \(...\)       →  inline $...$    (LaTeX inline math)
   $$ ... $$     →  block (delimiters on their own lines)

   marked-katex-extension requires block $$ delimiters to be
   on their own line — normalize inline-style $$ blocks here
   so the parser always sees the correct format.
── */
function _normalizeLatex(str) {
  // \[...\] → block $$
  str = str.replace(/\\\[([\s\S]*?)\\\]/g, function(_, inner) {
    return '\n$$\n' + inner.trim() + '\n$$\n';
  });

  // \(...\) → inline $
  str = str.replace(/\\\(([\s\S]*?)\\\)/g, function(_, inner) {
    return '$' + inner + '$';
  });

  // $$ ... $$ on a single line → block with delimiters on own lines
  // Multiline $$ blocks (already correct format) are left untouched
  str = str.replace(/\$\$([\s\S]*?)\$\$/g, function(_, inner) {
    const trimmed = inner.trim();
    if (trimmed.includes('\n')) return '$$\n' + trimmed + '\n$$';
    return '\n$$\n' + trimmed + '\n$$\n';
  });

  return str;
}

/* ── Configure marked once at module load ── */
function _buildMarked() {
  /* KaTeX extension — nonStandard:true allows $...$ without
     surrounding spaces, which LLMs commonly emit */
  marked.use(markedKatex({
    throwOnError: false,
    errorColor: '#888888',
    trust: false,
    output: 'html',
    nonStandard: true,
    delimiters: [
      { left: '$$', right: '$$', display: true  },
      { left: '$',  right: '$',  display: false },
    ],
  }));

  /* marked v13: use marked.use({ renderer }) — NOT marked.setOptions({ renderer })
     setOptions passes the full token object as first arg in v13, breaking
     renderer.code which expects (code, lang, escaped). */
  marked.use({
    breaks: true,
    gfm: true,
    renderer: {
      code(code, lang) {
        const language  = (lang  || '').trim().toLowerCase();
        const codeStr   = String(code || '');
        const label     = language || 'code';
        const id        = 'cb' + Math.random().toString(36).slice(2, 8);

        let highlighted = _he(codeStr);
        if (typeof hljs !== 'undefined') {
          try {
            const valid  = language && hljs.getLanguage(language);
            const result = valid
              ? hljs.highlight(codeStr, { language, ignoreIllegals: true })
              : hljs.highlightAuto(codeStr);
            highlighted = result.value;
          } catch (_) {
            highlighted = _he(codeStr);
          }
        }

        return (
          '<div class="code-block" id="' + id + '">' +
            '<div class="code-block-header">' +
              '<span class="code-block-lang">' + _he(label) + '</span>' +
              '<button class="code-copy-btn" data-target="' + id + '">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
                  '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
                  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
                '</svg> Copy' +
              '</button>' +
            '</div>' +
            '<pre><code class="hljs">' + highlighted + '</code></pre>' +
          '</div>'
        );
      }
    }
  });
}

_buildMarked();

/* ── Core render pipeline ── */
function _safePipeline(raw) {
  if (!raw) return '';
  const text = _normalizeNewlines(_normalizeLatex(raw));
  if (!text) return '';
  try { return marked.parse(text); }
  catch (_) { return '<pre class="render-fallback">' + _he(raw) + '</pre>'; }
}

/* ── UniversalMessageRenderer ──
   Supports both one-shot rendering and streaming with debounce. ── */
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

  startStream() {
    this._buf            = '';
    this._streaming      = true;
    this.rawContent      = '';
    this.renderedContent = '';
    this._hash           = null;
  }

  pushChunk(chunk) {
    if (!this._streaming) this.startStream();
    this.rawContent = (this._buf += chunk);
    return (this.renderedContent = _safePipeline(this._buf));
  }

  finishStream() {
    this._streaming = false;
    return (this.renderedContent = _safePipeline(this._buf));
  }

  getHTML() { return this.renderedContent; }
  getRaw()  { return this.rawContent; }
}

/* ── createStreamingRenderer ──
   Factory for streaming use — debounces DOM updates to debounceMs. ── */
function createStreamingRenderer(onUpdate, debounceMs = 40) {
  const renderer = new UniversalMessageRenderer();
  renderer.startStream();
  let _timer = null;
  let _done  = false;

  function _flush(final) {
    clearTimeout(_timer);
    _timer = null;
    if (typeof onUpdate === 'function') {
      onUpdate(final ? renderer.finishStream() : renderer.getHTML(), { final });
    }
  }

  return {
    push(chunk) {
      if (_done) return;
      renderer.pushChunk(chunk);
      clearTimeout(_timer);
      _timer = setTimeout(function() { _flush(false); }, debounceMs);
    },
    finish() {
      if (_done) return;
      _done = true;
      clearTimeout(_timer);
      _flush(true);
    },
    getRenderer() { return renderer; },
  };
}

/* ── Public helpers ── */
function universalRender(content) { return new UniversalMessageRenderer().render(content); }
function renderMarkdown(text)     { return universalRender(text); }
