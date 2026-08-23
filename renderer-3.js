/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search  (production build)
   Universal pipeline: Markdown · KaTeX · Syntax highlight · Tables
   Sentinels: \x00M{n}\x00 math  \x00CODE{n}\x00 code  \x02z{n}z\x02 tokenizer
   ═══════════════════════════════════════════════════════════════ */

/* ── HTML escape helpers ── */
function _he(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── KaTeX renderer ── */
function _katexRender(tex, display) {
  if (typeof katex === 'undefined') return `<span class="math-fallback">${_he(tex)}</span>`;
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, errorColor: '#888888', trust: false });
  } catch (_) {
    return `<span class="math-fallback">${_he(tex)}</span>`;
  }
}

/* ── Math extractor — runs before markdown so $ / \ are never touched.
   Order: display ($$, \[) before inline ($, \() to avoid double-parse. ── */
function _extractMath(text) {
  const math = [];
  const ph = (inner, display) => { math.push({ inner: inner.trim(), display }); return `\x00M${math.length - 1}\x00`; };
  text = text.replace(/\\\[([\s\S]*?)(?:\\\]|$)/g,    (_, i) => ph(i, true));
  text = text.replace(/\$\$([\s\S]*?)(?:\$\$|$)/g,    (_, i) => ph(i, true));
  text = text.replace(/\\\(([\s\S]*?)(?:\\\)|$)/g,    (_, i) => ph(i, false));
  text = text.replace(/\$([^\$\n]{1,500}?)\$/g,        (_, i) => ph(i, false));
  return { text, math };
}

/* ── Inline formatter — operates per-line after math extraction ── */
function _fmt(line, math) {
  // Protect inline code before _he() so inner chars aren't double-escaped
  const codePh = [];
  let s = line.replace(/`([^`]+)`/g, (_, c) => {
    codePh.push(`<code>${_esc(c)}</code>`);
    return `\x03C${codePh.length - 1}\x03`;
  });

  s = _he(s);
  s = s.replace(/&lt;br&gt;/gi, '<br>');
  s = s.replace(/\x03C(\d+)\x03/g, (_, i) => codePh[+i]);

  // Bold → Strong
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');

  // Italic — asterisk only (underscore italic removed; safe for snake_case / __init__)
  s = s.replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/(?<!\*)\*(?!\*)/g, '');

  // Markdown links — sanitize URL
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const trimmed = url.trim();
    const safe = /^https?:\/\//i.test(trimmed) && !/^(javascript|data|vbscript):/i.test(trimmed) ? trimmed : '#';
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Restore math placeholders
  s = s.replace(/\x00M(\d+)\x00/g, (_, i) => {
    const idx = +i;
    if (!math || idx >= math.length) return '';
    const { inner, display } = math[idx];
    const html = _katexRender(inner, display);
    return display ? `</p><div class="math-display-block">${html}</div><p>` : html;
  });

  return s;
}

/* ── Syntax highlighter ── */
const _RX = {
  jsKw:        /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|super|import|export|default|from|async|await|try|catch|finally|throw|yield|static|get|set|this)\b/g,
  dartKw:      /\b(void|final|late|required|abstract|implements|mixin|with|extension|typedef|enum|factory|operator|covariant|external|dynamic|const|var|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|import|export|async|await|try|catch|finally|throw|yield|static|get|set|this|in|is|as|null|true|false)\b/g,
  jsBool:      /\b(true|false|null|undefined|NaN|Infinity)\b/g,
  pyKw:        /\b(def|class|return|if|elif|else|for|while|in|not|and|or|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|global|nonlocal|del|assert|is|True|False|None)\b/g,
  dqStr:       /"(?:[^"\\]|\\.)*"/g,
  sqStr:       /'(?:[^'\\\n]|\\.){2,}'/g,   // 2+ chars — lone apostrophes untouched
  btStr:       /`(?:[^`\\]|\\.)*`/g,
  lineComment: /\/\/.*/g,
  hashComment: /#.*/g,
  blockComment:/\/\*[\s\S]*?\*\//g,
  numLit:      /\b\d+(\.\d+)?\b/g,
  fnCall:      /\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()/g,
  clsName:     /\b([A-Z][a-zA-Z0-9_]*)\b/g,
  propKey:     /([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*:)/g,
};
function _resetRx() { for (const r of Object.values(_RX)) r.lastIndex = 0; }

function syntaxHighlight(code, lang) {
  if (!code) return '<div class="code-lines"></div>';
  const l = (lang || '').toLowerCase();
  let out = '';
  for (let i = 0, lines = code.split('\n'); i < lines.length; i++) {
    out += `<div class="code-line"><span class="code-line-num">${i + 1}</span><span class="code-line-content">${_tokenizeLine(lines[i], l)}</span></div>`;
  }
  return `<div class="code-lines">${out}</div>`;
}

/* _tokenizeLine — sentinel format \x02z{N}z\x02 ensures no tokenizer regex
   can match the index N: z is \w, N is \w, so \b never fires between them. */
function _tokenizeLine(line, lang) {
  _resetRx();
  const ph = [];
  const protect = html => { const idx = ph.length; ph.push(html); return `\x02z${idx}z\x02`; };
  const span    = (cls, t) => protect(`<span class="${cls}">${_esc(t)}</span>`);

  let s = line;
  s = s.replace(_RX.blockComment, m => span('tk-cmt', m));
  const hashLangs = ['python', 'py', 'bash', 'sh', 'yaml', 'yml', 'ruby', 'rb', 'r'];
  s = hashLangs.includes(lang)
    ? s.replace(_RX.hashComment, m => span('tk-cmt', m))
    : s.replace(_RX.lineComment, m => span('tk-cmt', m));
  s = s.replace(_RX.btStr,  m => span('tk-str', m));
  s = s.replace(_RX.dqStr,  m => span('tk-str', m));
  s = s.replace(_RX.sqStr,  m => span('tk-str', m));
  s = _esc(s);
  s = s.replace(_RX.numLit,  m => protect(`<span class="tk-num">${m}</span>`));
  s = s.replace(_RX.clsName, (_, p) => protect(`<span class="tk-cls">${p}</span>`));
  s = s.replace(_RX.fnCall,  (_, p) => protect(`<span class="tk-fn">${p}</span>`));
  if      (lang === 'python' || lang === 'py') s = s.replace(_RX.pyKw,   m => protect(`<span class="tk-kw">${m}</span>`));
  else if (lang === 'dart')                    s = s.replace(_RX.dartKw, m => protect(`<span class="tk-kw">${m}</span>`));
  else                                         s = s.replace(_RX.jsKw,   m => protect(`<span class="tk-kw">${m}</span>`));
  s = s.replace(_RX.jsBool,  m => protect(`<span class="tk-bool">${m}</span>`));
  s = s.replace(_RX.propKey, (_, p) => protect(`<span class="tk-prop">${p}</span>`));
  s = s.replace(/\x02z(\d+)z\x02/g, (_, i) => ph[+i]);
  return s || ' ';
}

/* ── Heading tag map  #/## → h3  ### → h4  #### → h5 ── */
const _HEADING_TAG = { 1: 'h3', 2: 'h3', 3: 'h4', 4: 'h5' };

/* ════════════════════════════════════════════════════════════════
   renderMarkdown(rawText) → HTML string
   Pipeline: normalize → headings → code extract → math extract
             → paragraph split → render blocks
   ════════════════════════════════════════════════════════════════ */
function renderMarkdown(rawText) {
  if (!rawText || !rawText.trim()) return '';

  // 1. Normalize newlines
  let text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 2. Normalize headings (cap at h4, strip bold wrappers)
  text = text.replace(/^(#{1,6})\s+([\s\S]*?)$/gm, (_, hashes, rest) => {
    const level = Math.min(hashes.length, 4);
    const clean = rest.replace(/^#+\s*/, '').replace(/^\*\*(.+?)\*\*$/, '$1').trim();
    return '#'.repeat(level) + ' ' + clean;
  });
  text = text.replace(/^#\s+(.+)$/gm, '## $1');

  // 3. Isolate heading lines into their own paragraph blocks
  text = text.replace(/^(#{2,4} .+)$/gm, '\n\n$1\n\n');
  text = text.replace(/\n{3,}/g, '\n\n');

  // 4. Strip junk lines; convert HR syntax to placeholder
  text = text.replace(/^-{3,}\s*$/gm, '\x00HR\x00').replace(/^\*{2}\s*$/gm, '');
  text = text.replace(/\x00HR\x00/g, '\n\n\x00HR\x00\n\n').replace(/\n{3,}/g, '\n\n');

  // 5. Extract code blocks
  const codeBlocks = [];
  text = text.replace(/```(\w*)\r?\n?([\s\S]*?)(?:```|$)/g, (_, lang, code) => {
    codeBlocks.push({ lang: lang.trim(), code: code.trimEnd() });
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  });

  // 6. Extract math
  const { text: mathText, math } = _extractMath(text);
  text = mathText;

  // 7. Split blocks that mix table rows and prose
  const isPipeLine = l => (l.match(/\|/g) || []).length >= 2;
  text = text.split('\n\n').map(block => {
    const lines   = block.split('\n');
    const hasPipe = lines.some(isPipeLine);
    const allPipe = lines.filter(l => l.trim()).every(isPipeLine);
    if (!hasPipe || allPipe) return block;
    let out = '', tableBuf = [], proseBuf = [];
    const flushP = () => { if (proseBuf.length) { out += proseBuf.join('\n') + '\n\n'; proseBuf = []; } };
    const flushT = () => { if (tableBuf.length) { out += tableBuf.join('\n') + '\n\n'; tableBuf = []; } };
    for (const l of lines) {
      if (isPipeLine(l)) { flushP(); tableBuf.push(l); }
      else               { flushT(); proseBuf.push(l); }
    }
    flushP(); flushT();
    return out.trim();
  }).join('\n\n');

  // 8. Render paragraph blocks
  const _expandCode = (idx) => {
    if (idx >= codeBlocks.length) return '';
    const { lang, code } = codeBlocks[idx];
    const langLabel = lang || 'code';
    const blockId   = 'cb' + Math.random().toString(36).slice(2, 8);
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
        `<pre>${syntaxHighlight(code, lang)}</pre>` +
      `</div>`
    );
  };

  const html = text.split('\n\n').map(block => {
    const t = block.trim();
    if (!t) return '';

    // Code placeholder
    const codeMatch = t.match(/^\x00CODE(\d+)\x00$/);
    if (codeMatch) return _expandCode(+codeMatch[1]);

    // Display-math placeholder
    const mathMatch = t.match(/^\x00M(\d+)\x00$/);
    if (mathMatch) {
      const idx = +mathMatch[1];
      if (idx < math.length) {
        const { inner, display } = math[idx];
        return display
          ? `<div class="math-display-block">${_katexRender(inner, true)}</div>`
          : `<p>${_katexRender(inner, false)}</p>`;
      }
      return '';
    }

    // Horizontal rule
    if (t === '\x00HR\x00') return '<hr class="md-hr">';

    // Headings
    const headingMatch = t.match(/^(#{2,4}) ([\s\S]+)/);
    if (headingMatch) {
      const tag     = _HEADING_TAG[headingMatch[1].length] || 'h4';
      const content = headingMatch[2].replace(/^#+\s*/, '');
      return `<${tag}>${_fmt(content, math)}</${tag}>`;
    }

    // Table
    if (/^\|.+\|/m.test(t)) {
      const rows = t.split('\n').filter(r => {
        if (!r.trim()) return false;
        return !/^[\s|:\-]+$/.test(r.replace(/^\||\|$/g, ''));
      });
      if (rows.length >= 1) {
        const parseRow = r => r.replace(/^\||\|$/g, '').split('|').map(c => _fmt(c.trim(), math));
        const [header, ...body] = rows;
        const hCells = parseRow(header).map(c => `<th>${c}</th>`).join('');
        const bRows  = body.map(r => `<tr>${parseRow(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
        return `<div class="table-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;"><table><thead><tr>${hCells}</tr></thead><tbody>${bRows}</tbody></table></div>`;
      }
    }

    // Unordered list
    if (/^[-*•] /m.test(t)) {
      const lines = t.split('\n').filter(Boolean);
      let out = '', buf = [];
      const flushUl = () => {
        if (buf.length) { out += `<ul>${buf.map(l => `<li>${_fmt(l.replace(/^[-*•] /, ''), math)}</li>`).join('')}</ul>`; buf = []; }
      };
      for (const l of lines) {
        const lt = l.trim();
        const cm = lt.match(/^\x00CODE(\d+)\x00$/);
        if      (cm)                      { flushUl(); out += _expandCode(+cm[1]); }
        else if (lt === '\x00HR\x00')     { flushUl(); out += '<hr class="md-hr">'; }
        else if (/^[-*•] /.test(l))      { buf.push(l); }
        else if (buf.length && lt)        { buf[buf.length - 1] += ' ' + lt; }
        else                              { buf.push(l); }
      }
      flushUl();
      return out;
    }

    // Ordered list
    if (/^\d+[.)]\s/m.test(t)) {
      const lines = t.split('\n').filter(Boolean);
      let out = '', buf = [];
      const flushOl = () => {
        if (buf.length) { out += `<ol>${buf.map(l => `<li>${_fmt(l.replace(/^\d+[.)]\s/, ''), math)}</li>`).join('')}</ol>`; buf = []; }
      };
      for (const l of lines) {
        const lt = l.trim();
        const cm = lt.match(/^\x00CODE(\d+)\x00$/);
        if      (cm)                      { flushOl(); out += _expandCode(+cm[1]); }
        else if (lt === '\x00HR\x00')     { flushOl(); out += '<hr class="md-hr">'; }
        else if (/^\d+[.)]\s/.test(l))   { buf.push(l); }
        else if (buf.length && lt)        { buf[buf.length - 1] += ' ' + lt; }
        else                              { buf.push(l); }
      }
      flushOl();
      return out;
    }

    // Paragraph — may contain interleaved code/display-math placeholders
    const segments = [];
    let proseBuf   = [];
    const flushProse = () => { if (proseBuf.length) { segments.push({ type: 'prose', lines: proseBuf.slice() }); proseBuf = []; } };
    for (const line of t.split('\n')) {
      const lt      = line.trim();
      const codeLM  = lt.match(/^\x00CODE(\d+)\x00$/);
      if (codeLM) { flushProse(); segments.push({ type: 'code', idx: +codeLM[1] }); continue; }
      if (/^\x00M\d+\x00$/.test(lt)) {
        const idx = +lt.match(/\x00M(\d+)\x00/)[1];
        if (idx < math.length && math[idx].display) { flushProse(); segments.push({ type: 'display', idx }); continue; }
      }
      proseBuf.push(line);
    }
    flushProse();

    let out = '';
    for (const seg of segments) {
      if (seg.type === 'code') {
        out += _expandCode(seg.idx);
      } else if (seg.type === 'display') {
        out += `<div class="math-display-block">${_katexRender(math[seg.idx].inner, true)}</div>`;
      } else {
        const parts = [];
        for (const line of seg.lines) {
          const lt = line.trim();
          if (/^\x00M\d+\x00$/.test(lt)) {
            const idx = +lt.match(/\x00M(\d+)\x00/)[1];
            if (idx < math.length && math[idx].display) { parts.push(`\x01DISPLAY${idx}\x01`); continue; }
          }
          parts.push({ text: _fmt(line, math), hard: /  $/.test(line) });
        }
        let inner = '';
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          if (typeof p === 'string') {
            const idx = +p.match(/\x01DISPLAY(\d+)\x01/)[1];
            inner += `</p><div class="math-display-block">${_katexRender(math[idx].inner, true)}</div><p>`;
          } else {
            inner += p.text;
            if (i < parts.length - 1) inner += p.hard ? '<br>' : ' ';
          }
        }
        inner = inner.replace(/<br><\/p>/g, '</p>').replace(/<p><br>/g, '<p>');
        if (inner) out += `<p>${inner}</p>`;
      }
    }
    return out;
  }).join('');

  return html;
}

/* renderMathBubble — no-op retained for call-site compatibility */
function renderMathBubble(_el) {}

/* ════════════════════════════════════════════════════════════════
   UNIVERSAL PIPELINE LAYER
   repairMarkdown → repairMathFragments → renderMarkdown → autoLinkUrls
   ════════════════════════════════════════════════════════════════ */

/* Conservative markdown repair — safe for NASDAQ:AAPL, https://, snake_case */
function repairMarkdown(text) {
  if (!text) return text;
  // ##Title → ## Title
  text = text.replace(/^(#{1,6})([^#\s])/gm, '$1 $2');
  // **bold**word → **bold** word
  text = text.replace(/(\*\*[^*\n]+?\*\*)([a-zA-Z\u0900-\u097F])/g, '$1 $2');
  text = text.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)([a-zA-Z\u0900-\u097F])/g, (_, i, a) => `*${i}* ${a}`);
  // Market Cap:$4.5T → Market Cap: $4.5T
  text = text.replace(/([A-Za-z\u0900-\u097F0-9]):\$/g, '$1: $');
  // PE:34 → PE: 34  (only digit after colon — avoids NASDAQ:AAPL, http://)
  text = text.replace(/([A-Za-z\u0900-\u097F]):(\d)/g, '$1: $2');
  // Key:-text → Key:\n- text
  text = text.replace(/:-([^\s])/g, ':\n- $1');
  // -text at line start → - text  (avoids ---)
  text = text.replace(/^(?!---)-([A-Za-z\u0900-\u097F\u00C0-\u024F])/gm, '- $1');
  return text;
}

/* Broken math fragment reassembly — joins token-per-line math into $…$ */
const _MATH_OP   = /^[+\-\u2212\u00D7\u00F7\/*=\u2248<>\u00B1]\s*$/;
const _MATH_PAR  = /^[()[\]]\s*$/;
const _MATH_NUM  = /^\d{1,15}(\.\d{1,10})?\s*$/;
const _MATH_WORD = /^(high|low|close|open|max|min|avg|mean|sum|price|eps|pe|ratio)\s*$/i;

function repairMathFragments(text) {
  if (!text) return text;
  const lines = text.split('\n'), result = [];
  let i = 0;
  while (i < lines.length) {
    const run = []; let j = i;
    while (j < lines.length && j - i < 9) {
      const l = lines[j].trim();
      if (!l) break;
      if (!_MATH_OP.test(l) && !_MATH_PAR.test(l) && !_MATH_NUM.test(l) && !_MATH_WORD.test(l)) break;
      run.push(l); j++;
    }
    if (run.length >= 2 && run.some(l => _MATH_OP.test(l)) && run.some(l => _MATH_NUM.test(l))) {
      result.push('$' + run.join(' ').replace(/\u2212/g, '-') + '$'); i = j;
    } else { result.push(lines[i]); i++; }
  }
  return result.join('\n');
}

/* Whitespace normalization — collapse 3+ blank lines, trim edges */
function normalizeWhitespace(text) {
  if (!text) return text;
  return text.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

/* Auto-link bare https URLs in final HTML — skips existing <a> tags */
function _autoLinkUrls(html) {
  const URL_RE = /\bhttps?:\/\/[^\s<>"')[\]]+/gi;
  return html
    .split(/(<a\s[\s\S]*?<\/a>|<[^>]+>)/gi)
    .map((chunk, idx) => {
      if (idx % 2 === 1 || chunk.startsWith('<')) return chunk;
      return chunk.replace(URL_RE, url => {
        const label = url.length > 60 ? url.slice(0, 57) + '…' : url;
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${_he(label)}</a>`;
      });
    })
    .join('');
}

/* Internal pipeline — all stages error-tolerant */
function _safePipeline(raw) {
  if (!raw || !raw.trim()) return '';
  try {
    let text = raw;
    try { text = normalizeWhitespace(text);    } catch (_) {}
    try { text = repairMarkdown(text);         } catch (_) {}
    try { text = repairMathFragments(text);    } catch (_) {}
    let html;
    try { html = renderMarkdown(text);         } catch (_) { html = `<pre class="render-fallback">${_he(raw)}</pre>`; }
    try { html = _autoLinkUrls(html);          } catch (_) {}
    return html;
  } catch (_) {
    return `<pre class="render-fallback">${_he(raw)}</pre>`;
  }
}

/* Fast hash for memoization */
function _cheapHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return h;
}

/* ── UniversalMessageRenderer
   render(content, { role, streaming })  — one-shot
   startStream() / pushChunk(token) / finishStream()  — streaming
   rawContent always preserved; renderedContent is the HTML output    ── */
class UniversalMessageRenderer {
  constructor() {
    this.rawContent = ''; this.renderedContent = '';
    this._hash = null; this._buf = ''; this._streaming = false;
  }
  render(content, { role = 'user' } = {}) {
    this.rawContent = content;
    const h = _cheapHash(content);
    if (h === this._hash && this.renderedContent) return this.renderedContent;
    this._hash = h;
    return (this.renderedContent = _safePipeline(content));
  }
  startStream() { this._buf = ''; this._streaming = true; this.rawContent = ''; this.renderedContent = ''; }
  pushChunk(chunk) {
    if (!this._streaming) this.startStream();
    this.rawContent = (this._buf += chunk);
    return (this.renderedContent = _safePipeline(this._buf));
  }
  finishStream() { this._streaming = false; return (this.renderedContent = _safePipeline(this._buf)); }
  getHTML() { return this.renderedContent; }
  getRaw()  { return this.rawContent; }
}

/* ── createStreamingRenderer(onUpdate, debounceMs)
   Debounced streaming factory. Returns { push, finish }.             ── */
function createStreamingRenderer(onUpdate, debounceMs = 40) {
  const r = new UniversalMessageRenderer();
  r.startStream();
  let _t = null, _done = false;
  const flush = (final = false) => {
    clearTimeout(_t); _t = null;
    if (typeof onUpdate === 'function') onUpdate(final ? r.finishStream() : r.getHTML(), { final });
  };
  return {
    push:        chunk => { if (_done) return; r.pushChunk(chunk); clearTimeout(_t); _t = setTimeout(() => flush(false), debounceMs); },
    finish:      ()    => { if (_done) return; _done = true; flush(true); },
    getRenderer: ()    => r,
  };
}

/* ── universalRender(content, role, streaming) — convenience wrapper ── */
function universalRender(content, role = 'user', streaming = false) {
  const r = new UniversalMessageRenderer();
  if (streaming) { r.startStream(); r.pushChunk(content); return r.getHTML(); }
  return r.render(content, { role });
}
