/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown · KaTeX math · Syntax highlighting · Table rendering
   ═══════════════════════════════════════════════════════════════ */

/* ── HTML escape helper ── */
function _he(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── KaTeX render wrapper ── */
function _katexRender(tex, display) {
  if (typeof katex === 'undefined') return `<span class="math-fallback">${_he(tex)}</span>`;
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      errorColor: '#cc0000',
      trust: false,
    });
  } catch (_) {
    return `<span class="math-fallback">${_he(tex)}</span>`;
  }
}

/*
 * _extractMath(text)
 * ------------------
 * Scans the full raw text once before any line/paragraph splitting.
 * Extracts every math region — closed OR unclosed — into a lookup table.
 * Returns { text: string with \x00M{n}\x00 placeholders, math: Array }
 *
 * Handles:
 *   \[...\]   display (closed)
 *   \[...EOF  display (unclosed — stream cut off)
 *   $$...$$   display (closed)
 *   $$...EOF  display (unclosed)
 *   \(...\)   inline  (closed)
 *   $...$     inline  (closed, single-line)
 */
function _extractMath(text) {
  const math = [];
  function placeholder(inner, display) {
    const idx = math.length;
    math.push({ inner, display });
    return `\x00M${idx}\x00`;
  }
  /* display: \[...\] — greedy to EOF if unclosed */
  text = text.replace(/\\\[([\s\S]*?)(?:\\\]|$)/g,   (_, inner) => placeholder(inner, true));
  /* display: $$...$$ — greedy to EOF if unclosed */
  text = text.replace(/\$\$([\s\S]*?)(?:\$\$|$)/g,   (_, inner) => placeholder(inner, true));
  /* inline: \(...\) */
  text = text.replace(/\\\(([\s\S]*?)\\\)/g,          (_, inner) => placeholder(inner, false));
  /* inline: $...$ — single-line, not $$ */
  text = text.replace(/\$([^\$\n]+?)\$/g,             (_, inner) => placeholder(inner, false));
  return { text, math };
}

/* ── Inline formatter (bold / italic / inline-code + math restore) ── */
function _fmt(line, math) {
  let s = _he(line);
  s = s.replace(/`([^`]+)`/g,           (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*\n]+?)\*\*/g,  '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+?)\*/g,      '<em>$1</em>');
  /* restore math placeholders AFTER HTML-escape so KaTeX HTML passes through */
  s = s.replace(/\x00M(\d+)\x00/g, (_, i) => {
    const { inner, display } = math[+i];
    const html = _katexRender(inner.trim(), display);
    return display ? `</p><div class="math-display-block">${html}</div><p>` : html;
  });
  return s;
}

/* ── HTML escape for syntax highlighter ── */
function _esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Syntax highlighter ── */
function syntaxHighlight(code, lang) {
  const lines = code.split('\n');
  let linesHtml = '';
  const l = (lang || '').toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const highlighted = _tokenizeLine(lines[i], l);
    linesHtml += `<div class="code-line"><span class="code-line-num">${i + 1}</span><span class="code-line-content">${highlighted}</span></div>`;
  }
  return `<div class="code-lines">${linesHtml}</div>`;
}

function _tokenizeLine(line, lang) {
  /* Patterns */
  const jsKw       = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|super|import|export|default|from|async|await|try|catch|finally|throw|yield|static|get|set|this)\b/g;
  const jsBool     = /\b(true|false|null|undefined|NaN|Infinity)\b/g;
  const pyKw       = /\b(def|class|return|if|elif|else|for|while|in|not|and|or|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|global|nonlocal|del|assert|is|True|False|None)\b/g;
  const dqStr      = /"(?:[^"\\]|\\.)*"/g;
  const sqStr      = /'(?:[^'\\]|\\.)*'/g;
  const btStr      = /`(?:[^`\\]|\\.)*`/g;
  const lineComment = /\/\/.*/g;
  const hashComment = /#.*/g;
  const blockComment = /\/\*[\s\S]*?\*\//g;
  const numLit     = /\b\d+(\.\d+)?\b/g;
  const fnCall     = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()/g;
  const clsName    = /\b([A-Z][a-zA-Z0-9_]*)\b/g;
  const propKey    = /([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*:)/g;

  const ph = [];
  function protect(html) {
    const i = ph.length;
    ph.push(html);
    return `\x01${i}\x01`;
  }

  let s = line;

  /* 1. Block comments */
  s = s.replace(blockComment, m => protect(`<span class="tk-cmt">${_esc(m)}</span>`));

  /* 2. Line comments */
  if (lang === 'python' || lang === 'py' || lang === 'bash' || lang === 'sh' || lang === 'yaml' || lang === 'yml') {
    s = s.replace(hashComment, m => protect(`<span class="tk-cmt">${_esc(m)}</span>`));
  } else {
    s = s.replace(lineComment, m => protect(`<span class="tk-cmt">${_esc(m)}</span>`));
  }

  /* 3. Template literals */
  s = s.replace(btStr, m => protect(`<span class="tk-str">${_esc(m)}</span>`));
  /* 4. Double-quoted strings */
  s = s.replace(dqStr, m => protect(`<span class="tk-str">${_esc(m)}</span>`));
  /* 5. Single-quoted strings */
  s = s.replace(sqStr, m => protect(`<span class="tk-str">${_esc(m)}</span>`));

  /* 6. Escape remaining raw chars */
  s = _esc(s);

  /* 7. Numbers */
  s = s.replace(numLit, m => protect(`<span class="tk-num">${m}</span>`));
  /* 8. Class names (CapitalCase) */
  s = s.replace(clsName, (m, p1) => protect(`<span class="tk-cls">${p1}</span>`));
  /* 9. Function calls */
  s = s.replace(fnCall, (m, p1) => protect(`<span class="tk-fn">${p1}</span>`));
  /* 10. Keywords */
  if (lang === 'python' || lang === 'py') {
    s = s.replace(pyKw,  m => protect(`<span class="tk-kw">${m}</span>`));
  } else {
    s = s.replace(jsKw,  m => protect(`<span class="tk-kw">${m}</span>`));
  }
  /* 11. Booleans / null */
  s = s.replace(jsBool, m => protect(`<span class="tk-bool">${m}</span>`));
  /* 12. Object keys */
  s = s.replace(propKey, (m, p1) => protect(`<span class="tk-prop">${p1}</span>`));

  /* Restore placeholders */
  s = s.replace(/\x01(\d+)\x01/g, (_, i) => ph[+i]);
  return s || ' ';
}

/* ════════════════════════════════
   renderMarkdown(rawText) → HTML
   ════════════════════════════════ */
function renderMarkdown(rawText) {
  /* 0. Strip model artifacts */
  let text = rawText
    .replace(/^-{3,}\s*$/gm, '')
    .replace(/^\*{2}\s*$/gm, '')
    .replace(/^#{4,6}\s+/gm, '### ');

  /* 1. Extract fenced code blocks */
  const codeBlocks = [];
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang.trim(), code: code.trimEnd() });
    return `\x00CODE${idx}\x00`;
  });

  /* 2. Extract all math (closed + unclosed) */
  const { text: mathText, math } = _extractMath(text);
  text = mathText;

  /* 3. Split on blank lines and render each block */
  const html = text.split('\n\n').map(block => {
    const t = block.trim();
    if (!t) return '';

    /* Lone math placeholder */
    if (/^\x00M\d+\x00$/.test(t)) {
      const { inner } = math[+t.match(/\x00M(\d+)\x00/)[1]];
      return `<div class="math-display-block">${_katexRender(inner.trim(), true)}</div>`;
    }

    /* Code block */
    const cm = t.match(/^\x00CODE(\d+)\x00$/);
    if (cm) {
      const { lang, code } = codeBlocks[+cm[1]];
      const langLabel   = lang || 'code';
      const highlighted = syntaxHighlight(code, lang);
      const blockId     = 'cb' + Math.random().toString(36).slice(2, 8);
      return `<div class="code-block" id="${blockId}"><div class="code-block-header"><span class="code-block-lang">${_he(langLabel)}</span><button class="code-copy-btn" data-target="${blockId}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button></div><pre>${highlighted}</pre></div>`;
    }

    /* Heading */
    const hm = t.match(/^(#{1,3}) ([\s\S]+)/);
    if (hm) {
      const tag = 'h' + (hm[1].length + 2);
      return `<${tag}>${_fmt(hm[2], math)}</${tag}>`;
    }

    /* Table */
    if (/^\|.+\|/m.test(t)) {
      const rows = t.split('\n').filter(r => r.trim() && !/^[\s|:-]+$/.test(r));
      if (rows.length >= 1) {
        const parseRow = r => r.replace(/^\||\|$/g, '').split('|').map(c => _fmt(c.trim(), math));
        const [header, ...body] = rows;
        const hCells = parseRow(header).map(c => `<th>${c}</th>`).join('');
        const bRows  = body.map(r => `<tr>${parseRow(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
        return `<div class="table-wrap"><table><thead><tr>${hCells}</tr></thead><tbody>${bRows}</tbody></table></div>`;
      }
    }

    /* Unordered list */
    if (/^[-*•] /m.test(t)) {
      const items = t.split('\n').filter(Boolean)
        .map(l => `<li>${_fmt(l.replace(/^[-*•] /, ''), math)}</li>`).join('');
      return `<ul>${items}</ul>`;
    }

    /* Ordered list */
    if (/^\d+[.)]\s/m.test(t)) {
      const items = t.split('\n').filter(Boolean)
        .map(l => `<li>${_fmt(l.replace(/^\d+[.)]\s/, ''), math)}</li>`).join('');
      return `<ol>${items}</ol>`;
    }

    /* Paragraph — line-by-line so display math breaks out cleanly */
    const lineHtml = t.split('\n').map(line => {
      const lt = line.trim();
      if (/^\x00M\d+\x00$/.test(lt)) {
        const { inner } = math[+lt.match(/\x00M(\d+)\x00/)[1]];
        return `</p><div class="math-display-block">${_katexRender(inner.trim(), true)}</div><p>`;
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

/* renderMathBubble — kept as no-op for call-site compatibility */
function renderMathBubble(_el) {}
      
