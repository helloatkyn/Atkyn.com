/* ═══════════════════════════════════════════════════════════════
renderer.js — Atkyn Search
marked@13 + KaTeX (CDN) + highlight.js (CDN)
Production-stable rendering pipeline
═══════════════════════════════════════════════════════════════ */

/* ── HTML entity escape ── */
const _ENTITY_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

function _he(s) {
  return String(s).replace(/[&<>"']/g, (c) => _ENTITY_MAP[c]);
}

/* ── Normalize newlines ── */
function _normalizeNewlines(str) {
  let s = 0;
  while (s < str.length && str[s] === '\n') s++;

  let e = str.length - 1;
  while (e >= s && str[e] === '\n') e--;

  if (s > e) return '';

  const out = [];
  let i = s;

  while (i <= e) {
    if (str[i] !== '\n') {
      out.push(str[i++]);
    } else {
      let run = 0;
      while (i <= e && str[i] === '\n') {
        run++;
        i++;
      }
      out.push('\n');
      if (run > 1) out.push('\n');
    }
  }

  return out.join('');
}

/* ══════════════════════════════════════════════════════════════
KaTeX helper
══════════════════════════════════════════════════════════════ */
function _katex(tex, display) {
  if (typeof katex === 'undefined') {
    return display ? '$$' + _he(tex) + '$$' : '\\(' + _he(tex) + '\\)';
  }

  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: false
    });
  } catch (_) {
    return display ? '$$' + _he(tex) + '$$' : '\\(' + _he(tex) + '\\)';
  }
}

/* ══════════════════════════════════════════════════════════════
MARKED EXTENSIONS
══════════════════════════════════════════════════════════════ */
function _buildMarked() {
  if (typeof marked === 'undefined') return;

  const extBlockDollar = {
    name: 'blockDollar',
    level: 'block',
    start(src) {
      const i = src.indexOf('$$');
      return i === -1 ? undefined : i;
    },
    tokenizer(src) {
      const m = src.match(/^\$\$([\s\S]+?)\$\$/);
      if (m) return { type: 'blockDollar', raw: m[0], tex: m[1].trim() };
    },
    renderer(t) {
      return '<div class="math-display">' + _katex(t.tex, true) + '</div>\n';
    }
  };

  const extBlockBracket = {
    name: 'blockBracket',
    level: 'block',
    start(src) {
      const i = src.indexOf('\\[');
      return i === -1 ? undefined : i;
    },
    tokenizer(src) {
      const m = src.match(/^\\\[([\s\S]+?)\\\]/);
      if (m) return { type: 'blockBracket', raw: m[0], tex: m[1].trim() };
    },
    renderer(t) {
      return '<div class="math-display">' + _katex(t.tex, true) + '</div>\n';
    }
  };

  const extInlineParen = {
    name: 'inlineParen',
    level: 'inline',
    start(src) {
      const i = src.indexOf('\\(');
      return i === -1 ? undefined : i;
    },
    tokenizer(src) {
      const m = src.match(/^\\\(([\s\S]+?)\\\)/);
      if (m) return { type: 'inlineParen', raw: m[0], tex: m[1].trim() };
    },
    renderer(t) {
      return _katex(t.tex, false);
    }
  };

  marked.use({
    extensions: [extBlockDollar, extBlockBracket, extInlineParen]
  });

  const renderer = new marked.Renderer();

  /* marked@13 (pinned in index.html) passes plain strings to renderer.code / renderer.table. */
  renderer.code = function (code, lang) {
    const language = (lang || '').trim().toLowerCase();

    const id = 'cb' + Math.random().toString(36).slice(2, 8);
    let hi = _he(code);

    if (typeof hljs !== 'undefined') {
      try {
        const valid = language && hljs.getLanguage(language);
        const highlighted = valid
          ? hljs.highlight(code, { language, ignoreIllegals: true })
          : hljs.highlightAuto(code);
        hi = highlighted.value;
      } catch (_) {
        hi = _he(code);
      }
    }

    return (
      '<div class="code-block" id="' + id + '">' +
        '<button type="button" class="code-copy-btn" data-target="' + id + '" aria-label="Copy">' +
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

  renderer.table = function (header, body) {
    return (
      '<div class="table-wrap">' +
        '<table>' +
          '<thead>' + header + '</thead>' +
          '<tbody>' + body + '</tbody>' +
        '</table>' +
      '</div>\n'
    );
  };

  renderer.hr = () => '<hr class="md-hr">\n';

  marked.use({
    renderer,
    breaks: true,
    gfm: true
  });
}

_buildMarked();

/* ══════════════════════════════════════════════════════════════
PIPELINE
══════════════════════════════════════════════════════════════ */
function _safePipeline(raw) {
  if (!raw) return '';

  const src = _normalizeNewlines(raw);

  if (!src) return '';

  if (typeof marked === 'undefined') {
    return '<pre class="render-fallback">' + _he(raw) + '</pre>';
  }

  try {
    return marked.parse(src);
  } catch (_) {
    return '<pre class="render-fallback">' + _he(raw) + '</pre>';
  }
}

/* ══════════════════════════════════════════════════════════════
PUBLIC API
══════════════════════════════════════════════════════════════ */
function renderMarkdown(text) {
  return _safePipeline(text);
}

window.renderMarkdown = renderMarkdown;

/* ══════════════════════════════════════════════════════════════
CITATION CHIP RENDERER
══════════════════════════════════════════════════════════════ */
const _chipRegistry = Object.create(null);
let _chipCounter = 0;

/* Global sources — search.js sets this */
window._atkynSources = [];

document.addEventListener('error', function (e) {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || !img.dataset.chipId) return;

  const id = img.dataset.chipId;
  const src = _chipRegistry[id];
  if (!src) return;

  let domain = '';
  try {
    domain = new URL(src.url).hostname.replace(/^www\./, '');
  } catch (_) {}

  const letter = (domain[0] || '?').toUpperCase();
  const span = document.createElement('span');
  span.className = 'chip-fallback';
  span.textContent = letter;

  img.replaceWith(span);
}, true);

function buildChip(src, allSources) {
  if (!src || !src.url) return '';

  let domain = '';
  try {
    domain = new URL(src.url).hostname.replace(/^www\./, '');
  } catch (_) {
    domain = src.url;
  }

  const domainRoot = domain.split('.')[0];
  const siteName = domainRoot.charAt(0).toUpperCase() + domainRoot.slice(1);
  const label = siteName.length > 22 ? siteName.slice(0, 20) + '\u2026' : siteName;

  const chipId = 'chip' + (++_chipCounter);
  _chipRegistry[chipId] = src;

  const faviconUrl = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=64';
  const sourcesSnap = _he(JSON.stringify(allSources || []));

  return (
    '<a class="source-chip"' +
      ' href="' + _he(src.url) + '"' +
      ' data-chip-url="' + _he(src.url) + '"' +
      ' data-chip-domain="' + _he(domain) + '"' +
      ' data-chip-title="' + _he(src.title || domain) + '"' +
      ' data-chip-favicon="' + _he(faviconUrl) + '"' +
      ' data-chip-sources="' + sourcesSnap + '">' +
      '<img src="' + _he(faviconUrl) + '" width="14" height="14" data-chip-id="' + chipId + '" alt="">' +
      _he(label) +
    '</a>'
  );
}

/* ──────────────────────────────────────────────────────────────
CITATION ATTRIBUTION + PLACEMENT

Two separate responsibilities, kept in separate functions:

  ATTRIBUTION  _citeAttribute()  sentence  → source index(es)
  RENDERING    buildChip()       source    → existing chip UI

Attribution uses only data already on the page (title, url slug, snippet,
source order) — no fetch, no search, no LLM call. It is evidence scoring,
not semantic entailment: a source is attached only when several
independent signals agree, otherwise the sentence stays uncited.
Signals: IDF-weighted content-word coverage (words common to most
sources are discounted), exact numeric agreement, shared adjacent word
pairs, light stemming + a small synonym table, and negation agreement.

Placement: a chip always follows the sentence's closing punctuation.
Explicit [n] markers are honoured, moved to the same position, and a
sentence that already carries one is never auto-cited again.
────────────────────────────────────────────────────────────── */
const _CITE = {
  MIN_SENTENCE_TOKENS: 4,    /* unique content words required in a claim */
  MIN_MATCHED: 3,            /* shared content words (any kind) */
  MIN_SPECIFIC_MATCHED: 2,   /* shared words/numbers NOT common to most sources */
  MIN_COVERAGE: 0.5,         /* weighted share of the claim's specific words found in the source */
  STRONG_COVERAGE: 0.7,      /* coverage that may stand without a shared word pair */
  QUESTION_BONUS: 0.1,       /* extra coverage demanded of "did you know …?" style claims */
  SMALL_SET_BONUS: 0.05,     /* extra coverage when <3 sources (no IDF signal available) */
  MAX_CHIPS_PER_CLAIM: 3,
  CO_SOURCE_RATIO: 0.85      /* another source must score within this ratio of the best */
};

const _CITE_STOP = new Set((
  'about above after again against all also always among and any are aren around because been before being below ' +
  'between both but can cannot could couldn did didn does doesn doing don down during each either else enough even ' +
  'ever every few for from further get gets getting got had hadn has hasn have haven having her here hers herself him ' +
  'himself his how however into isn its itself just know known let like made make makes making many may maybe might ' +
  'more most much must myself neither new nor not now off often once one only onto other others ought our ours out ' +
  'over own per perhaps quite rather really same shall she should shouldn since some something still such than that ' +
  'the their theirs them themselves then there these they this those though through thus too under until upon very ' +
  'was wasn well were weren what whatever when where whether which while who whom whose why will with within without ' +
  'won would wouldn yet you your yours yourself'
).split(/\s+/));

const _CITE_ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'inc', 'ltd', 'corp', 'fig', 'approx', 'est'
]);

const _CITE_SYNONYMS = [
  ['release', 'launch', 'introduce', 'unveil', 'debut', 'announce', 'publish', 'rollout'],
  ['expand', 'expansion', 'extend', 'extension', 'broaden', 'widen'],
  ['add', 'include', 'integrate', 'incorporate', 'embed'],
  ['increase', 'rise', 'grow', 'growth', 'climb', 'surge', 'jump', 'gain', 'raise'],
  ['decrease', 'reduce', 'cut', 'drop', 'decline', 'fall', 'lower', 'shrink'],
  ['country', 'nation', 'market', 'territory'],
  ['company', 'firm', 'business', 'corporation', 'vendor'],
  ['user', 'customer', 'consumer'],
  ['buy', 'acquire', 'purchase', 'acquisition'],
  ['create', 'build', 'develop', 'craft'],
  ['begin', 'start', 'commence'],
  ['say', 'state', 'tell', 'claim'],
  ['improve', 'enhance', 'upgrade', 'boost'],
  ['ban', 'prohibit', 'forbid', 'outlaw'],
  ['price', 'cost', 'fee'],
  ['find', 'discover', 'detect', 'uncover'],
  ['show', 'display', 'demonstrate'],
  ['allow', 'enable', 'permit']
];

function _citeStem(w) {
  let s = w;

  if (s.length > 4 && s.endsWith('ies')) {
    s = s.slice(0, -3) + 'y';
  } else {
    const sfx = ['ations', 'ation', 'ments', 'ment', 'ingly', 'edly', 'ings', 'ing', 'ed', 'es', 's', 'ly'];
    for (let i = 0; i < sfx.length; i++) {
      if (s.length - sfx[i].length >= 4 && s.endsWith(sfx[i])) {
        s = s.slice(0, -sfx[i].length);
        break;
      }
    }
  }

  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s.length > 6 ? s.slice(0, 6) : s;
}

const _CITE_CANON = (function () {
  const map = Object.create(null);
  _CITE_SYNONYMS.forEach(function (group) {
    const canon = _citeStem(group[0]);
    group.forEach(function (w) { map[_citeStem(w)] = canon; });
  });
  return map;
})();

function _citeDecode(s) {
  const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, function (all, ent) {
    const e = ent.toLowerCase();
    if (named[e] !== undefined) return named[e];
    if (e === '#39' || e === '#x27') return "'";
    return ' ';
  });
}

/* text → { seq: ordered canonical content tokens, nums: Set, negated: bool } */
function _citeAnalyze(text) {
  const clean = _citeDecode(text)
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/[\u2019\u2018]/g, "'");

  const seq = [];
  const nums = new Set();
  const raw = clean.match(/[\p{L}\p{N}]+(?:[.,'][\p{L}\p{N}]+)*/gu) || [];

  for (let i = 0; i < raw.length; i++) {
    let w = raw[i];

    if (/^\d/.test(w)) {
      const n = w.replace(/,/g, '');
      if (/^\d+(?:\.\d+)?$/.test(n)) {
        nums.add(n);
        seq.push(n);
        continue;
      }
    }

    const acronym = /^[A-Z]{2}$/.test(w);
    w = w.replace(/'s$/i, '').replace(/[.,']/g, '').toLowerCase();

    if (!w) continue;
    if (!acronym && (w.length < 3 || _CITE_STOP.has(w))) continue;

    const st = acronym ? w : _citeStem(w);
    seq.push(_CITE_CANON[st] || st);
  }

  const negated = /\b(?:not|never|cannot|can't|won't|didn't|doesn't|isn't|wasn't|aren't|weren't|hasn't|haven't|hadn't|without|neither|nor|unable|no longer)\b/i.test(clean);

  return { seq: seq, nums: nums, negated: negated };
}

function _citePairs(seq, into) {
  for (let i = 0; i + 1 < seq.length; i++) into.add(seq[i] + '|' + seq[i + 1]);
}

/* One-time view of the existing source objects (title / url / snippet). */
function _citeBuildModel(sources) {
  const items = [];
  const df = new Map();

  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (!s || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) continue;

    const title = s.title && s.title !== 'Untitled' ? String(s.title) : '';
    const snippet = s.snippet && s.snippet !== 'No snippet available.' ? String(s.snippet) : '';

    const t = _citeAnalyze(title);
    const sn = _citeAnalyze(snippet);

    let slugSeq = [];
    try {
      const path = decodeURIComponent(new URL(s.url).pathname);
      slugSeq = _citeAnalyze(path.split(/[^\p{L}]+/u).filter(function (w) { return w.length >= 4; }).join(' ')).seq;
    } catch (_) {}

    const set = new Set([].concat(t.seq, sn.seq, slugSeq));
    if (set.size < 3) continue;

    const pairs = new Set();
    _citePairs(t.seq, pairs);
    _citePairs(sn.seq, pairs);
    _citePairs(slugSeq, pairs);

    const nums = new Set();
    t.nums.forEach(function (n) { nums.add(n); });
    sn.nums.forEach(function (n) { nums.add(n); });

    set.forEach(function (tok) { df.set(tok, (df.get(tok) || 0) + 1); });

    items.push({ index: i, set: set, pairs: pairs, nums: nums, negated: t.negated || sn.negated });
  }

  return { items: items, N: items.length, df: df };
}

function _citeLooksFactual(sentence, isQuestion) {
  const s = sentence.trim();
  if (/^(?:sure|okay|ok|great|thanks|thank you|hello|hi|hey|certainly|absolutely|of course|here(?:'s| is| are)|let me|let's|i(?:'ll| will| can| hope| am| think| don't| cannot)|feel free|hope this|please|if you)\b/i.test(s)) {
    return false;
  }

  if (isQuestion &&
      !/^did you know\b/i.test(s) &&
      /^(?:what|why|how|which|who|whom|whose|when|where|can|could|should|would|will|do|does|did|is|are|am|was|were|shall|may|might|have|has)\b/i.test(s)) {
    return false;
  }

  return true;
}

/* sentence → array of 0-based source indexes that genuinely support it (usually 0 or 1) */
function _citeAttribute(sentence, model, isQuestion) {
  if (!model || !model.N) return [];
  if (!_citeLooksFactual(sentence, isQuestion)) return [];

  const a = _citeAnalyze(sentence);
  const uniq = Array.from(new Set(a.seq));
  if (uniq.length < _CITE.MIN_SENTENCE_TOKENS) return [];

  const pairs = [];
  for (let i = 0; i + 1 < a.seq.length; i++) pairs.push(a.seq[i] + '|' + a.seq[i + 1]);

  const N = model.N;
  const hasIdf = N >= 3;
  const minCoverage = _CITE.MIN_COVERAGE + (isQuestion ? _CITE.QUESTION_BONUS : 0) + (hasIdf ? 0 : _CITE.SMALL_SET_BONUS);

  const isGeneric = function (t) {
    return hasIdf && !a.nums.has(t) && (model.df.get(t) || 0) / N > 0.5;
  };

  const accepted = [];

  for (let k = 0; k < model.items.length; k++) {
    const it = model.items[k];

    /* every number the sentence asserts must be present in the source */
    let numsOk = true;
    a.nums.forEach(function (n) { if (!it.nums.has(n)) numsOk = false; });
    if (!numsOk) continue;

    /* polarity must agree */
    if (a.negated !== it.negated) continue;

    let matched = 0;
    let specificMatched = 0;
    let matchedW = 0;
    let totalW = 0;

    for (let u = 0; u < uniq.length; u++) {
      const t = uniq[u];
      const has = it.set.has(t);
      if (has) matched++;
      if (isGeneric(t)) continue;

      const df = model.df.get(t) || 0;
      const w = a.nums.has(t) ? 2 : (hasIdf && df > 0 ? 1 + (1 - df / N) : 1);

      totalW += w;
      if (has) {
        specificMatched++;
        matchedW += w;
      }
    }

    if (!totalW) continue;
    if (matched < _CITE.MIN_MATCHED || specificMatched < _CITE.MIN_SPECIFIC_MATCHED) continue;

    const coverage = matchedW / totalW;
    if (coverage < minCoverage) continue;

    let hits = 0;
    for (let p = 0; p < pairs.length; p++) {
      if (!it.pairs.has(pairs[p])) continue;
      const parts = pairs[p].split('|');
      if (isGeneric(parts[0]) && isGeneric(parts[1])) continue;
      hits++;
    }

    if (!(hits >= 1 || (hasIdf && coverage >= _CITE.STRONG_COVERAGE))) continue;

    accepted.push({ index: it.index, score: coverage + 0.05 * Math.min(hits, 3) });
  }

  if (!accepted.length) return [];

  let best = 0;
  accepted.forEach(function (x) { if (x.score > best) best = x.score; });

  return accepted
    .filter(function (x) { return x.score >= best * _CITE.CO_SOURCE_RATIO; })
    .sort(function (x, y) { return y.score - x.score || x.index - y.index; })
    .slice(0, _CITE.MAX_CHIPS_PER_CLAIM)
    .map(function (x) { return x.index; });
}

function _citeIsAbbrev(sentenceSoFar) {
  const m = /([\p{L}\p{N}.]+)$/u.exec(sentenceSoFar);
  if (!m) return false;
  const w = m[1].toLowerCase().replace(/\.$/, '');
  return _CITE_ABBREV.has(w) || /^(?:\p{L}\.)*\p{L}$/u.test(w);
}

const _CITE_BLOCK = new Set([
  'p', 'li', 'ul', 'ol', 'div', 'blockquote', 'br', 'hr', 'pre', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
]);

const _CITE_VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'
]);

const _CITE_SKIP_TAGS = new Set(['pre', 'code', 'a', 'button', 'script', 'style', 'svg', 'textarea']);
const _CITE_SKIP_CLASS = /(?:^|\s)(?:math-display|katex[\w-]*|code-block|chip-group|source-chip|render-fallback)(?:\s|$)/;
const _CITE_INLINE_CLOSE = /^<\/\s*(?:strong|em|b|i|del|s|u|mark|sub|sup|small)\s*>$/i;

/* Is an already-rendered chip-group the next thing (ignoring whitespace / closing inline tags)? */
function _citeChipFollows(parts, from) {
  for (let j = from; j < parts.length; j++) {
    const q = parts[j];
    if (!q) continue;

    if (q.charAt(0) === '<') {
      if (_CITE_INLINE_CLOSE.test(q)) continue;
      return /^<span\b[^>]*class\s*=\s*["'][^"']*\bchip-group\b/i.test(q);
    }

    if (/^\s*$/.test(q)) continue;
    return /^\s*\[\d+\]/.test(q);
  }
  return false;
}

/* Walks rendered HTML once. Never mutates visible text: it only inserts chip markup. */
function _citeWalk(html, sources) {
  const model = _citeBuildModel(sources);
  const parts = html.split(/(<[^>]*>)/);
  const out = [];

  let pending = '';
  let skipName = '';
  let skipDepth = 0;
  const blocks = [];

  let buf = '';
  let cited = false;
  let justEnded = false;

  const chipsHtml = function (idxs) {
    let inner = '';
    idxs.forEach(function (i) { inner += buildChip(sources[i], sources); });
    return inner ? '<span class="chip-group">' + inner + '</span>' : '';
  };

  const resetSentence = function () {
    buf = '';
    cited = false;
    justEnded = false;
  };

  const flushPending = function () {
    if (pending) {
      out.push(pending);
      pending = '';
    }
  };

  const inHeading = function () {
    for (let i = 0; i < blocks.length; i++) {
      if (/^h[1-6]$/.test(blocks[i])) return true;
    }
    return false;
  };

  const inListItem = function () {
    const n = blocks.length;
    if (!n) return false;
    const top = blocks[n - 1];
    return top === 'li' || (top === 'p' && n > 1 && blocks[n - 2] === 'li');
  };

  /* A list item that ends without punctuation: attribute it as-is (no punctuation is invented). */
  const flushTail = function () {
    if (!model.N || cited || inHeading() || !inListItem()) return;
    const sentence = buf.trim();
    if (!sentence) return;

    const idxs = _citeAttribute(sentence, model, false);
    if (!idxs.length) return;

    const h = chipsHtml(idxs);
    if (h) out.push(' ' + h);
  };

  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    if (!part) continue;

    /* ───────── tags ───────── */
    if (part.charAt(0) === '<') {
      const close = /^<\/\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(part);
      const open = close ? null : /^<\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(part);

      if (!close && !open) {
        flushPending();
        out.push(part);
        continue;
      }

      const name = (close ? close[1] : open[1]).toLowerCase();
      const selfClosing = /\/\s*>$/.test(part);

      if (skipDepth > 0) {
        out.push(part);
        if (name === skipName && !_CITE_VOID.has(name)) {
          if (close) skipDepth--;
          else if (!selfClosing) skipDepth++;
        }
        continue;
      }

      /* a pending chip stays attached to the sentence across closing inline tags only */
      if (pending && !(close && _CITE_INLINE_CLOSE.test(part))) flushPending();

      if (open && !_CITE_VOID.has(name) && !selfClosing) {
        const clsMatch = /class\s*=\s*["']([^"']*)["']/i.exec(part);
        const cls = clsMatch ? clsMatch[1] : '';

        if (_CITE_SKIP_TAGS.has(name) || _CITE_SKIP_CLASS.test(cls)) {
          if (_CITE_BLOCK.has(name)) {
            flushTail();
            resetSentence();
          } else if (/(?:^|\s)(?:chip-group|source-chip)(?:\s|$)/.test(cls) && !justEnded) {
            cited = true;
          }

          out.push(part);
          skipName = name;
          skipDepth = 1;
          continue;
        }
      }

      if (_CITE_BLOCK.has(name)) {
        flushTail();

        if (close) {
          const at = blocks.lastIndexOf(name);
          if (at >= 0) blocks.length = at;
        } else if (!_CITE_VOID.has(name) && !selfClosing) {
          blocks.push(name);
        }

        resetSentence();
      }

      out.push(part);
      continue;
    }

    /* ───────── text ───────── */
    if (skipDepth > 0) {
      out.push(part);
      continue;
    }

    flushPending();

    const text = part;
    const autoOk = !inHeading();

    let nextIsBlockEnd = true;
    for (let j = pi + 1; j < parts.length; j++) {
      const q = parts[j];
      if (!q) continue;
      if (q.charAt(0) !== '<') { nextIsBlockEnd = false; break; }
      if (_CITE_INLINE_CLOSE.test(q)) continue;
      const qm = /^<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(q);
      nextIsBlockEnd = !qm || _CITE_BLOCK.has(qm[1].toLowerCase());
      break;
    }

    const RE = /(\s*)((?:\[\d+\][ \t]*)+)([.!?;:,])?|([.!?]+)(["'\u201d\u2019)\]]*)(?=\s|$)/g;
    let emitFrom = 0;
    let plainFrom = 0;
    let m;

    const addPlain = function (to) {
      if (to <= plainFrom) return;
      const seg = _citeDecode(text.slice(plainFrom, to));
      buf += seg;
      if (/\S/.test(seg)) justEnded = false;
      plainFrom = to;
    };

    while ((m = RE.exec(text)) !== null) {
      /* ── explicit [n] marker run ── */
      if (m[2] !== undefined) {
        const runStart = m.index;
        const matchEnd = m.index + m[0].length;
        const lead = m[1];
        const trail = /\s*$/.exec(m[2])[0];
        const punct = m[3] || '';

        const nums = [];
        const nre = /\[(\d+)\]/g;
        let nm;
        while ((nm = nre.exec(m[2])) !== null) {
          const idx = parseInt(nm[1], 10) - 1;
          if (nums.indexOf(idx) === -1 && sources[idx] && sources[idx].url) nums.push(idx);
        }

        addPlain(runStart);
        const wasJustEnded = justEnded;
        const chipHtml = nums.length ? chipsHtml(nums) : '';

        if (!chipHtml) {
          /* unknown source number: leave the text exactly as before */
          if (!wasJustEnded) cited = true;
          plainFrom = matchEnd;
          if (/[.!?]/.test(punct)) {
            resetSentence();
            justEnded = true;
          }
          continue;
        }

        let repl = '';
        let boundary = false;

        if (punct) {
          repl = punct + ' ' + chipHtml;
          boundary = /[.!?]/.test(punct);
        } else if (wasJustEnded) {
          repl = (lead || ' ') + chipHtml + trail;
        } else if (/^\s*$/.test(text.slice(matchEnd)) && nextIsBlockEnd) {
          repl = (lead || ' ') + chipHtml;
          boundary = true;
        } else {
          /* marker in the middle of a sentence with no punctuation: legacy behaviour, untouched */
          cited = true;
          plainFrom = matchEnd;
          continue;
        }

        out.push(text.slice(emitFrom, runStart));
        out.push(repl);
        emitFrom = matchEnd;
        plainFrom = matchEnd;

        if (boundary) {
          resetSentence();
          justEnded = true;
        } else if (!wasJustEnded) {
          cited = true;
        }

        continue;
      }

      /* ── sentence terminator ── */
      const term = m[4];
      const closers = m[5] || '';
      const termStart = m.index;
      const endIdx = termStart + term.length + closers.length;

      const sentenceSoFar = buf + _citeDecode(text.slice(plainFrom, termStart));
      if (term === '.' && _citeIsAbbrev(sentenceSoFar)) continue;

      addPlain(termStart);

      const isQ = term.indexOf('?') !== -1;
      const rest = text.slice(endIdx);
      const explicitFollows = /^\s*\[\d+\]/.test(rest) ||
        (/^\s*$/.test(rest) && _citeChipFollows(parts, pi + 1));

      if (autoOk && !cited && !explicitFollows && model.N && /\S/.test(buf)) {
        const idxs = _citeAttribute(buf, model, isQ);

        if (idxs.length) {
          const h = chipsHtml(idxs);

          if (h) {
            if (endIdx >= text.length) {
              out.push(text.slice(emitFrom));
              emitFrom = text.length;
              pending = ' ' + h;
            } else {
              out.push(text.slice(emitFrom, endIdx));
              out.push(' ' + h);
              emitFrom = endIdx;
            }
          }
        }
      }

      resetSentence();
      justEnded = true;
      plainFrom = endIdx;
    }

    addPlain(text.length);
    out.push(text.slice(emitFrom));
  }

  flushPending();
  flushTail();

  return out.join('');
}

/* Original explicit-marker behaviour — kept only as a last-resort fallback if the walker throws. */
function _injectExplicitOnly(html, sources) {
  return html.replace(/((?:\[\d+\])+)([.,;:!?])/g, function (_, refs, punct) {
    const nums = [];
    const re = /\[(\d+)\]/g;
    let m;

    while ((m = re.exec(refs)) !== null) {
      nums.push(parseInt(m[1], 10));
    }

    const unique = [...new Set(nums)];
    let inner = '';

    const src = sources[unique[0] - 1];
    if (src) inner = buildChip(src, sources);

    return inner
      ? '<span class="chip-group">' + inner + '</span>' + punct
      : refs + punct;
  });
}

function injectCitationChips(html, sources) {
  if (!html || !sources || !sources.length) return html;

  try {
    return _citeWalk(html, sources);
  } catch (_) {
    return _injectExplicitOnly(html, sources);
  }
}

window.injectCitationChips = injectCitationChips;

/* ══════════════════════════════════════════════════════════════
SOURCE CHIP BOTTOM SHEET — Google Web Results Style
══════════════════════════════════════════════════════════════ */
(function initChipSheet() {
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', initChipSheet, { once: true });
    return;
  }

  const sheet = document.createElement('div');
  sheet.id = 'chipSheet';
  sheet.innerHTML =
    '<div id="chipSheetBackdrop"></div>' +
    '<div id="chipSheetCard">' +
      '<div id="chipSheetList"></div>' +
    '</div>';

  document.body.appendChild(sheet);

  function _domain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {
      return url;
    }
  }

  function _favicon(domain) {
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=64';
  }

  function _shortUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.length > 1
        ? u.hostname.replace(/^www\./, '') + u.pathname
        : u.hostname.replace(/^www\./, '');
      return path.length > 48 ? path.slice(0, 46) + '\u2026' : path;
    } catch (_) {
      return url.length > 48 ? url.slice(0, 46) + '\u2026' : url;
    }
  }

  function _cleanTrail(s) {
    return String(s || '').replace(/[\s\u00a0](\u2026|.{2,3})$/, '').trimEnd();
  }

  function _fetchOg(url) {
    let signal;

    try {
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        signal = AbortSignal.timeout(6000);
      }
    } catch (_) {}

    return fetch('/api/og?url=' + encodeURIComponent(url), signal ? { signal } : undefined)
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        return d && d.image ? d.image : null;
      })
      .catch(function () {
        return null;
      });
  }

  function _injectOg(cardEl, image) {
    if (!image || !cardEl) return;

    const titleEl = cardEl.querySelector('.csi-title');
    if (!titleEl) return;

    const img = document.createElement('img');
    img.src = image;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';

    img.addEventListener('load', function () {
      const ratio = img.naturalWidth / img.naturalHeight;

      if (ratio >= 1.3) {
        img.className = 'csi-og-full';
        const wrap = document.createElement('div');
        wrap.className = 'csi-og-full-wrap';
        wrap.appendChild(img);

        if (titleEl.nextSibling) {
          titleEl.parentNode.insertBefore(wrap, titleEl.nextSibling);
        } else {
          titleEl.parentNode.appendChild(wrap);
        }
      } else {
        img.className = 'csi-og-thumb';
        const snippetEl = cardEl.querySelector('.csi-snippet');
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'csi-og-thumb-wrap';
        thumbWrap.appendChild(img);

        const row = document.createElement('div');
        row.className = 'csi-og-inline-row';

        if (snippetEl) {
          snippetEl.parentNode.insertBefore(row, snippetEl);
          row.appendChild(snippetEl);
        }

        row.appendChild(thumbWrap);
      }
    }, { once: true });

    img.addEventListener('error', function () {
      img.remove();
    }, { once: true });
  }

  function _buildSheetItem(src) {
    const domain = _domain(src.url);
    const favicon = _favicon(domain);
    const title = _cleanTrail(src.title || domain);
    const snippet = src.snippet ? _cleanTrail(src.snippet) : '';

    return (
      '<a class="csi" href="' + _he(src.url) + '" target="_blank" rel="noopener">' +
        '<div class="csi-top">' +
          '<div class="csi-favicon-wrap">' +
            '<img class="csi-favicon" src="' + _he(favicon) + '" width="16" height="16" alt="" onerror="this.style.visibility=\'hidden\'">' +
          '</div>' +
          '<div class="csi-site">' +
            '<div class="csi-domain">' + _he(domain) + '</div>' +
            '<div class="csi-url">' + _he(_shortUrl(src.url)) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="csi-title">' + _he(title) + '</div>' +
        (snippet ? '<div class="csi-snippet">' + _he(snippet) + '</div>' : '') +
      '</a>'
    );
  }

  function openSheet(clickedUrl, chipSources) {
    const sources = (chipSources && chipSources.length)
      ? chipSources
      : (window._atkynSources || []);

    if (!sources.length) return;

    const clickedSrc = sources.find((s) => s.url === clickedUrl) || sources[0];
    if (!clickedSrc) return;

    const sorted = [
      clickedSrc,
      ...sources.filter((s) => s.url !== clickedSrc.url)
    ];

    const list = document.getElementById('chipSheetList');
    if (!list) return;

    list.innerHTML = sorted.map((s) => _buildSheetItem(s)).join('');

    const cards = list.querySelectorAll('.csi');

    sorted.forEach(function (src, i) {
      const cardEl = cards[i];
      if (!cardEl) return;
      _fetchOg(src.url).then(function (img) {
        _injectOg(cardEl, img);
      });
    });

    sheet.classList.add('open');
  }

  function closeSheet() {
    sheet.classList.remove('open');
  }

  const backdrop = document.getElementById('chipSheetBackdrop');
  if (backdrop) {
    backdrop.addEventListener('click', closeSheet);
  }

  document.addEventListener('click', function (e) {
    const chip = e.target.closest('.source-chip[data-chip-url]');
    if (!chip) return;

    e.preventDefault();

    let chipSources = null;
    try {
      chipSources = JSON.parse(chip.dataset.chipSources || 'null');
    } catch (_) {}

    openSheet(chip.dataset.chipUrl, chipSources);
  });
})();
