/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown + Math : marked.js + marked-katex-extension + KaTeX
   Code highlight  : highlight.js
   ═══════════════════════════════════════════════════════════════ */

/* ── HTML escape (used in code block renderer only) ── */
function _he(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── Fast non-cryptographic hash (djb2 variant, lower collision rate) ── */
function _cheapHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0; // keep unsigned 32-bit
  }
  return h;
}

/* ══════════════════════════════════════════════════════════════
   _buildMarked()
   Sets up marked.js once with:
     • marked-katex-extension  →  $…$  and  $$…$$
     • custom block extension  →  \[…\]  (display, multiline-safe)
     • custom inline extension →  \(…\)
     • code block renderer with copy button
   ══════════════════════════════════════════════════════════════ */
function _buildMarked() {

  /* 1. marked-katex-extension handles $…$ and $$…$$ */
  marked.use(markedKatex({
    throwOnError: false,
    errorColor:   '#888888',
    trust:        false,
  }));

  /* 2. \[…\] block and \(…\) inline extensions.
        Registered AFTER markedKatex → higher priority in the chain.

        KEY FIX for multiline \[…\]:
        - `start()` scans for the opening delimiter anywhere in `src`.
        - `tokenizer()` receives `src` already trimmed to start at `\[`
          (marked slices from the index returned by `start()`), so
          `src.startsWith('\\[')` is always safe here.
        - We search the *entire* remaining src for `\]`, not just the
          first line, so multiline display math works correctly.
        - `_safePipeline` no longer collapses blank lines inside a math
          fence (see the guard there).
  */
  marked.use({
    extensions: [
      /* ── \[…\] display block ── */
      {
        name:  'mathBracketBlock',
        level: 'block',
        start(src) { return src.indexOf('\\['); },
        tokenizer(src) {
          // marked slices src so it starts at the `\[` found by start()
          if (!src.startsWith('\\[')) return;
          const close = src.indexOf('\\]', 2); // skip past the opening `\[`
          if (close === -1) return;            // unclosed → leave to fallback
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
            return `<div class="math-block math-error">${_he(token.text)}</div>\n`;
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
            return `<span class="math-error">${_he(token.text)}</span>`;
          }
        },
      },
    ],
  });

  /* 3. Code block renderer with syntax highlighting + copy button */
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
        `<pre><code class="hljs">${highlighted}</code></pre>` +
      `</div>`
    );
  };

  marked.setOptions({ renderer, breaks: true, gfm: true });
}

_buildMarked();

/* ══════════════════════════════════════════════════════════════
   _safePipeline(raw)
   Normalises whitespace before handing off to marked.parse().

   IMPORTANT: We must NOT collapse blank lines that fall inside a
   \[…\] or $$…$$ fence — doing so would join lines and break the
   tokenizer's ability to find the closing delimiter.  The approach
   here is conservative: only reduce runs of 3+ blank lines down to
   exactly 2 (which is the standard "paragraph break" for marked),
   but never reduce to 1 (which would merge content into a paragraph).
   ══════════════════════════════════════════════════════════════ */
function _safePipeline(raw) {
  if (!raw || !raw.trim()) return '';
  try {
    const text = raw
      .replace(/\n{3,}/g, '\n\n') // 3+ blank lines → exactly 2
      .replace(/^\n+/, '')        // strip leading newlines
      .replace(/\n+$/, '');       // strip trailing newlines
    return marked.parse(text);
  } catch (_) {
    return `<pre class="render-fallback">${_he(raw)}</pre>`;
  }
}

/* ══════════════════════════════════════════════════════════════
   UniversalMessageRenderer
   Wraps _safePipeline with:
     • per-instance hash-based render cache (skip re-parse if unchanged)
     • streaming accumulation (startStream / pushChunk / finishStream)
   ══════════════════════════════════════════════════════════════ */
class UniversalMessageRenderer {
  constructor() {
    this.rawContent      = '';
    this.renderedContent = '';
    this._hash           = null;
    this._buf            = '';
    this._streaming      = false;
  }

  /** Render static (non-streaming) content. Returns cached HTML if unchanged. */
  render(content) {
    this.rawContent = content;
    const h = _cheapHash(content);
    if (h === this._hash && this.renderedContent) return this.renderedContent;
    this._hash = h;
    this.renderedContent = _safePipeline(content);
    return this.renderedContent;
  }

  /** Begin a streaming session. Resets all state. */
  startStream() {
    this._buf            = '';
    this._streaming      = true;
    this.rawContent      = '';
    this.renderedContent = '';
    this._hash           = null;
  }

  /** Append a chunk and return the current rendered HTML. */
  pushChunk(chunk) {
    if (!this._streaming) this.startStream();
    this._buf       += chunk;
    this.rawContent  = this._buf;
    // No hash-cache during streaming — content changes every chunk
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
   Factory for fire-and-forget streaming renders.
   onUpdate(html, { final }) is called:
     • debounced while streaming (avoids excessive DOM updates)
     • immediately and synchronously on finish()
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
      _timer = setTimeout(() => _flush(false), debounceMs);
    },

    finish() {
      if (_done) return;
      _done = true;
      clearTimeout(_timer); // cancel any pending debounce
      _flush(true);         // render final state synchronously
    },

    getRenderer() { return renderer; },
  };
}

/* ══════════════════════════════════════════════════════════════
   Public API
   ══════════════════════════════════════════════════════════════ */

/**
 * universalRender(content)
 * Render markdown+math content to HTML. Stateless convenience wrapper.
 */
function universalRender(content) {
  return new UniversalMessageRenderer().render(content);
}

/**
 * renderMarkdown(text)
 * Alias kept for call-sites that use the old name.
 */
function renderMarkdown(text) {
  return universalRender(text);
}
