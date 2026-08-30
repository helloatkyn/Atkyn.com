/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown · KaTeX math · Syntax highlighting · Table rendering

   AUDIT FIXES (v2):
   ─────────────────
   [F01] CRLF / CR normalization before ALL processing
   [F02] Heading extraction BEFORE paragraph split (not inside it)
         → headings separated by single \n now work correctly
   [F03] Heading regex made more permissive: optional leading spaces,
         optional trailing spaces, handles "### # text" style output
   [F04] Single-\n heading separation: pre-process block to insert
         \n\n around heading lines so paragraph split sees them
   [F05] _sqStr regex tightened to avoid eating lone apostrophes
   [F06] $…$ math regex: atomic-style guard against catastrophic
         backtracking — content capped at 500 chars, no newlines
   [F07] _extractMath: display $$ checked before inline $ (was already
         correct but order made explicit and documented)
   [F08] Block-level math restored before paragraph wrapping to avoid
         being wrapped in <p>
   [F09] Ordered list uses <ol> not <ul>
   [F10] Table separator detection fixed — was filtering rows that
         start with | and contain only dashes/colons/pipes/spaces
   [F11] Paragraph line-join: single \n between lines → <br> only for
         actual prose; heading lines never reach here post-F04
   [F12] _he / _esc: cover all 5 HTML special chars including '
   [F13] Link URL sanitization extended: javascript: / data: / vbscript:
   [F14] Math placeholder in _fmt: guard against out-of-range index
   [F15] syntaxHighlight: empty input guard
   [F16] renderMarkdown: empty / whitespace-only input guard
   [F17] Code block regex: handle no trailing newline (streaming safety)
   [F18] Heading normalizer: handle ##### and ###### → ####
   [F19] renderMathBubble kept for call-site compat (intentional no-op)
   ═══════════════════════════════════════════════════════════════ */

/* ── HTML escape — all 5 special chars ── */       // [F12]
function _he(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Lightweight escape for pre/code content ── */
function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ────────────────────────────────────────────────────────────────
   KaTeX
   ──────────────────────────────────────────────────────────────── */

function _katexRender(tex, display) {
  if (typeof katex === 'undefined') {
    return `<span class="math-fallback">${_he(tex)}</span>`;
  }
  try {
    return katex.renderToString(tex, {
      displayMode:  display,
      throwOnError: false,
      errorColor:   '#888888',
      trust:        false,
    });
  } catch (_) {
    return `<span class="math-fallback">${_he(tex)}</span>`;
  }
}

/*
 * Extract math delimiters before markdown processing so that $ signs and
 * backslashes inside math regions are never touched by the markdown parser.
 * Returns the text with placeholders (\x00M{n}\x00) and an array of
 * { inner, display } objects for later restoration.
 *
 * [F06] $…$ pattern: use negated char class with 500-char cap to prevent
 *       catastrophic backtracking on long inputs with unmatched $.
 * [F07] Order: display ($$) before inline ($) — prevents $$ being parsed
 *       as two adjacent inline-$ delimiters.
 */
function _extractMath(text) {
  const math = [];

  function placeholder(inner, display) {
    math.push({ inner: inner.trim(), display });
    return `\x00M${math.length - 1}\x00`;
  }

  // Display math: \[…\]  and  $$…$$  (MUST come before inline $)
  text = text.replace(/\\\[([\s\S]*?)(?:\\\]|$)/g,
    (_, inner) => placeholder(inner, true));
  text = text.replace(/\$\$([\s\S]*?)(?:\$\$|$)/g,
    (_, inner) => placeholder(inner, true));

  // Inline math: \(…\)
  text = text.replace(/\\\(([\s\S]*?)(?:\\\)|$)/g,
    (_, inner) => placeholder(inner, false));

  // Inline math: $…$ — single line, max 500 chars, no newlines   [F06]
  text = text.replace(/\$([^\$\n]{1,500}?)\$/g,
    (_, inner) => placeholder(inner, false));

  return { text, math };
}

/* ────────────────────────────────────────────────────────────────
   Inline formatter
   Operates on a single line after HTML-escaping.
   ──────────────────────────────────────────────────────────────── */
function _fmt(line, math) {
  let s = _he(line);

  // Allow literal <br> from source
  s = s.replace(/&lt;br&gt;/gi, '<br>');

  // Inline code  (must come before bold/italic so backticks win)
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${_esc(c)}</code>`);

  // Bold
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');

  // Italic: strip single * (not semantically rendered, just cleaned)
  s = s.replace(/\*([^*\n]+?)\*/g, '$1');
  // Remove residual lone asterisks
  s = s.replace(/(?<!\*)\*(?!\*)/g, '');

  // Markdown links [text](url)                                    [F13]
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const trimmed = url.trim();
    const safe = /^https?:\/\//i.test(trimmed) &&
                 !/^(javascript|data|vbscript):/i.test(trimmed)
      ? trimmed : '#';
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Restore math placeholders                                     [F14]
  s = s.replace(/\x00M(\d+)\x00/g, (_, i) => {
    const idx = +i;
    if (!math || idx >= math.length) return '';
    const { inner, display } = math[idx];
    const html = _katexRender(inner, display);
    return display
      ? `</p><div class="math-display-block">${html}</div><p>`
      : html;
  });

  return s;
}

/* ────────────────────────────────────────────────────────────────
   Syntax highlighter
   ──────────────────────────────────────────────────────────────── */

const _RX = {
  jsKw:        /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|super|import|export|default|from|async|await|try|catch|finally|throw|yield|static|get|set|this)\b/g,
  dartKw:      /\b(void|final|late|required|abstract|implements|mixin|with|extension|typedef|enum|factory|operator|covariant|external|dynamic|const|var|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|import|export|async|await|try|catch|finally|throw|yield|static|get|set|this|in|is|as|null|true|false)\b/g,
  jsBool:      /\b(true|false|null|undefined|NaN|Infinity)\b/g,
  pyKw:        /\b(def|class|return|if|elif|else|for|while|in|not|and|or|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|global|nonlocal|del|assert|is|True|False|None)\b/g,
  dqStr:       /"(?:[^"\\]|\\.)*"/g,
  // [F05] sqStr: require 2+ chars so lone apostrophes in prose are untouched
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

function _resetRx() {
  for (const r of Object.values(_RX)) r.lastIndex = 0;
}

function syntaxHighlight(code, lang) {
  if (!code) return '<div class="code-lines"></div>';  // [F15]
  const l     = (lang || '').toLowerCase();
  const lines = code.split('\n');
  let out     = '';

  for (let i = 0; i < lines.length; i++) {
    const content = _tokenizeLine(lines[i], l);
    out += `<div class="code-line"><span class="code-line-num">${i + 1}</span><span class="code-line-content">${content}</span></div>`;
  }

  return `<div class="code-lines">${out}</div>`;
}

function _tokenizeLine(line, lang) {
  _resetRx();

  const ph      = [];
  const protect = html => { ph.push(html); return `\x01${ph.length - 1}\x01`; };
  const span    = (cls, text) => protect(`<span class="${cls}">${_esc(text)}</span>`);

  let s = line;

  s = s.replace(_RX.blockComment, m => span('tk-cmt', m));

  const hashLangs = ['python', 'py', 'bash', 'sh', 'yaml', 'yml', 'ruby', 'rb', 'r'];
  if (hashLangs.includes(lang)) {
    s = s.replace(_RX.hashComment, m => span('tk-cmt', m));
  } else {
    s = s.replace(_RX.lineComment, m => span('tk-cmt', m));
  }

  s = s.replace(_RX.btStr,  m => span('tk-str', m));
  s = s.replace(_RX.dqStr,  m => span('tk-str', m));
  s = s.replace(_RX.sqStr,  m => span('tk-str', m));

  s = _esc(s);

  s = s.replace(_RX.numLit,  m => protect(`<span class="tk-num">${m}</span>`));
  s = s.replace(_RX.clsName, (_, p) => protect(`<span class="tk-cls">${p}</span>`));
  s = s.replace(_RX.fnCall,  (_, p) => protect(`<span class="tk-fn">${p}</span>`));

  if (lang === 'python' || lang === 'py') {
    s = s.replace(_RX.pyKw,   m => protect(`<span class="tk-kw">${m}</span>`));
  } else if (lang === 'dart') {
    s = s.replace(_RX.dartKw, m => protect(`<span class="tk-kw">${m}</span>`));
  } else {
    s = s.replace(_RX.jsKw,   m => protect(`<span class="tk-kw">${m}</span>`));
  }

  s = s.replace(_RX.jsBool,  m => protect(`<span class="tk-bool">${m}</span>`));
  s = s.replace(_RX.propKey, (_, p) => protect(`<span class="tk-prop">${p}</span>`));

  s = s.replace(/\x01(\d+)\x01/g, (_, i) => ph[+i]);

  return s || ' ';
}

/* ────────────────────────────────────────────────────────────────
   Heading level map
   #  / ##    → h3
   ###        → h4
   ####       → h5
   ──────────────────────────────────────────────────────────────── */
const _HEADING_TAG = { 1: 'h3', 2: 'h3', 3: 'h4', 4: 'h5' };

/* ────────────────────────────────────────────────────────────────
   renderMarkdown(rawText) → HTML string

   Pipeline:
     0. Guard empty input
     1. Normalize line endings (CRLF / CR → LF)            [F01]
     2. Normalize headings                                  [F18]
     3. Pre-process: insert blank lines around heading      [F04]
        lines so single-\n headings become their own blocks
     4. Strip junk-only lines
     5. Extract code blocks                                 [F17]
     6. Extract math placeholders
     7. Split mixed pipe/prose paragraphs
     8. Render each paragraph block
   ──────────────────────────────────────────────────────────────── */
function renderMarkdown(rawText) {

  /* ── Step 0: empty / whitespace guard ── */               // [F16]
  if (!rawText || !rawText.trim()) return '';

  /* ── Step 1: normalize newlines ── */                     // [F01]
  let text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  /* ── Step 2: normalize headings ── */                     // [F18]
  // ##### / ###### → ####
  text = text.replace(/^#{5,}\s*\**\s*(.+?)\**\s*$/gm, '#### $1');
  // #### → ####
  text = text.replace(/^#{4}\s*\**\s*(.+?)\**\s*$/gm,  '#### $1');
  // ### → ###
  text = text.replace(/^#{3}\s*\**\s*(.+?)\**\s*$/gm,  '### $1');
  // ## → ##
  text = text.replace(/^#{2}\s+(.+)$/gm,                '## $1');
  // # → ##  (same visual level in this app)
  text = text.replace(/^#\s+(.+)$/gm,                   '## $1');

  /* ── Step 3: ensure headings get their own paragraph block ── */ // [F04]
  // Insert blank lines before and after every heading line
  // so that paragraph split on \n\n always isolates them.
  text = text.replace(/^(#{2,4} .+)$/gm, '\n\n$1\n\n');
  // Collapse 3+ blank lines → 2 (one blank line)
  text = text.replace(/\n{3,}/g, '\n\n');

  /* ── Step 4: strip document-level junk ── */
  text = text
    .replace(/^-{3,}\s*$/gm, '')       // --- dividers
    .replace(/^\*{2}\s*$/gm, '')        // lone **
    .replace(/^\*([^*\n]+)\*$/gm, '$1'); // lone *text* line → text

  /* ── Step 5: extract code blocks ── */                    // [F17]
  const codeBlocks = [];
  // Handle both closed (```) and unclosed (streaming) fences
  text = text.replace(/```(\w*)\r?\n?([\s\S]*?)(?:```|$)/g, (_, lang, code) => {
    codeBlocks.push({ lang: lang.trim(), code: code.trimEnd() });
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  });

  /* ── Step 6: extract math placeholders ── */
  const { text: mathText, math } = _extractMath(text);
  text = mathText;

  /* ── Step 7: split paragraphs that mix pipe rows and prose ── */
  const isPipeLine = l => (l.match(/\|/g) || []).length >= 2;

  text = text.split('\n\n').map(block => {
    const lines   = block.split('\n');
    const hasPipe = lines.some(isPipeLine);
    const allPipe = lines.filter(l => l.trim()).every(isPipeLine);

    if (!hasPipe || allPipe) return block;

    let out      = '';
    let tableBuf = [];
    let proseBuf = [];

    const flushProse = () => {
      if (proseBuf.length) { out += proseBuf.join('\n') + '\n\n'; proseBuf = []; }
    };
    const flushTable = () => {
      if (tableBuf.length) { out += tableBuf.join('\n') + '\n\n'; tableBuf = []; }
    };

    for (const line of lines) {
      if (isPipeLine(line)) { flushProse(); tableBuf.push(line); }
      else                  { flushTable(); proseBuf.push(line); }
    }
    flushProse();
    flushTable();
    return out.trim();
  }).join('\n\n');

  /* ── Step 8: render each paragraph block ── */
  const html = text.split('\n\n').map(block => {
    const t = block.trim();
    if (!t) return '';

    /* Code block placeholder */
    const codeMatch = t.match(/^\x00CODE(\d+)\x00$/);
    if (codeMatch) {
      const { lang, code } = codeBlocks[+codeMatch[1]];
      const langLabel   = lang || 'code';
      const highlighted = syntaxHighlight(code, lang);
      const blockId     = 'cb' + Math.random().toString(36).slice(2, 8);
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
          `<pre>${highlighted}</pre>` +
        `</div>`
      );
    }

    /* Standalone display-math placeholder */
    const mathOnlyMatch = t.match(/^\x00M(\d+)\x00$/);
    if (mathOnlyMatch) {
      const idx = +mathOnlyMatch[1];
      if (idx < math.length) {
        const { inner, display } = math[idx];
        return display
          ? `<div class="math-display-block">${_katexRender(inner, true)}</div>`
          : `<p>${_katexRender(inner, false)}</p>`;
      }
      return '';
    }

    /* ATX Headings */
    const headingMatch = t.match(/^(#{2,4}) ([\s\S]+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const tag   = _HEADING_TAG[level] || 'h4';
      // Strip any residual # that LLMs sometimes leave (e.g. "### # 🔥 text")
      const headText = headingMatch[2].replace(/^#+\s*/, '');
      return `<${tag}>${_fmt(headText, math)}</${tag}>`;
    }

    /* Markdown table */
    if (/^\|.+\|/m.test(t)) {
      // [F10] Filter separator rows: lines whose non-pipe content is only dashes/colons/spaces
      const rows = t.split('\n').filter(r => {
        if (!r.trim()) return false;
        // A separator row looks like |---|:--:|---|
        const inner = r.replace(/^\||\|$/g, '');
        return !/^[\s|:\-]+$/.test(inner);
      });
      if (rows.length >= 1) {
        const parseRow = r =>
          r.replace(/^\||\|$/g, '').split('|').map(c => _fmt(c.trim(), math));

        const [header, ...body] = rows;
        const hCells = parseRow(header).map(c => `<th>${c}</th>`).join('');
        const bRows  = body
          .map(r => `<tr>${parseRow(r).map(c => `<td>${c}</td>`).join('')}</tr>`)
          .join('');

        return (
          `<div class="table-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;">` +
            `<table><thead><tr>${hCells}</tr></thead><tbody>${bRows}</tbody></table>` +
          `</div>`
        );
      }
    }

    /* Unordered list */
    if (/^[-*•] /m.test(t)) {
      const items = t.split('\n')
        .filter(Boolean)
        .map(l => `<li>${_fmt(l.replace(/^[-*•] /, ''), math)}</li>`)
        .join('');
      return `<ul>${items}</ul>`;
    }

    /* Ordered list */                                        // [F09]
    if (/^\d+[.)]\s/m.test(t)) {
      const items = t.split('\n')
        .filter(Boolean)
        .map(l => `<li>${_fmt(l.replace(/^\d+[.)]\s/, ''), math)}</li>`)
        .join('');
      return `<ol>${items}</ol>`;
    }

    /* Paragraph (default) */
    const lineHtml = t.split('\n').map(line => {
      const lt = line.trim();
      if (/^\x00M\d+\x00$/.test(lt)) {
        const idx = +lt.match(/\x00M(\d+)\x00/)[1];
        if (idx < math.length) {
          const { inner, display } = math[idx];
          if (display) {
            return `</p><div class="math-display-block">${_katexRender(inner, true)}</div><p>`;
          }
        }
      }
      return _fmt(line, math);
    });

    const inner = lineHtml.join('<br>')
      .replace(/<br><\/p>/g, '</p>')
      .replace(/<p><br>/g,   '<p>');

    return `<p>${inner}</p>`;
  }).join('');

  return html;
}

/* renderMathBubble — retained for call-site compatibility */  // [F19]
function renderMathBubble(_el) {}
