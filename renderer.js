/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   marked@13 + KaTeX (CDN) + highlight.js (CDN)
═══════════════════════════════════════════════════════════════ */

/* ── HTML entity escape ── */
function _he(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── Cheap hash ── */
function _cheapHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
  return h;
}

/* ── Normalize newlines ── */
function _normalizeNewlines(str) {
  let s = 0; while (s < str.length && str[s] === '\n') s++;
  let e = str.length - 1; while (e >= s && str[e] === '\n') e--;
  if (s > e) return '';
  const out = []; let i = s;
  while (i <= e) {
    if (str[i] !== '\n') { out.push(str[i++]); }
    else {
      let run = 0; while (i <= e && str[i] === '\n') { run++; i++; }
      out.push('\n'); if (run > 1) out.push('\n');
    }
  }
  return out.join('');
}

/* ══════════════════════════════════════════════════════════════
   KaTeX helper
══════════════════════════════════════════════════════════════ */
function _katex(tex, display) {
  if (typeof katex === 'undefined')
    return display ? '$$' + _he(tex) + '$$' : '\\(' + _he(tex) + '\\)';
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: false });
  } catch (_) {
    return display ? '$$' + _he(tex) + '$$' : '\\(' + _he(tex) + '\\)';
  }
}

/* ══════════════════════════════════════════════════════════════
   MARKED EXTENSIONS
══════════════════════════════════════════════════════════════ */
function _buildMarked() {

  const extBlockDollar = {
    name: 'blockDollar', level: 'block',
    start: src => src.indexOf('$$'),
    tokenizer(src) {
      const m = src.match(/^\$\$([\s\S]+?)\$\$/);
      if (m) return { type: 'blockDollar', raw: m[0], tex: m[1].trim() };
    },
    renderer: t => '<div class="math-display">' + _katex(t.tex, true) + '</div>\n',
  };

  const extBlockBracket = {
    name: 'blockBracket', level: 'block',
    start: src => src.indexOf('\\['),
    tokenizer(src) {
      const m = src.match(/^\\\[([\s\S]+?)\\\]/);
      if (m) return { type: 'blockBracket', raw: m[0], tex: m[1].trim() };
    },
    renderer: t => '<div class="math-display">' + _katex(t.tex, true) + '</div>\n',
  };

  const extInlineParen = {
    name: 'inlineParen', level: 'inline',
    start: src => src.indexOf('\\('),
    tokenizer(src) {
      const m = src.match(/^\\\(([\s\S]+?)\\\)/);
      if (m) return { type: 'inlineParen', raw: m[0], tex: m[1].trim() };
    },
    renderer: t => _katex(t.tex, false),
  };

  marked.use({ extensions: [extBlockDollar, extBlockBracket, extInlineParen] });

  const renderer = new marked.Renderer();

  renderer.code = function (codeOrToken, lang) {
    let code, language;
    if (codeOrToken && typeof codeOrToken === 'object') {
      code = codeOrToken.text ?? codeOrToken.code ?? '';
      language = (codeOrToken.lang || '').trim().toLowerCase();
    } else { code = codeOrToken; language = (lang || '').trim().toLowerCase(); }

    const id = 'cb' + Math.random().toString(36).slice(2, 8);
    let hi = _he(code);
    if (typeof hljs !== 'undefined') {
      const valid = language && hljs.getLanguage(language);
      const highlighted = valid
        ? hljs.highlight(code, { language, ignoreIllegals: true })
        : hljs.highlightAuto(code);
      hi = highlighted.value;
    }
    return (
      '<div class="code-block" id="' + id + '">' +
        '<button class="code-copy-btn" data-target="' + id + '" aria-label="Copy">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
          ' stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
            '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
          '</svg>' +
        '</button>' +
        '<pre><code class="hljs">' + hi + '</code></pre>' +
      '</div>'
    );
  };

  renderer.table = (h, b) =>
    '<div class="table-wrap"><table><thead>' + h + '</thead><tbody>' + b + '</tbody></table></div>';

  renderer.hr = () => '<hr class="md-hr">\n';

  marked.use({ renderer, breaks: true, gfm: true });
}

_buildMarked();

/* ══════════════════════════════════════════════════════════════
   STREAMING GUARD
══════════════════════════════════════════════════════════════ */
function _holdIncomplete(text) {
  const m1 = text.match(/((?:^|\n)\$\$(?![\s\S]*?\$\$)[\s\S]*)$/);
  if (m1) return { safe: text.slice(0, text.lastIndexOf(m1[0])), held: m1[0] };
  const m2 = text.match(/(\\\[(?![\s\S]*?\\\])[\s\S]*)$/);
  if (m2) return { safe: text.slice(0, text.lastIndexOf(m2[0])), held: m2[0] };
  const m3 = text.match(/(\\\((?![\s\S]*?\\\))[\s\S]{0,300})$/);
  if (m3) return { safe: text.slice(0, text.lastIndexOf(m3[0])), held: m3[0] };
  return { safe: text, held: '' };
}

/* ══════════════════════════════════════════════════════════════
   PIPELINE
══════════════════════════════════════════════════════════════ */
function _safePipeline(raw, isStreaming = false) {
  if (!raw) return '';
  let src = isStreaming ? _holdIncomplete(raw).safe : raw;
  src = _normalizeNewlines(src);
  if (!src) return '';
  let html;
  try { html = marked.parse(src); }
  catch (_) { html = '<pre class="render-fallback">' + _he(raw) + '</pre>'; }
  return html;
}

/* ══════════════════════════════════════════════════════════════
   UniversalMessageRenderer
══════════════════════════════════════════════════════════════ */
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
    return (this.renderedContent = _safePipeline(content, false));
  }
  startStream() {
    this._buf = ''; this._streaming = true;
    this.rawContent = ''; this.renderedContent = ''; this._hash = null;
  }
  pushChunk(chunk) {
    if (!this._streaming) this.startStream();
    this._buf += chunk; this.rawContent = this._buf;
    this.renderedContent = _safePipeline(_holdIncomplete(this._buf).safe, true);
    return this.renderedContent;
  }
  finishStream() {
    this._streaming = false;
    return (this.renderedContent = _safePipeline(this._buf, false));
  }
  getHTML() { return this.renderedContent; }
  getRaw()  { return this.rawContent; }
}

/* ══════════════════════════════════════════════════════════════
   STREAMING FACTORY
══════════════════════════════════════════════════════════════ */
function createStreamingRenderer(onUpdate, debounceMs = 40) {
  const renderer = new UniversalMessageRenderer();
  renderer.startStream();
  let _timer = null, _done = false;
  const _flush = final => {
    clearTimeout(_timer); _timer = null;
    if (typeof onUpdate === 'function')
      onUpdate(final ? renderer.finishStream() : renderer.getHTML(), { final });
  };
  return {
    push(chunk) {
      if (_done) return;
      renderer.pushChunk(chunk);
      clearTimeout(_timer);
      _timer = setTimeout(() => _flush(false), debounceMs);
    },
    finish() {
      if (_done) return; _done = true;
      clearTimeout(_timer); _flush(true);
    },
    getRenderer() { return renderer; },
  };
}

/* ── Public API ── */
function universalRender(content) { return new UniversalMessageRenderer().render(content); }
function renderMarkdown(text)     { return universalRender(text); }

/* ══════════════════════════════════════════════════════════════
   CITATION CHIP RENDERER
══════════════════════════════════════════════════════════════ */
const _chipRegistry = {};
let   _chipCounter  = 0;

/* Global sources — search.js mein set karo:
   window._atkynSources = sourcesArray; */
window._atkynSources = [];

document.addEventListener('error', function(e) {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || !img.dataset.chipId) return;
  const id  = img.dataset.chipId;
  const src = _chipRegistry[id];
  if (!src) return;
  let domain = '';
  try { domain = new URL(src.url).hostname.replace(/^www\./, ''); } catch (_) {}
  const letter = (domain[0] || '?').toUpperCase();
  const span = document.createElement('span');
  span.className   = 'chip-fallback';
  span.textContent = letter;
  img.replaceWith(span);
}, true);

function _buildChip(src) {
  if (!src || !src.url) return '';
  let domain = '';
  try { domain = new URL(src.url).hostname.replace(/^www\./, ''); }
  catch (_) { domain = src.url; }

  const label      = domain.length > 22 ? domain.slice(0, 20) + '\u2026' : domain;
  const chipId     = 'chip' + (++_chipCounter);
  _chipRegistry[chipId] = src;
  const faviconUrl = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=64';

  return (
    '<a class="source-chip"' +
    ' href="' + _he(src.url) + '"' +
    ' data-chip-url="' + _he(src.url) + '"' +
    ' data-chip-domain="' + _he(domain) + '"' +
    ' data-chip-title="' + _he(src.title || domain) + '"' +
    ' data-chip-favicon="' + _he(faviconUrl) + '">' +
    '<img src="' + _he(faviconUrl) + '" width="16" height="16" data-chip-id="' + chipId + '" alt="">' +
    _he(label) +
    '</a>'
  );
}

function injectCitationChips(html, sources) {
  if (!sources || !sources.length) return html;

  return html.replace(/(\[\d+\])+/g, function(match) {
    const nums = [];
    const re = /\[(\d+)\]/g;
    let m;
    while ((m = re.exec(match)) !== null) nums.push(parseInt(m[1], 10));

    const unique   = [...new Set(nums)];
    const MAX_SHOW = 2;
    const toShow   = unique.slice(0, MAX_SHOW);
    const overflow = unique.length - MAX_SHOW;

    let inner = '';
    for (const n of toShow) {
      const src = sources[n - 1];
      if (src) inner += _buildChip(src);
    }
    if (overflow > 0) {
      inner +=
        '<a class="source-chip source-chip-overflow" href="#sources" rel="noopener">+' + overflow + '</a>';
    }

    return inner ? '<span class="chip-group">' + inner + '</span>' : match;
  });
}

/* ══════════════════════════════════════════════════════════════
   SOURCE CHIP BOTTOM SHEET — all sources SERP style
══════════════════════════════════════════════════════════════ */
(function () {
  const sheet = document.createElement('div');
  sheet.id = 'chipSheet';
  sheet.innerHTML =
    '<div id="chipSheetBackdrop"></div>' +
    '<div id="chipSheetCard">' +
      '<div id="chipSheetPill"></div>' +
      '<div id="chipSheetList"></div>' +
    '</div>';
  document.body.appendChild(sheet);

  function _domain(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; }
  }

  function _favicon(domain) {
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=64';
  }

  function buildItem(src, isActive) {
    const domain  = _domain(src.url);
    const favicon = _favicon(domain);
    const title   = src.title || domain;
    const shortUrl = src.url.length > 45 ? src.url.slice(0, 43) + '\u2026' : src.url;

    return (
      '<a class="csi' + (isActive ? ' csi--active' : '') + '" href="' + _he(src.url) + '" target="_blank" rel="noopener">' +
        '<img class="csi-favicon" src="' + _he(favicon) + '" width="28" height="28" alt="" onerror="this.style.visibility=\'hidden\'">' +
        '<div class="csi-body">' +
          '<div class="csi-domain">' + _he(domain) + '</div>' +
          '<div class="csi-title">' + _he(title) + '</div>' +
          '<div class="csi-url">' + _he(shortUrl) + '</div>' +
        '</div>' +
        '<svg class="csi-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
      '</a>'
    );
  }

  function openSheet(clickedUrl) {
    const sources = window._atkynSources || [];
    if (!sources.length) return;

    /* Pill — clicked source highlight */
    const clickedDomain  = _domain(clickedUrl);
    const clickedFavicon = _favicon(clickedDomain);
    const clickedSrc     = sources.find(s => s.url === clickedUrl) || sources[0];

    document.getElementById('chipSheetPill').innerHTML =
      '<img src="' + _he(clickedFavicon) + '" width="20" height="20" alt="" onerror="this.style.visibility=\'hidden\'">' +
      '<span>' + _he(clickedDomain) + '</span>';

    /* List — all sources, clicked wala top pe */
    const sorted = [
      clickedSrc,
      ...sources.filter(s => s.url !== clickedSrc.url)
    ];

    document.getElementById('chipSheetList').innerHTML =
      sorted.map((s, i) => buildItem(s, i === 0)).join('');

    sheet.classList.add('open');
  }

  function closeSheet() { sheet.classList.remove('open'); }

  document.getElementById('chipSheetBackdrop').addEventListener('click', closeSheet);

  document.addEventListener('click', function (e) {
    const chip = e.target.closest('.source-chip[data-chip-url]');
    if (!chip) return;
    e.preventDefault();
    openSheet(chip.dataset.chipUrl);
  });
})();
