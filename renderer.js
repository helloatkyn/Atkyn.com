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
      errorColor: '#888888',
      trust: false,
    });
  } catch (_) {
    return `<span class="math-fallback">${_he(tex)}</span>`;
  }
}

function _extractMath(text) {
  const math = [];

  function placeholder(inner, display) {
    const cleaned = inner.replace(/\$/g, '').trim();
    const idx = math.length;
    math.push({ inner: cleaned, display });
    return `\x00M${idx}\x00`;
  }

  text = text.replace(/\\\[([\s\S]*?)(?:\\\]|$)/g,
    (_, inner) => placeholder(inner, true));
  text = text.replace(/\$\$([\s\S]*?)(?:\$\$|$)/g,
    (_, inner) => placeholder(inner, true));
  text = text.replace(/\\\(([\s\S]*?)(?:\\\)|$)/g,
    (_, inner) => placeholder(inner, false));
  text = text.replace(/\$([^\$\n]+?)\$/g,
    (_, inner) => placeholder(inner, false));

  return { text, math };
}

/* ── Inline formatter ── */
function _fmt(line, math) {
  let s = _he(line);
  s = s.replace(/&lt;br&gt;/gi, '<br>');
  s = s.replace(/`([^`]+)`/g,          (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+?)\*/g, '$1');
  s = s.replace(/(?<!\*|\w)\*(?!\*)/g, '');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const safeUrl = url.startsWith('http') ? url : '#';
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  s = s.replace(/\x00M(\d+)\x00/g, (_, i) => {
    const { inner, display } = math[+i];
    const html = _katexRender(inner, display);
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

/* ── Tokenizer regexes ── */
const _RX = {
  jsKw:        /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|super|import|export|default|from|async|await|try|catch|finally|throw|yield|static|get|set|this)\b/g,
  jsBool:      /\b(true|false|null|undefined|NaN|Infinity)\b/g,
  pyKw:        /\b(def|class|return|if|elif|else|for|while|in|not|and|or|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|global|nonlocal|del|assert|is|True|False|None)\b/g,
  dqStr:       /"(?:[^"\\]|\\.)*"/g,
  sqStr:       /'(?:[^'\\]|\\.)*'/g,
  btStr:       /`(?:[^`\\]|\\.)*`/g,
  lineComment: /\/\/.*/g,
  hashComment: /#.*/g,
  blockComment:/\/\*[\s\S]*?\*\//g,
  numLit:      /\b\d+(\.\d+)?\b/g,
  fnCall:      /\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()/g,
  clsName:     /\b([A-Z][a-zA-Z0-9_]*)\b/g,
  propKey:     /([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*:)/g,
};

function _tokenizeLine(line, lang) {
  const { jsKw, jsBool, pyKw, dqStr, sqStr, btStr, lineComment,
          hashComment, blockComment, numLit, fnCall, clsName, propKey } = _RX;
  for (const r of [jsKw, jsBool, pyKw, dqStr, sqStr, btStr,
                   lineComment, hashComment, blockComment,
                   numLit, fnCall, clsName, propKey]) r.lastIndex = 0;

  const ph = [];
  const protect = html => { const i = ph.length; ph.push(html); return `\x01${i}\x01`; };

  let s = line;
  s = s.replace(blockComment, m => protect(`<span class="tk-cmt">${_esc(m)}</span>`));
  if (['python','py','bash','sh','yaml','yml'].includes(lang)) {
    s = s.replace(hashComment, m => protect(`<span class="tk-cmt">${_esc(m)}</span>`));
  } else {
    s = s.replace(lineComment, m => protect(`<span class="tk-cmt">${_esc(m)}</span>`));
  }
  s = s.replace(btStr,   m     => protect(`<span class="tk-str">${_esc(m)}</span>`));
  s = s.replace(dqStr,   m     => protect(`<span class="tk-str">${_esc(m)}</span>`));
  s = s.replace(sqStr,   m     => protect(`<span class="tk-str">${_esc(m)}</span>`));
  s = _esc(s);
  s = s.replace(numLit,  m     => protect(`<span class="tk-num">${m}</span>`));
  s = s.replace(clsName, (m,p) => protect(`<span class="tk-cls">${p}</span>`));
  s = s.replace(fnCall,  (m,p) => protect(`<span class="tk-fn">${p}</span>`));
  if (lang === 'python' || lang === 'py') {
    s = s.replace(pyKw,  m => protect(`<span class="tk-kw">${m}</span>`));
  } else {
    s = s.replace(jsKw,  m => protect(`<span class="tk-kw">${m}</span>`));
  }
  s = s.replace(jsBool,  m     => protect(`<span class="tk-bool">${m}</span>`));
  s = s.replace(propKey, (m,p) => protect(`<span class="tk-prop">${p}</span>`));
  s = s.replace(/\x01(\d+)\x01/g, (_, i) => ph[+i]);
  return s || ' ';
}

/* ════════════════════════════════
   renderMarkdown(rawText) → HTML
   ════════════════════════════════ */
function renderMarkdown(rawText) {
  // ── Step 1: normalise heading levels and strip junk ──────────
  let text = rawText
    .replace(/^-{3,}\s*$/gm, '')
    .replace(/^\*{2}\s*$/gm, '')
    .replace(/^\*([^*\n]+)\*$/gm, '$1')
    .replace(/^#{4,}\s*\**\s*(.+?)\**\s*$/gm, '**$1**')
    .replace(/^###\s*\**\s*(.+?)\**\s*$/gm,   '**$1**')
    .replace(/^##\s+(.+)$/gm, '## $1')
    .replace(/^#\s+(.+)$/gm,  '## $1');

  // ── Step 2: extract code blocks BEFORE math extraction ───────
  const codeBlocks = [];
  text = text.replace(/```(\w*)\r?\n?([\s\S]*?)(?:```|$)/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang.trim(), code: code.trimEnd() });
    return `\x00CODE${idx}\x00`;
  });

  // ── Step 3: extract math ──────────────────────────────────────
  const { text: mathText, math } = _extractMath(text);
  text = mathText;

  // ── Step 4: mixed pipe/prose table splitting ──────────────────
  text = text.split('\n\n').map(block => {
    const lines = block.split('\n');
    const isPipeLine = l => (l.match(/\|/g) || []).length >= 2;
    const hasPipe  = lines.some(isPipeLine);
    const allPipe  = lines.filter(l => l.trim()).every(isPipeLine);
    if (!hasPipe || allPipe) return block;
    let out = '', tableBuf = [], proseBuf = [];
    const flushProse = () => { if (proseBuf.length) { out += proseBuf.join('\n') + '\n\n'; proseBuf = []; } };
    const flushTable = () => { if (tableBuf.length) { out += tableBuf.join('\n') + '\n\n'; tableBuf = []; } };
    for (const line of lines) {
      if (isPipeLine(line)) { flushProse(); tableBuf.push(line); }
      else                  { flushTable(); proseBuf.push(line); }
    }
    flushProse(); flushTable();
    return out.trim();
  }).join('\n\n');

  // ── Step 5: render blocks ─────────────────────────────────────
  const html = text.split('\n\n').map(block => {
    const t = block.trim();
    if (!t) return '';

    // standalone display-math placeholder
    if (/^\x00M\d+\x00$/.test(t)) {
      const { inner, display } = math[+t.match(/\x00M(\d+)\x00/)[1]];
      if (display) {
        return `<div class="math-display-block">${_katexRender(inner, true)}</div>`;
      }
      return `<p>${_katexRender(inner, false)}</p>`;
    }

    // code block
    const cm = t.match(/^\x00CODE(\d+)\x00$/);
    if (cm) {
      const { lang, code } = codeBlocks[+cm[1]];
      const langLabel   = lang || 'code';
      const highlighted = syntaxHighlight(code, lang);
      const blockId     = 'cb' + Math.random().toString(36).slice(2, 8);
      return `<div class="code-block" id="${blockId}"><div class="code-block-header"><span class="code-block-lang">${_he(langLabel)}</span><button class="code-copy-btn" data-target="${blockId}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button></div><pre>${highlighted}</pre></div>`;
    }

    // heading ## …
    const hm = t.match(/^(##) ([\s\S]+)/);
    if (hm) {
      return `<h4>${_fmt(hm[2], math)}</h4>`;
    }

    // table
    if (/^\|.+\|/m.test(t)) {
      const rows = t.split('\n').filter(r => r.trim() && !/^[\s|:-]+$/.test(r));
      if (rows.length >= 1) {
        const parseRow = r => r.replace(/^\||\|$/g, '').split('|').map(c => _fmt(c.trim(), math));
        const [header, ...body] = rows;
        const hCells = parseRow(header).map(c => `<th>${c}</th>`).join('');
        const bRows  = body.map(r => `<tr>${parseRow(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
        return `<div class="table-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;"><table><thead><tr>${hCells}</tr></thead><tbody>${bRows}</tbody></table></div>`;
      }
    }

    // unordered list
    if (/^[-*•] /m.test(t)) {
      const items = t.split('\n').filter(Boolean)
        .map(l => `<li>${_fmt(l.replace(/^[-*•] /, ''), math)}</li>`).join('');
      return `<ul>${items}</ul>`;
    }

    // ordered list
    if (/^\d+[.)]\s/m.test(t)) {
      const items = t.split('\n').filter(Boolean)
        .map(l => `<li>${_fmt(l.replace(/^\d+[.)]\s/, ''), math)}</li>`).join('');
      return `<ul>${items}</ul>`;
    }

    // paragraph
    const lineHtml = t.split('\n').map(line => {
      const lt = line.trim();
      if (/^\x00M\d+\x00$/.test(lt)) {
        const { inner, display } = math[+lt.match(/\x00M(\d+)\x00/)[1]];
        if (display) {
          return `</p><div class="math-display-block">${_katexRender(inner, true)}</div><p>`;
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

/* renderMathBubble — no-op for call-site compatibility */
function renderMathBubble(_el) {}
           
