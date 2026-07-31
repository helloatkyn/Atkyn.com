/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown · KaTeX math · Syntax highlighting · Table rendering

   Audit & Hardening (v4) – Block‑aware tokenizer
   ────────────────────────────────────────────────────────────
   • Newline normalisation (CRLF / CR → LF)
   • Safe Unicode‑based placeholder markers
   • Inline‑code shielding before math extraction
   • Robust backtick‑string detection (`` code ``, multiline, empty)
   • Heading normalisation with leading whitespace tolerance
   • Table rows detected by start/end pipe or multiple pipes
   • Homogeneous list‑block detection
   • Proper HTML‑attribute escaping for link `href`
   • Fenced‑code regex relaxed
   • Ordered lists use <ol>
   • Block tokenizer (no longer dependent on blank‑line splits)
   • Malformed tables fallback silently
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
  CODE:    '\uE000',   // fenced code block placeholder
  MATH:    '\uE001',   // math placeholder
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

/* Restore a single math placeholder → rendered HTML (kept for API compatibility) */
function _renderMathPlaceholder(index, math) {
  const { inner, display } = math[index];
  return _katexRender(inner, display);
}

/* ────────────────────────────────────────────────────────────────
   Inline‑code shielding (CommonMark‑compliant backtick runs)
   Extracts `` `code` `` spans, supports multiline and empty content.
   Returns { text, codes }.
   ──────────────────────────────────────────────────────────────── */
function _extractInlineCode(text) {
  const codes = [];
  const re = /(`+)([\s\S]*?)\1/g;
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
   Order: code spans → bold → italic cleaning → links → math restore.
   ──────────────────────────────────────────────────────────────── */
function _fmt(line, math) {
  let s = _he(line);

  s = s.replace(/&lt;br&gt;/gi, '<br>');

  // Inline code
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);

  // Bold
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');

  // Italic strip (see design note in code)
  s = s.replace(/\*([^*\n]+?)\*/g, '$1');
  s = s.replace(/(?<!\*)\*(?!\*)/g, '');

  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const safeUrl = /^https?:\/\//i.test(url) ? _he(url) : '#';
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Math placeholders
  s = s.replace(new RegExp(`${_PH.MATH}(\\d+)${_PH.MATH}`, 'g'), (_, i) => {
    const { inner, display } = math[+i];
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
  sqStr:       /'([^'\n\\]|\\.)+'/g,
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

  s = s.replace(_RX.blockComment, m => span('tk-cmt', m));

  const hashLangs = ['python', 'py', 'bash', 'sh', 'yaml', 'yml'];
  if (hashLangs.includes(lang)) {
    s = s.replace(_RX.hashComment, m => span('tk-cmt', m));
  } else {
    s = s.replace(_RX.lineComment, m => span('tk-cmt', m));
  }

  s = s.replace(_RX.btStr,  m => span('tk-str', m));
  s = s.replace(_RX.dqStr,  m => span('tk-str', m));
  s = s.replace(_RX.sqStr,  m => span('tk-str', m));

  s = _esc(s);

  s = s.replace(_RX.numLit, m => protect(`<span class="tk-num">${m}</span>`));
  s = s.replace(_RX.clsName, (_, p) => protect(`<span class="tk-cls">${p}</span>`));
  s = s.replace(_RX.fnCall, (_, p) => protect(`<span class="tk-fn">${p}</span>`));

  if (lang === 'python' || lang === 'py') {
    s = s.replace(_RX.pyKw,   m => protect(`<span class="tk-kw">${m}</span>`));
  } else if (lang === 'dart') {
    s = s.replace(_RX.dartKw, m => protect(`<span class="tk-kw">${m}</span>`));
  } else {
    s = s.replace(_RX.jsKw,   m => protect(`<span class="tk-kw">${m}</span>`));
  }

  s = s.replace(_RX.jsBool, m => protect(`<span class="tk-bool">${m}</span>`));
  s = s.replace(_RX.propKey, (_, p) => protect(`<span class="tk-prop">${p}</span>`));

  s = s.replace(new RegExp(`${_PH.HIGHLIGHT}(\\d+)${_PH.HIGHLIGHT}`, 'g'), (_, i) => ph[+i]);

  return s || ' ';
}
/* ────────────────────────────────────────────────────────────────
   Heading level map  (# → h3, ## → h3, ### → h4, ####+ → h5)
   ──────────────────────────────────────────────────────────────── */
const _HEADING_TAG = { 1: 'h3', 2: 'h3', 3: 'h4', 4: 'h5' };

/* ────────────────────────────────────────────────────────────────
   Block tokenizer
   Splits text into homogeneous blocks without relying on blank lines.
   Recognises headings, tables (line‑based), lists, code/math placeholders.
   ═─────────────────────────────────────────────────────────────── */
function _isCodePlaceholder(line) {
  return new RegExp(`^${_PH.CODE}\\d+${_PH.CODE}$`).test(line.trim());
}
function _isMathPlaceholder(line) {
  return new RegExp(`^${_PH.MATH}\\d+${_PH.MATH}$`).test(line.trim());
}
function _isHeadingLine(line) {
  return /^#{2,4} /.test(line.trim());
}
function _isUnorderedListItem(line) {
  return /^[-*•] /.test(line.trim());
}
function _isOrderedListItem(line) {
  return /^\d+[.)] /.test(line.trim());
}
function _isListItem(line) {
  return _isUnorderedListItem(line) || _isOrderedListItem(line);
}
/* A line is part of a table if it starts or ends with `|` or contains ≥2 pipes. */
function _isTableLine(line) {
  const t = line.trim();
  return t.startsWith('|') || t.endsWith('|') || (t.match(/\|/g) || []).length >= 2;
}

function _splitBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let curType = null;
  let curLines = [];

  const push = () => {
    if (curLines.length > 0) {
      blocks.push(curLines.join('\n'));
      curLines = [];
    }
    curType = null;
  };

  for (const line of lines) {
    const trim = line.trim();
    if (trim === '') {
      push();
      continue;
    }

    let lineType;
    if (_isCodePlaceholder(line))      lineType = 'code';
    else if (_isMathPlaceholder(line)) lineType = 'math';
    else if (_isHeadingLine(line))     lineType = 'heading';
    else if (_isTableLine(line))       lineType = 'table';
    else if (_isListItem(line))        lineType = 'list';
    else                               lineType = 'paragraph';

    if (curType !== null && curType !== lineType) {
      push();
    }
    if (curType === null) curType = lineType;
    curLines.push(line);
  }
  push();
  return blocks;
}

/* ────────────────────────────────────────────────────────────────
   renderMarkdown(rawText) → HTML string
   Pipeline:
     0. Normalise line endings
     1. Normalise headings (strip leading spaces, collapse level)
     2. Strip junk lines
     3. Extract fenced code blocks (→ placeholders)
     4. Extract inline code spans (shield from math / tables)
     5. Extract math placeholders
     6. Restore inline code spans
     7. Split into homogeneous blocks with _splitBlocks()
     8. Render each block
   ═─────────────────────────────────────────────────────────────── */
function renderMarkdown(rawText) {

  /* 0. Normalise line endings */
  let text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  /* 1. Normalise headings */
  text = text.replace(/^[ \t]*#{1,6}[ \t]+(.*)$/gm, (line) => {
    const levelMatch = line.match(/^[ \t]*(#{1,6})/);
    const level = levelMatch ? levelMatch[1].length : 1;
    const canonLevel = level <= 2 ? 2 : level === 3 ? 3 : 4;
    const content = line.replace(/^[ \t]*#{1,6}[ \t]+/, '').trim().replace(/\s+/g, ' ');
    return `${'#'.repeat(canonLevel)} ${content}`;
  });

  /* 2. Strip document‑level junk */
  text = text
    .replace(/^-{3,}\s*$/gm, '')
    .replace(/^\*{2}\s*$/gm, '')
    .replace(/^\*([^*\n]+)\*$/gm, '$1');

  /* 3. Extract fenced code blocks */
  const codeBlocks = [];
  text = text.replace(/```(\w*)[^\S\n]*\n?([\s\S]*?)(?:```|$)/g, (_, lang, code) => {
    codeBlocks.push({ lang: lang.trim(), code: code.trimEnd() });
    return `${_PH.CODE}${codeBlocks.length - 1}${_PH.CODE}`;
  });

  /* 4. Extract inline code spans */
  const inlineCode = _extractInlineCode(text);
  text = inlineCode.text;

  /* 5. Extract math */
  const { text: mathText, math } = _extractMath(text);
  text = mathText;

  /* 6. Restore inline code (math placeholders now safe) */
  text = _restoreInlineCode(text, inlineCode.codes);

  /* 7. Block tokenization */
  const blocks = _splitBlocks(text);

  /* 8. Render each block */
  const html = blocks.map(block => {
    const t = block.trim();
    if (!t) return '';

    /* Standalone display‑math placeholder */
    const mathOnly = t.match(new RegExp(`^${_PH.MATH}(\\d+)${_PH.MATH}$`));
    if (mathOnly) {
      const { inner, display } = math[+mathOnly[1]];
      return display
        ? `<div class="math-display-block">${_katexRender(inner, true)}</div>`
        : `<p>${_katexRender(inner, false)}</p>`;
    }

    /* Fenced code placeholder */
    const codeMatch = t.match(new RegExp(`^${_PH.CODE}(\\d+)${_PH.CODE}$`));
    if (codeMatch) {
      const { lang, code } = codeBlocks[+codeMatch[1]];
      const langLabel = lang || 'code';
      const highlighted = syntaxHighlight(code, lang);
      const blockId = 'cb' + Math.random().toString(36).slice(2, 8);
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

    /* Heading (##, ###, ####) – already normalised */
    const headingMatch = t.match(/^(#{2,4}) ([\s\S]+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const tag   = _HEADING_TAG[level] || 'h4';
      return `<${tag}>${_fmt(headingMatch[2].trim(), math)}</${tag}>`;
    }

    /* Table – first line passes _isTableLine */
    const lines = t.split('\n');
    if (_isTableLine(lines[0])) {
      // Remove separator rows
      const rows = lines.filter(r => r.trim() && !/^[\s|:-]+$/.test(r));
      if (rows.length === 0) return '';   // only a separator -> drop

      const splitRow = (row) => {
        const inner = row.replace(/^\|/, '').replace(/\|$/, '');
        const cells = [];
        let current = '';
        let inCode = false;
        for (let i = 0; i < inner.length; i++) {
          const ch = inner[i];
          if (ch === '`') { inCode = !inCode; current += ch; }
          else if (ch === '|' && !inCode) { cells.push(current.trim()); current = ''; }
          else { current += ch; }
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

    /* Unordered list */
    if (lines.every(l => _isUnorderedListItem(l))) {
      const items = lines
        .map(l => `<li>${_fmt(l.replace(/^[-*•] /, ''), math)}</li>`)
        .join('');
      return `<ul>${items}</ul>`;
    }

    /* Ordered list */
    if (lines.every(l => _isOrderedListItem(l))) {
      const items = lines
        .map(l => `<li>${_fmt(l.replace(/^\d+[.)]\s/, ''), math)}</li>`)
        .join('');
      return `<ol>${items}</ol>`;
    }

    /* Paragraph */
    const lineHtml = lines.map(line => {
      const lt = line.trim();
      const mathPlace = lt.match(new RegExp(`^${_PH.MATH}(\\d+)${_PH.MATH}$`));
      if (mathPlace) {
        const { inner, display } = math[+mathPlace[1]];
        if (display) {
          return `</p><div class="math-display-block">${_katexRender(inner, true)}</div><p>`;
        }
      }
      return _fmt(line, math);
    });

    const inner = lineHtml
      .join('<br>')
      .replace(/<br>\s*<\/p>/g, '</p>')
      .replace(/<p>\s*<br>/g, '<p>')
      .replace(/<p>\s*<\/p>/g, '');

    return `<p>${inner}</p>`;
  }).join('');

  return html;
}

/* renderMathBubble — call‑site compatibility (no‑op) */
function renderMathBubble(_el) {}
