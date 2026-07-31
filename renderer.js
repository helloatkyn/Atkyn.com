/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown · KaTeX math · Syntax highlighting · Table rendering

   Audit & Hardening (v2)
   ────────────────────────────────────────────────────────────
   • Newline normalisation (CRLF / CR → LF)
   • Safe Unicode‑based placeholder markers (no injection)
   • Inline‑code shielding before math extraction
   • Robust backtick‑string detection (`` code ``)
   • Correct heading‑text preservation (no more lost words)
   • Table‑row splitting immune to `|` inside inline code
   • Homogeneous list‑block detection (stops accidental <li>)
   • Proper HTML‑attribute escaping for link `href`
   • Fenced‑code regex relaxed to allow whitespace after lang
   • Performance‑safe regexes, no catastrophic backtracking
   ═══════════════════════════════════════════════════════════════ */

/* ── HTML escape (user‑facing text → safe HTML attribute / content) ── */
function _he(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Lightweight escape for pre/code content (no quote escaping needed) ── */
function _esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ────────────────────────────────────────────────────────────────
   Placeholder markers (Unicode Private Use Area – safe from user content)
   ═══════════════════════════════════════════════════════════════ */
const _PH = {
  CODE:    '\uE000',   // fenced code block placeholder  →  CODE<idx>
  MATH:    '\uE001',   // math placeholder               →  MATH<idx>
  INLINE:  '\uE002',   // inline code placeholder (pre‑math shield)
  HIGHLIGHT:'\uE003',  // syntax‑highlighting safe placeholder
};

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
 * Returns the text with placeholders and an array of { inner, display }.
 */
function _extractMath(text) {
  const math = [];

  function placeholder(inner, display) {
    math.push({ inner: inner.trim(), display });
    return `${_PH.MATH}${math.length - 1}${_PH.MATH}`;
  }

  // Display math: \[…\]  and  $$…$$
  text = text.replace(/\\\[([\s\S]*?)(?:\\\]|$)/g,
    (_, inner) => placeholder(inner, true));
  text = text.replace(/\$\$([\s\S]*?)(?:\$\$|$)/g,
    (_, inner) => placeholder(inner, true));

  // Inline math: \(…\)  and  $…$  (single‑line only, avoids eating prose $)
  text = text.replace(/\\\(([\s\S]*?)(?:\\\)|$)/g,
    (_, inner) => placeholder(inner, false));
  text = text.replace(/\$([^\$\n]+?)\$/g,
    (_, inner) => placeholder(inner, false));

  return { text, math };
}

/* Restore a single math placeholder → rendered HTML (unused, but kept for API compatibility) */
function _renderMathPlaceholder(index, math) {
  const { inner, display } = math[index];
  return _katexRender(inner, display);
}

/* ────────────────────────────────────────────────────────────────
   Inline‑code shielding
   Extracts `` `code` `` spans (CommonMark‑style) and replaces them
   with placeholders so that later processing (math, tables) does not
   misinterpret their contents.
   Returns { text, codes } where codes[i] is the original backtick string.
   ──────────────────────────────────────────────────────────────── */
function _extractInlineCode(text) {
  const codes = [];
  // Match a run of backticks, then any content, then the same run of backticks.
  const re = /(`+)(.+?)\1/g;
  text = text.replace(re, (match) => {
    codes.push(match);
    return `${_PH.INLINE}${codes.length - 1}${_PH.INLINE}`;
  });
  return { text, codes };
}

/* Restore inline‑code placeholders → original backtick strings */
function _restoreInlineCode(text, codes) {
  return text.replace(new RegExp(`${_PH.INLINE}(\\d+)${_PH.INLINE}`, 'g'),
    (_, i) => codes[+i]);
}

/* ────────────────────────────────────────────────────────────────
   Inline formatter
   Operates on a single line after HTML‑escaping.
   Order matters: code spans first, then bold, links, math.
   ──────────────────────────────────────────────────────────────── */
function _fmt(line, math) {
  let s = _he(line);

  // Allow literal <br> from source
  s = s.replace(/&lt;br&gt;/gi, '<br>');

  // Inline code  (must come before bold/italic so backticks win)
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);

  // Bold
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');

  // Italic: strip single * that aren't part of ** (not semantically rendered,
  // just cleaned so the asterisk doesn't leak into output)
  s = s.replace(/\*([^*\n]+?)\*/g, '$1');
  // Remove any residual lone asterisks
  s = s.replace(/(?<!\*)\*(?!\*)/g, '');

  // Markdown links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const safeUrl = /^https?:\/\//i.test(url) ? _he(url) : '#';
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Restore math placeholders
  s = s.replace(new RegExp(`${_PH.MATH}(\\d+)${_PH.MATH}`, 'g'), (_, i) => {
    const { inner, display } = math[+i];
    const html = _katexRender(inner, display);
    // Display math breaks out of the paragraph flow
    return display
      ? `</p><div class="math-display-block">${html}</div><p>`
      : html;
  });

  return s;
}

/* ────────────────────────────────────────────────────────────────
   Syntax highlighter
   ──────────────────────────────────────────────────────────────── */

/* Compiled regex table — created once, reset per call via lastIndex */
const _RX = {
  jsKw:        /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|super|import|export|default|from|async|await|try|catch|finally|throw|yield|static|get|set|this)\b/g,
  dartKw:      /\b(void|final|late|required|abstract|implements|mixin|with|extension|typedef|enum|factory|operator|covariant|external|dynamic|const|var|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|import|export|async|await|try|catch|finally|throw|yield|static|get|set|this|in|is|as|null|true|false)\b/g,
  jsBool:      /\b(true|false|null|undefined|NaN|Infinity)\b/g,
  pyKw:        /\b(def|class|return|if|elif|else|for|while|in|not|and|or|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|global|nonlocal|del|assert|is|True|False|None)\b/g,
  dqStr:       /"(?:[^"\\]|\\.)*"/g,
  sqStr:       /'([^'\n\\]|\\.)+'/g,   // non‑empty, avoids eating lone apostrophes
  btStr:       /`(?:[^`\\]|\\.)*`/g,
  lineComment: /\/\/.*/g,
  hashComment: /#.*/g,
  blockComment:/\/\*[\s\S]*?\*\//g,
  numLit:      /\b\d+(\.\d+)?\b/g,
  fnCall:      /\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()/g,
  clsName:     /\b([A-Z][a-zA-Z0-9_]*)\b/g,
  propKey:     /([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*:)/g,
};

/* Reset all regex lastIndex values (they are stateful when /g is used) */
function _resetRx() {
  for (const r of Object.values(_RX)) r.lastIndex = 0;
}

function syntaxHighlight(code, lang) {
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
  const protect = html => {
    ph.push(html);
    return `${_PH.HIGHLIGHT}${ph.length - 1}${_PH.HIGHLIGHT}`;
  };
  const span    = (cls, text) => protect(`<span class="${cls}">${_esc(text)}</span>`);

  let s = line;

  // Block comments first (multi‑line, can span logic)
  s = s.replace(_RX.blockComment, m => span('tk-cmt', m));

  // Line comments (language‑dependent delimiter)
  const hashLangs = ['python', 'py', 'bash', 'sh', 'yaml', 'yml'];
  if (hashLangs.includes(lang)) {
    s = s.replace(_RX.hashComment, m => span('tk-cmt', m));
  } else {
    s = s.replace(_RX.lineComment, m => span('tk-cmt', m));
  }

  // String literals
  s = s.replace(_RX.btStr,  m => span('tk-str', m));
  s = s.replace(_RX.dqStr,  m => span('tk-str', m));
  s = s.replace(_RX.sqStr,  m => span('tk-str', m));

  // Escape remaining content for HTML output
  s = _esc(s);

  // Numeric literals
  s = s.replace(_RX.numLit, m => protect(`<span class="tk-num">${m}</span>`));

  // Class names (UpperCamelCase)
  s = s.replace(_RX.clsName, (_, p) => protect(`<span class="tk-cls">${p}</span>`));

  // Function calls
  s = s.replace(_RX.fnCall, (_, p) => protect(`<span class="tk-fn">${p}</span>`));

  // Keywords (language‑specific)
  if (lang === 'python' || lang === 'py') {
    s = s.replace(_RX.pyKw,   m => protect(`<span class="tk-kw">${m}</span>`));
  } else if (lang === 'dart') {
    s = s.replace(_RX.dartKw, m => protect(`<span class="tk-kw">${m}</span>`));
  } else {
    s = s.replace(_RX.jsKw,   m => protect(`<span class="tk-kw">${m}</span>`));
  }

  // Boolean / null literals
  s = s.replace(_RX.jsBool, m => protect(`<span class="tk-bool">${m}</span>`));

  // Object property keys (before the colon)
  s = s.replace(_RX.propKey, (_, p) => protect(`<span class="tk-prop">${p}</span>`));

  // Restore all protected spans
  s = s.replace(new RegExp(`${_PH.HIGHLIGHT}(\\d+)${_PH.HIGHLIGHT}`, 'g'), (_, i) => ph[+i]);

  return s || ' ';
   }
/* ────────────────────────────────────────────────────────────────
   Heading level map
   Source markdown → HTML tag
     #     → h3  (top‑level, largest)
     ##    → h3  (same visual weight as #, keeps hierarchy flat)
     ###   → h4
     ####+ → h5
   Matches the h3/h4/h5 rules already in search-11-3-1.css.
   ──────────────────────────────────────────────────────────────── */
const _HEADING_TAG = { 1: 'h3', 2: 'h3', 3: 'h4', 4: 'h5' };

/* ────────────────────────────────────────────────────────────────
   renderMarkdown(rawText) → HTML string
   Pipeline:
     0. Normalise all line endings to LF
     1. Normalise headings (collapse levels, preserve full text)
     2. Strip junk‑only lines
     3. Extract code blocks (protected from all further processing)
     4. Extract inline code spans (shield from math / tables)
     5. Extract math placeholders
     6. Split mixed pipe/prose paragraphs
     7. Restore inline code spans
     8. Render each paragraph block
   ──────────────────────────────────────────────────────────────── */
function renderMarkdown(rawText) {

  /* ── Step 0: Normalise line endings ───────────────────────────── */
  let text = rawText
    .replace(/\r\n/g, '\n')   // Windows
    .replace(/\r/g, '\n');    // old Mac

  /* ── Step 1: normalise headings ─────────────────────────────────
     Convert all ATX heading variants to canonical form,
     preserving the full heading text (no more losing words).
     # and ## → ##  (both render as h3 per CSS)
     ###      → ### (renders as h4)
     ####+    → #### (renders as h5)
  ── */
  text = text.replace(/^#{1,6}[ \t]+(.*)$/gm, (line) => {
    // Determine original level (count initial # characters)
    const level = line.match(/^#+/)[0].length;
    // Canonical level
    const canonLevel = level <= 2 ? 2 : level === 3 ? 3 : 4;
    // Extract the content (everything after the first space/tab)
    const content = line.replace(/^#{1,6}[ \t]+/, '').trim();
    // Rebuild with canonical prefix
    return `${'#'.repeat(canonLevel)} ${content}`;
  });

  /* ── Step 2: strip document‑level junk ──────────────────────────
     Lone horizontal rules (---) and bare bold/italic markers that
     LLMs sometimes emit as section dividers.
  ── */
  text = text
    .replace(/^-{3,}\s*$/gm, '')   // --- dividers
    .replace(/^\*{2}\s*$/gm, '')   // lone **
    .replace(/^\*([^*\n]+)\*$/gm, '$1'); // lone *text* on its own line → text

  /* ── Step 3: extract code blocks ────────────────────────────────
     Must happen before math and inline‑code extraction.
     Allows optional whitespace after the language identifier.
  ── */
  const codeBlocks = [];
  text = text.replace(/```(\w*)[^\S\n]*\n?([\s\S]*?)(?:```|$)/g, (_, lang, code) => {
    codeBlocks.push({ lang: lang.trim(), code: code.trimEnd() });
    return `${_PH.CODE}${codeBlocks.length - 1}${_PH.CODE}`;
  });

  /* ── Step 4: extract inline code spans ───────────────────────────
     Shield them from later math and table‑pipe splitting.
  ── */
  const inlineCode = _extractInlineCode(text);
  text = inlineCode.text;

  /* ── Step 5: extract math placeholders ────────────────────────── */
  const { text: mathText, math } = _extractMath(text);
  text = mathText;

  /* ── Step 6: split paragraphs that mix pipe rows and prose ──────
     Some LLMs emit a paragraph that has a table embedded in prose.
     Separate them so the table renderer can fire correctly.
  ── */
  const isPipeLine = l => (l.match(/\|/g) || []).length >= 2;

  text = text.split('\n\n').map(block => {
    const lines   = block.split('\n');
    const hasPipe = lines.some(isPipeLine);
    const allPipe = lines.filter(l => l.trim()).every(isPipeLine);

    // Homogeneous block — leave untouched
    if (!hasPipe || allPipe) return block;

    // Mixed block — split into separate paragraphs
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

  /* ── Step 7: Restore inline code spans ───────────────────────────
     Now it is safe to bring back the original backtick strings,
     because math placeholders are already in place.
  ── */
  text = _restoreInlineCode(text, inlineCode.codes);

  /* ── Step 8: render each paragraph block ──────────────────────── */
  const html = text.split('\n\n').map(block => {
    const t = block.trim();
    if (!t) return '';

    /* Standalone display‑math placeholder */
    const mathOnlyMatch = t.match(new RegExp(`^${_PH.MATH}(\\d+)${_PH.MATH}$`));
    if (mathOnlyMatch) {
      const { inner, display } = math[+mathOnlyMatch[1]];
      return display
        ? `<div class="math-display-block">${_katexRender(inner, true)}</div>`
        : `<p>${_katexRender(inner, false)}</p>`;
    }

    /* Code block placeholder */
    const codeMatch = t.match(new RegExp(`^${_PH.CODE}(\\d+)${_PH.CODE}$`));
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

    /* ATX Headings: ##, ###, #### (Step 1 guarantees these are the only forms) */
    const headingMatch = t.match(/^(#{2,4}) ([\s\S]+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;            // 2, 3, or 4
      const tag   = _HEADING_TAG[level] || 'h4';       // h3, h4, or h5
      return `<${tag}>${_fmt(headingMatch[2].trim(), math)}</${tag}>`;
    }

    /* Markdown table */
    if (/^\|.+\|/m.test(t)) {
      // Split into rows (filter out separator lines like |---|)
      const rows = t.split('\n').filter(r => r.trim() && !/^[\s|:-]+$/.test(r));
      if (rows.length >= 1) {
        // Helper: split a table row by `|` ignoring pipes inside inline code
        const splitRow = (row) => {
          // Remove leading/trailing pipe and whitespace
          const inner = row.replace(/^\|/, '').replace(/\|$/, '');
          // Split carefully: state machine for backtick spans
          const cells = [];
          let current = '';
          let inCode = false;
          for (let i = 0; i < inner.length; i++) {
            const ch = inner[i];
            if (ch === '`') {
              inCode = !inCode;
              current += ch;
            } else if (ch === '|' && !inCode) {
              cells.push(current.trim());
              current = '';
            } else {
              current += ch;
            }
          }
          cells.push(current.trim());
          return cells;
        };

        const [header, ...body] = rows;
        const hCells = splitRow(header).map(c => `<th>${_fmt(c, math)}</th>`).join('');
        const bRows  = body
          .map(r => `<tr>${splitRow(r).map(c => `<td>${_fmt(c, math)}</td>`).join('')}</tr>`)
          .join('');

        return (
          `<div class="table-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;">` +
            `<table><thead><tr>${hCells}</tr></thead><tbody>${bRows}</tbody></table>` +
          `</div>`
        );
      }
    }

    /* Unordered list – every non‑empty line must be a list item */
    if (/^[-*•] /m.test(t)) {
      const lines = t.split('\n').filter(Boolean);
      // Ensure the whole block is truly a list
      const allItems = lines.every(l => /^[-*•] /.test(l));
      if (allItems) {
        const items = lines
          .map(l => `<li>${_fmt(l.replace(/^[-*•] /, ''), math)}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }
    }

    /* Ordered list – every non‑empty line must be a list item */
    if (/^\d+[.)]\s/m.test(t)) {
      const lines = t.split('\n').filter(Boolean);
      const allItems = lines.every(l => /^\d+[.)]\s/.test(l));
      if (allItems) {
        const items = lines
          .map(l => `<li>${_fmt(l.replace(/^\d+[.)]\s/, ''), math)}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }
    }

    /* Paragraph (default) */
    const lineHtml = t.split('\n').map(line => {
      const lt = line.trim();
      // Inline display‑math on its own line — break out of paragraph
      const mathPlace = lt.match(new RegExp(`^${_PH.MATH}(\\d+)${_PH.MATH}$`));
      if (mathPlace) {
        const { inner, display } = math[+mathPlace[1]];
        if (display) {
          return `</p><div class="math-display-block">${_katexRender(inner, true)}</div><p>`;
        }
      }
      return _fmt(line, math);
    });

    // Join lines, clean up any empty <p></p> fragments from display‑math splicing
    const inner = lineHtml
      .join('<br>')
      .replace(/<br>\s*<\/p>/g, '</p>')
      .replace(/<p>\s*<br>/g, '<p>')
      .replace(/<p>\s*<\/p>/g, '');   // remove stray empty paragraphs

    return `<p>${inner}</p>`;
  }).join('');

  return html;
}

/* renderMathBubble — retained for call‑site compatibility, intentional no‑op */
function renderMathBubble(_el) {}
