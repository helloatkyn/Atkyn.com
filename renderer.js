/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown + Math : marked.js + marked-katex-extension + KaTeX
   Code highlight  : highlight.js
   Zero regex — all string operations use char loops or indexOf.
   ═══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   _he(s)
   HTML-escape for inserting untrusted text into HTML attributes
   and text nodes. Used only in the code-block renderer.
   No regex — single char-loop, 5 substitutions.
   ══════════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════════
   _cheapHash(str)
   djb2-variant non-cryptographic hash. Lower collision rate than
   the previous Math.imul(31,h) approach. Unsigned 32-bit output.
   ══════════════════════════════════════════════════════════════ */
function _cheapHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h;
}

/* ══════════════════════════════════════════════════════════════
   _normalizeNewlines(str)
   Three operations, zero regex:
     1. Strip leading '\n' characters.
     2. Strip trailing '\n' characters.
     3. Collapse interior runs of 3+ '\n' to exactly 2 '\n'.

   Why exactly 2 and not 1?
   marked treats a single '\n' as a line-break inside a paragraph
   and two '\n' as a paragraph boundary. Collapsing to 1 would
   merge adjacent paragraphs. Collapsing to 2 preserves paragraph
   structure without creating extra blank space.

   Math fences (\[…\] and $$…$$) may span multiple lines. We must
   not destroy the internal newlines — they are fine as-is because
   the tokenizer searches the full remaining src string, not line-
   by-line. Runs of 3+ blank lines inside a fence are still reduced
   to 2, which is harmless: KaTeX ignores blank lines.
   ══════════════════════════════════════════════════════════════ */
function _normalizeNewlines(str) {
  // 1. find first non-'\n' position
  let start = 0;
  while (start < str.length && str[start] === '\n') start++;

  // 2. find last non-'\n' position
  let end = str.length - 1;
  while (end >= start && str[end] === '\n') end--;

  // entirely newlines (or empty)
  if (start > end) return '';

  // 3. walk start..end, emit chars; collapse consecutive '\n' runs to max 2
  const out = [];
  let i = start;
  while (i <= end) {
    if (str[i] !== '\n') {
      out.push(str[i]);
      i++;
    } else {
      let run = 0;
      while (i <= end && str[i] === '\n') { run++; i++; }
      out.push('\n');
      if (run > 1) out.push('\n');
    }
  }
  return out.join('');
}

/* ══════════════════════════════════════════════════════════════
   _buildMarked()
   One-time setup for marked.js:
     • marked-katex-extension  →  $…$  $$…$$
     • mathBracketBlock        →  \[…\]  (display, multiline-safe)
     • mathParenInline         →  \(…\)
     • code block renderer     →  syntax highlight + copy button
   ══════════════════════════════════════════════════════════════ */
function _buildMarked() {

  /* 1. marked-katex-extension — $…$ and $$…$$ */
  marked.use(markedKatex({
    throwOnError: false,
    errorColor:   '#888888',
    trust:        false,
  }));

  /* 2. \[…\] block + \(…\) inline
        Registered AFTER markedKatex → higher priority in the chain.

        Multiline \[…\] works because:
        - start() returns the index of '\\[' anywhere in src.
        - marked then slices src to begin exactly at that index before
          calling tokenizer(), so src.startsWith('\\[') is guaranteed.
        - We call indexOf('\\]', 2) which searches the ENTIRE remaining
          src, not just the current line — so multiline content between
          \[ and \] is captured correctly.
  */
  marked.use({
    extensions: [

      /* ── \[…\] display block ── */
      {
        name:  'mathBracketBlock',
        level: 'block',
        start(src) { return src.indexOf('\\['); },
        tokenizer(src) {
          if (!src.startsWith('\\[')) return;
          const close = src.indexOf('\\]', 2);
          if (close === -1) return;
          return {
            type: 'mathBracketBlock',
            raw:  src.slice(0, close + 2),
            text: src.slice(2, close).trim(),
          };
        },
        renderer(token) {
          try {
            return (
              '<div class="math-block">' +
              katex.renderToString(token.text, { throwOnError: false, displayMode: true }) +
              '</div>\n'
            );
          } catch (_) {
            return '<div class="math-block math-error">' + _he(token.text) + '</div>\n';
          }
        },
      },

      /* ── \(…\) inline ── */
      {
        name:  'mathParenInline',
        level: 'inline',
        start(src) { return src.indexOf('\\('); },
        tokenizer(src) {
          if (!src.startsWith('\\(')) return;
          const close = src.indexOf('\\)', 2);
          if (close === -1) return;
          return {
            type: 'mathParenInline',
            raw:  src.slice(0, close + 2),
            text: src.slice(2, close).trim(),
          };
        },
        renderer(token) {
          try {
            return katex.renderToString(token.text, { throwOnError: false, displayMode: false });
          } catch (_) {
            return '<span class="math-error">' + _he(token.text) + '</span>';
          }
        },
      },
    ],
  });

  /* 3. Code block renderer — syntax highlighting + copy button */
  const renderer = new marked.Renderer();
  renderer.code = function (code, lang) {
    const language = (lang || '').trim().toLowerCase();
    const label    = language || 'code';
    const id       = 'cb' + Math.random().toString(36).slice(2, 8);

    let highlighted = _he(code);
    if (typeof hljs !== 'undefined') {
      const valid  = language && hljs.getLanguage(language);
      const result = valid
        ? hljs.highlight(code, { language, ignoreIllegals: true })
        : hljs.highlightAuto(code);
      highlighted = result.value;
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

/* ══════════════════════════════════════════════════════════════
   _safePipeline(raw)
   Normalise whitespace, then parse through marked.
   Falls back to an escaped <pre> block on any exception.
   ══════════════════════════════════════════════════════════════ */
// Math tokens that signal LaTeX content inside plain [ ] brackets
const _MATH_TOKENS = [
  '\\frac', '\\int', '\\sum', '\\sqrt', '\\lim', '\\prod',
  '\\cdot', '\\cdots', '\\times', '\\infty', '\\alpha', '\\beta',
  '\\gamma', '\\delta', '\\theta', '\\lambda', '\\mu', '\\pi',
  '\\sigma', '\\omega', '\\partial', '\\nabla', '\\log', '\\ln',
  '\\sin', '\\cos', '\\tan', '\\vec', '\\hat', '\\bar',
  '\\left', '\\right', '\\begin', '\\end', '\\text',
];

function _hasMathToken(str) {
  for (let t = 0; t < _MATH_TOKENS.length; t++) {
    if (str.indexOf(_MATH_TOKENS[t]) !== -1) return true;
  }
  // ^ and _ are strong math signals (superscript / subscript)
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '^' || str[i] === '_') return true;
  }
  return false;
}

// Convert plain [ math ] → \[ math \] so user-typed LaTeX renders.
// Skips already-escaped \[ to avoid double-wrapping.
// Depth-tracks nested brackets so [a[b]c] is handled correctly.
function _normalizeBracketMath(str) {
  const out = [];
  let i = 0;
  while (i < str.length) {
    // Already-escaped \[ — pass through unchanged
    if (str[i] === '\\' && i + 1 < str.length && str[i + 1] === '[') {
      out.push('\\'); out.push('[');
      i += 2;
      continue;
    }
    if (str[i] === '[') {
      let depth = 1, j = i + 1;
      while (j < str.length && depth > 0) {
        if (str[j] === '[') depth++;
        else if (str[j] === ']') depth--;
        j++;
      }
      if (depth === 0) {
        const inner = str.slice(i + 1, j - 1);
        if (_hasMathToken(inner)) {
          out.push('\\['); out.push(inner); out.push('\\]');
        } else {
          out.push('['); out.push(inner); out.push(']');
        }
        i = j;
      } else {
        out.push(str[i]); i++;
      }
    } else {
      out.push(str[i]); i++;
    }
  }
  return out.join('');
}

function _safePipeline(raw) {
  if (!raw) return '';
  const text = _normalizeNewlines(_normalizeBracketMath(raw));
  if (!text) return '';
  try {
    return marked.parse(text);
  } catch (_) {
    return '<pre class="render-fallback">' + _he(raw) + '</pre>';
  }
}

/* ══════════════════════════════════════════════════════════════
   UniversalMessageRenderer
   Wraps _safePipeline with:
     • hash-based render cache  (skip re-parse when content unchanged)
     • streaming accumulation   (startStream / pushChunk / finishStream)

   Used for BOTH bot and user messages — user input goes through
   the same marked + KaTeX pipeline so that LaTeX typed by the user
   ($x^2$, \[…\], \(…\)) renders as formatted math in their bubble.
   ══════════════════════════════════════════════════════════════ */
class UniversalMessageRenderer {
  constructor() {
    this.rawContent      = '';
    this.renderedContent = '';
    this._hash           = null;
    this._buf            = '';
    this._streaming      = false;
  }

  /** Render static content. Returns cached HTML when content is unchanged. */
  render(content) {
    this.rawContent = content;
    const h = _cheapHash(content);
    if (h === this._hash && this.renderedContent) return this.renderedContent;
    this._hash = h;
    this.renderedContent = _safePipeline(content);
    return this.renderedContent;
  }

  /** Begin a new streaming session. Resets all accumulated state. */
  startStream() {
    this._buf            = '';
    this._streaming      = true;
    this.rawContent      = '';
    this.renderedContent = '';
    this._hash           = null;
  }

  /** Append one chunk and return the current rendered HTML. */
  pushChunk(chunk) {
    if (!this._streaming) this.startStream();
    this._buf       += chunk;
    this.rawContent  = this._buf;
    // No hash-cache during streaming: content changes on every chunk.
    this.renderedContent = _safePipeline(this._buf);
    return this.renderedContent;
  }

  /** Finalise the stream. Returns the fully-rendered HTML. */
  finishStream() {
    this._streaming      = false;
    this.renderedContent = _safePipeline(this._buf);
    return this.renderedContent;
  }

  getHTML() { return this.renderedContent; }
  getRaw()  { return this.rawContent; }
}

/* ══════════════════════════════════════════════════════════════
   createStreamingRenderer(onUpdate, debounceMs?)
   Fire-and-forget factory for streaming renders.

   onUpdate(html, { final }) fires:
     • debounced (every debounceMs ms) while chunks arrive
     • once, synchronously, when finish() is called

   finish() cancels any pending debounce timer before the final
   render so the last frame is never delayed or skipped.
   ══════════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════════
   Public API
   ══════════════════════════════════════════════════════════════ */

/**
 * universalRender(content)
 * Stateless convenience wrapper. Creates a one-shot renderer,
 * parses content through marked + KaTeX, returns HTML string.
 */
function universalRender(content) {
  return new UniversalMessageRenderer().render(content);
}

/**
 * renderMarkdown(text)
 * Legacy alias — kept so existing call-sites need no changes.
 */
function renderMarkdown(text) {
  return universalRender(text);
}
