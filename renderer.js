/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown + Math : marked.js + marked-katex-extension + KaTeX
   Code highlight  : highlight.js
   ═══════════════════════════════════════════════════════════════ */

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

function _cheapHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h;
}

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

/* ── Pre-process: convert \[...\] and \(...\) to $$ and $ ──
   marked-katex-extension natively handles $$...$$ and $...$
   but \[...\] block extension misses cases where \[ is mid-paragraph.
   Safest fix: convert to $$ delimiters before parsing. ── */
function _convertLatexDelimiters(str) {
  // \[...\]  →  $$...$$  (block)
  // Use non-greedy match; handle multiline
  str = str.replace(/\\\[([\s\S]*?)\\\]/g, function(_, inner) {
    return '\n$$' + inner + '$$\n';
  });
  // \(...\)  →  $...$   (inline)
  str = str.replace(/\\\(([\s\S]*?)\\\)/g, function(_, inner) {
    return '$' + inner + '$';
  });
  return str;
}

function _buildMarked() {
  // marked-katex-extension handles: $...$ and $$...$$
  marked.use(markedKatex({
    throwOnError: false,
    errorColor: '#888888',
    trust: false,
    delimiters: [
      { left: '$$', right: '$$', display: true  },
      { left: '$',  right: '$',  display: false },
    ],
  }));

  const renderer = new marked.Renderer();
  renderer.code = function (code, lang) {
    const language = (lang || '').trim().toLowerCase();
    const label    = language || 'code';
    const id       = 'cb' + Math.random().toString(36).slice(2, 8);
    let highlighted = _he(code);
    if (typeof hljs !== 'undefined') {
      const valid  = language && hljs.getLanguage(language);
      const result = valid ? hljs.highlight(code, { language, ignoreIllegals: true }) : hljs.highlightAuto(code);
      highlighted  = result.value;
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
  };

  marked.setOptions({ renderer, breaks: true, gfm: true });
}

_buildMarked();

function _safePipeline(raw) {
  if (!raw) return '';
  const text = _normalizeNewlines(_convertLatexDelimiters(raw));
  if (!text) return '';
  try { return marked.parse(text); }
  catch (_) { return '<pre class="render-fallback">' + _he(raw) + '</pre>'; }
}

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
  startStream() {
    this._buf = ''; this._streaming = true;
    this.rawContent = ''; this.renderedContent = ''; this._hash = null;
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

function createStreamingRenderer(onUpdate, debounceMs = 40) {
  const renderer = new UniversalMessageRenderer();
  renderer.startStream();
  let _timer = null, _done = false;
  function _flush(final) {
    clearTimeout(_timer); _timer = null;
    if (typeof onUpdate === 'function')
      onUpdate(final ? renderer.finishStream() : renderer.getHTML(), { final });
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

function universalRender(content) { return new UniversalMessageRenderer().render(content); }
function renderMarkdown(text)     { return universalRender(text); }
