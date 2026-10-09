/* visual.js — ATKYN Visual Engine (frontend-only, no extra AI call).
   Adds one supplementary visual after a finished bot answer when the answer
   explicitly contains steps, dates, a comparison, values or a Mermaid block.
   The visual is a sibling of .bubble, so the answer text, citations and Copy are untouched.
   API: window.VisualEngine.{enhance, restore, destroy, renderDiagram} */
(function (global) {
  'use strict';

  if (global.VisualEngine) return;

  var MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js';
  var MERMAID_COOLDOWN_MS = 30000;

  var LIMITS = {
    minTextChars: 200,
    maxTextChars: 20000,
    maxNodes: 1500,
    mermaidChars: 3000,
    mermaidLines: 40,
    stepsMin: 3, stepsMax: 8,
    stepLabelChars: 70,
    timelineMin: 3, timelineMax: 8, timelineTextChars: 140,
    cmpItemsMin: 2, cmpItemsMax: 6, cmpItemChars: 110,
    valuesMin: 3, valuesMax: 10
  };

  var SEL_STRIP = '.source-chip, .chip-group, .citation, .citation-ref, [data-citation], [data-chip-url],' +
                  ' svg, img, button, .code-block, .table-wrap, .vstrip, ul, ol';

  var ATTR_STATE = 'data-vz-state';   /* pending | done | none */

  var _seq = 0;
  var _tokens = new WeakMap();        /* stale async results are dropped */
  var _running = new WeakMap();       /* idempotent enhance */
  var _mermaidPromise = null;
  var _mermaidFailedAt = 0;
  var _idCounter = 0;
  var _themeBound = false;

  function isDark() {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches); }
    catch (_) { return false; }
  }

  function reducedMotion() {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (_) { return false; }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function children(parent, tagRe) {
    var out = [];
    var c = parent.children;
    for (var i = 0; i < c.length; i++) {
      if (!tagRe || tagRe.test(c[i].tagName)) out.push(c[i]);
    }
    return out;
  }

  /* Visible text of an element WITHOUT citation chips, media, nested lists, code or buttons. */
  function cleanText(node) {
    if (!node) return '';
    var clone = node.cloneNode(true);
    var junk = clone.querySelectorAll(SEL_STRIP);
    for (var i = 0; i < junk.length; i++) {
      if (junk[i].parentNode) junk[i].parentNode.removeChild(junk[i]);
    }
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function stripTrailingPunct(s) {
    return s.replace(/[\s:;,.\-–—]+$/, '').trim();
  }

  function clipWords(s, max) {
    if (s.length <= max) return { text: s, clipped: false };
    var cut = s.slice(0, max);
    var sp = cut.lastIndexOf(' ');
    if (sp > max * 0.5) cut = cut.slice(0, sp);
    return { text: stripTrailingPunct(cut) + '\u2026', clipped: true };
  }

  /* Text of the (up to) two blocks right before `node` — used as deterministic context. */
  function contextBefore(node) {
    var out = [];
    var p = node.previousElementSibling;
    var guard = 0;
    while (p && out.length < 2 && guard++ < 6) {
      if (/^(H[1-6]|P)$/.test(p.tagName)) out.push(cleanText(p));
      p = p.previousElementSibling;
    }
    return out.join(' ');
  }

  function headingLike(n) {
    if (!n) return false;
    if (/^H[1-6]$/.test(n.tagName)) return true;
    if (n.tagName === 'P' && n.children.length === 1 && /^(STRONG|B)$/.test(n.children[0].tagName)) {
      return cleanText(n) === cleanText(n.children[0]);
    }
    return false;
  }

  var MERMAID_START = /^(flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|timeline|pie)\b/;
  var MERMAID_BLOCK = [
    /%%\{/i, /\bclick\b/i, /\bcallback\b/i, /\bhref\b/i, /\blink\s/i, /javascript:/i, /\bdata:/i,
    /url\s*\(/i, /<\s*[a-z!\/]/i, /@\{/, /&#?\w+;/, /\bscript\b/i, /\bimg\b/i, /\bon\w+\s*=/i
  ];

  function validateMermaid(def) {
    if (typeof def !== 'string') return null;
    var s = def.replace(/\r\n?/g, '\n').trim();
    if (!s || s.length > LIMITS.mermaidChars) return null;
    if (s.split('\n').length > LIMITS.mermaidLines) return null;
    if (!MERMAID_START.test(s)) return null;
    for (var i = 0; i < MERMAID_BLOCK.length; i++) {
      if (MERMAID_BLOCK[i].test(s)) return null;
    }
    return s;
  }

  function detectMermaid(bubble) {
    var codes = bubble.querySelectorAll('.code-block code');
    for (var i = 0; i < codes.length && i < 4; i++) {
      var def = validateMermaid(codes[i].textContent || '');
      if (def) return { kind: 'mermaid', title: 'Diagram', def: def };
    }
    return null;
  }

  var PROCESS_CTX = /\b(steps?|process|workflow|procedure|stages?|phases?|pipeline|how to|how it works|works?|install(?:ation)?|set ?up|instructions|guide|lifecycle|flow|sequence|roadmap)\b/i;

  function stepLabel(li) {
    var full = cleanText(li);
    if (!full) return null;

    var first = li.firstElementChild;
    if (first && /^(STRONG|B)$/.test(first.tagName)) {
      var lead = cleanText(first);
      var liText = (li.textContent || '').replace(/\s+/g, ' ').trim();
      if (lead && liText.indexOf(lead) === 0 && lead.length <= 80) {
        var lbl = stripTrailingPunct(lead);
        if (lbl.length >= 2) return { text: lbl, natural: true };
      }
    }

    var m = full.match(/^(.+?[.:!?])(\s|$)/);
    var cand = stripTrailingPunct(m ? m[1] : full);
    if (cand.length < 2) return null;
    if (cand.length <= LIMITS.stepLabelChars) return { text: cand, natural: true };
    var c = clipWords(cand, LIMITS.stepLabelChars);
    return { text: c.text, natural: false };
  }

  function detectSteps(bubble) {
    var lists = children(bubble, /^OL$/);
    for (var i = 0; i < lists.length; i++) {
      var items = children(lists[i], /^LI$/);
      if (items.length < LIMITS.stepsMin || items.length > LIMITS.stepsMax) continue;
      if (!PROCESS_CTX.test(contextBefore(lists[i]))) continue;

      var labels = [];
      var natural = 0;
      var ok = true;
      for (var k = 0; k < items.length; k++) {
        var l = stepLabel(items[k]);
        if (!l) { ok = false; break; }
        labels.push(l.text);
        if (l.natural) natural++;
      }
      if (!ok || natural < Math.ceil(items.length * 0.6)) continue;
      return { kind: 'steps', title: 'Steps', labels: labels };
    }
    return null;
  }

  var MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
  var DATE_RE = new RegExp(
    '^((?:c\\.\\s*)?\\d{3,4}s?(?:\\s*[–-]\\s*\\d{2,4})?|' +
    MONTH + '\\s+(?:\\d{1,2},?\\s+)?\\d{4}|' +
    '\\d{1,2}\\s+' + MONTH + '\\s+\\d{4}|' +
    'Q[1-4]\\s+\\d{4})\\s*(?::|[–—-]|\\))\\s*(.+)$'
  );

  function detectTimeline(bubble) {
    var lists = children(bubble, /^(UL|OL)$/);
    for (var i = 0; i < lists.length; i++) {
      var items = children(lists[i], /^LI$/);
      if (items.length < LIMITS.timelineMin || items.length > LIMITS.timelineMax) continue;

      var rows = [];
      var years = [];
      var ok = true;
      for (var k = 0; k < items.length; k++) {
        var t = cleanText(items[k]);
        var m = DATE_RE.exec(t);
        if (!m) { ok = false; break; }
        var rest = m[2].trim();
        if (!rest || rest.length > LIMITS.timelineTextChars) { ok = false; break; }
        var y = parseInt((m[1].match(/\d{3,4}/) || [])[0], 10);
        if (!isFinite(y)) { ok = false; break; }
        years.push(y);
        rows.push({ date: m[1].trim(), text: rest });
      }
      if (!ok) continue;

      var mono = true;
      for (var j = 1; j < years.length; j++) if (years[j] < years[j - 1]) { mono = false; break; }
      if (!mono || years[0] === years[years.length - 1]) continue;

      return { kind: 'timeline', title: 'Timeline', rows: rows };
    }
    return null;
  }

  var CMP_CTX = /\b(vs\.?|versus|compar\w*|differen\w*|pros\s*(?:and|&|\/)\s*cons)\b/i;
  var PROS_RE = /^(pros|advantages|benefits|strengths|upsides?)$/i;
  var CONS_RE = /^(cons|disadvantages|drawbacks|limitations|weaknesses|downsides?)$/i;

  function detectComparison(bubble) {
    var kids = bubble.children;
    for (var i = 0; i < kids.length - 1; i++) {
      if (!(headingLike(kids[i]) && kids[i + 1].tagName === 'UL')) continue;

      var groups = [];
      var j = i;
      while (j < kids.length - 1 && headingLike(kids[j]) && kids[j + 1].tagName === 'UL' && groups.length < 3) {
        var items = children(kids[j + 1], /^LI$/).map(cleanText);
        var good = items.length >= LIMITS.cmpItemsMin && items.length <= LIMITS.cmpItemsMax;
        for (var k = 0; good && k < items.length; k++) {
          if (!items[k] || items[k].length > LIMITS.cmpItemChars) good = false;
        }
        if (!good) break;
        groups.push({ title: cleanText(kids[j]), items: items });
        j += 2;
      }
      if (groups.length < 2) { i = Math.max(i, j - 1); continue; }

      var titles = groups.map(function (g) { return g.title; });
      var prosCons = groups.length === 2 &&
        ((PROS_RE.test(titles[0]) && CONS_RE.test(titles[1])) ||
         (CONS_RE.test(titles[0]) && PROS_RE.test(titles[1])));
      var ctx = contextBefore(kids[i]) + ' ' + titles.join(' ');
      if (!prosCons && !CMP_CTX.test(ctx)) { i = j - 1; continue; }

      return { kind: 'comparison', title: 'Comparison', groups: groups };
    }
    return null;
  }

  var VALUE_RE = new RegExp(
    '^(.{1,48}?)\\s*(?::|\\s[–—-]\\s)\\s*' +
    '(?:~|≈|about\\s+|approx\\.?\\s+|approximately\\s+)?' +
    '([$€£₹¥])?\\s?(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?\\s?' +
    '(%|k|K|m|M|bn|B|million|billion|thousand|crore|lakh)?\\.?$'
  );
  var NOT_DATA_LABEL = /^(step|phase|stage|day|week|month|year|q[1-4]|chapter|part|page|version|v)\s*\d*$/i;

  function detectValues(bubble) {
    var lists = children(bubble, /^UL$/);
    for (var i = 0; i < lists.length; i++) {
      var items = children(lists[i], /^LI$/);
      if (items.length < LIMITS.valuesMin || items.length > LIMITS.valuesMax) continue;

      var rows = [];
      var unitKey = null;
      var ok = true;
      for (var k = 0; k < items.length; k++) {
        var t = cleanText(items[k]);
        var m = VALUE_RE.exec(t);
        if (!m) { ok = false; break; }
        var label = stripTrailingPunct(m[1]);
        if (!/[A-Za-z\u00C0-\u024F\u0900-\u097F]/.test(label) || NOT_DATA_LABEL.test(label)) { ok = false; break; }
        var num = parseFloat((m[3] + (m[4] || '')).replace(/,/g, ''));
        if (!isFinite(num) || num < 0) { ok = false; break; }
        var key = (m[2] || '') + '|' + (m[5] || '').toLowerCase();
        if (unitKey === null) unitKey = key; else if (unitKey !== key) { ok = false; break; }
        var raw = m[0].slice(m[1].length).replace(/^\s*(?::|[–—-])\s*/, '').replace(/\.$/, '');
        rows.push({ label: label, value: num, shown: raw });
      }
      if (!ok) continue;

      var distinct = {};
      var allYears = true;
      var max = 0;
      var allPct = unitKey === '|%';
      for (var r = 0; r < rows.length; r++) {
        distinct[rows[r].value] = 1;
        if (!(rows[r].value >= 1900 && rows[r].value <= 2100 && Math.floor(rows[r].value) === rows[r].value)) allYears = false;
        if (rows[r].value > max) max = rows[r].value;
        if (rows[r].value > 100) allPct = false;
      }
      if (Object.keys(distinct).length < 2 || allYears || max <= 0) continue;

      return { kind: 'values', title: 'At a glance', rows: rows, scale: allPct ? 100 : max };
    }
    return null;
  }

  /* Deterministic classification, strict priority, at most ONE visual per answer. */
  function classify(bubble) {
    var text = bubble.textContent || '';
    if (text.length < LIMITS.minTextChars || text.length > LIMITS.maxTextChars) return null;
    if (bubble.getElementsByTagName('*').length > LIMITS.maxNodes) return null;

    return detectMermaid(bubble) ||
           detectSteps(bubble) ||
           detectTimeline(bubble) ||
           detectComparison(bubble) ||
           detectValues(bubble);
  }

  function frame(kind, title) {
    var fig = el('figure', 'atk-vz');
    fig.setAttribute('data-vz-kind', kind);
    fig.setAttribute('role', 'group');
    fig.setAttribute('aria-label', title);
    fig.appendChild(el('figcaption', 'atk-vz-title', title));
    return fig;
  }

  function buildSteps(d) {
    var fig = frame(d.kind, d.title);
    var ol = el('ol', 'atk-vz-steps');
    d.labels.forEach(function (label, i) {
      var li = el('li', 'atk-vz-step');
      li.appendChild(el('span', 'atk-vz-num', String(i + 1)));
      li.appendChild(el('span', 'atk-vz-label', label));
      ol.appendChild(li);
    });
    fig.appendChild(ol);
    return fig;
  }

  function buildTimeline(d) {
    var fig = frame(d.kind, d.title);
    var ol = el('ol', 'atk-vz-tl');
    d.rows.forEach(function (r) {
      var li = el('li', 'atk-vz-tl-item');
      li.appendChild(el('span', 'atk-vz-tl-date', r.date));
      li.appendChild(el('span', 'atk-vz-tl-text', r.text));
      ol.appendChild(li);
    });
    fig.appendChild(ol);
    return fig;
  }

  function buildComparison(d) {
    var fig = frame(d.kind, d.title);
    var grid = el('div', 'atk-vz-cmp');
    grid.setAttribute('data-cols', String(d.groups.length));
    d.groups.forEach(function (g) {
      var col = el('div', 'atk-vz-col');
      col.appendChild(el('div', 'atk-vz-col-title', g.title));
      var ul = el('ul', 'atk-vz-col-list');
      g.items.forEach(function (t) { ul.appendChild(el('li', null, t)); });
      col.appendChild(ul);
      grid.appendChild(col);
    });
    fig.appendChild(grid);
    return fig;
  }

  function buildValues(d) {
    var fig = frame(d.kind, d.title);
    var list = el('ul', 'atk-vz-bars');
    d.rows.forEach(function (r) {
      var li = el('li', 'atk-vz-bar');
      li.appendChild(el('span', 'atk-vz-bar-label', r.label));
      var track = el('span', 'atk-vz-bar-track');
      var fill = el('span', 'atk-vz-bar-fill');
      var pct = Math.max(2, Math.min(100, (r.value / d.scale) * 100));
      fill.style.width = pct.toFixed(1) + '%';
      track.appendChild(fill);
      li.appendChild(track);
      li.appendChild(el('span', 'atk-vz-bar-value', r.shown));
      list.appendChild(li);
    });
    fig.appendChild(list);
    return fig;
  }

  function buildNative(d) {
    switch (d.kind) {
      case 'steps':      return buildSteps(d);
      case 'timeline':   return buildTimeline(d);
      case 'comparison': return buildComparison(d);
      case 'values':     return buildValues(d);
      default:           return null;
    }
  }

  function loadMermaid() {
    if (global.mermaid && typeof global.mermaid.render === 'function') return Promise.resolve(global.mermaid);
    if (Date.now() - _mermaidFailedAt < MERMAID_COOLDOWN_MS) return Promise.resolve(null);
    if (global.navigator && global.navigator.onLine === false) return Promise.resolve(null);
    if (_mermaidPromise) return _mermaidPromise;

    _mermaidPromise = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = MERMAID_URL;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.setAttribute('data-atk-vz-mermaid', '');
      s.onload = function () { resolve(global.mermaid || null); };
      s.onerror = function () {
        _mermaidFailedAt = Date.now();
        if (s.parentNode) s.parentNode.removeChild(s);
        resolve(null);
      };
      document.head.appendChild(s);
    }).then(function (m) {
      if (!m) _mermaidPromise = null;      /* allow a retry after the cooldown */
      return m;
    });
    return _mermaidPromise;
  }

  function configureMermaid(m, dark) {
    var v = dark
      ? { background: '#1c1c1e', primaryColor: '#2c2c2e', primaryTextColor: '#f0f0f2', primaryBorderColor: '#48484a',
          secondaryColor: '#272727', tertiaryColor: '#272727', lineColor: '#8e8e93', textColor: '#e5e5e7',
          noteBkgColor: '#2c2c2e', noteTextColor: '#f0f0f2', actorBkg: '#2c2c2e', actorBorder: '#48484a',
          actorTextColor: '#f0f0f2', signalColor: '#8e8e93', signalTextColor: '#e5e5e7' }
      : { background: '#ffffff', primaryColor: '#f1f3f4', primaryTextColor: '#1a1a1a', primaryBorderColor: '#c9ced6',
          secondaryColor: '#f7f8f9', tertiaryColor: '#f7f8f9', lineColor: '#6b7280', textColor: '#1a1a1a',
          noteBkgColor: '#f7f8f9', noteTextColor: '#1a1a1a', actorBkg: '#f1f3f4', actorBorder: '#c9ced6',
          actorTextColor: '#1a1a1a', signalColor: '#6b7280', signalTextColor: '#1a1a1a' };
    v.fontFamily = "'Google Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
    v.fontSize = '14px';

    m.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: v,
      logLevel: 5,
      maxTextSize: LIMITS.mermaidChars,
      maxEdges: 40,
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true, curve: 'basis', padding: 10 },
      sequence: { useMaxWidth: true },
      timeline: { useMaxWidth: true },
      state: { useMaxWidth: true },
      pie: { useMaxWidth: true }
    });
  }

  /* Parse Mermaid's SVG string as XML, strip anything active, import as a real node. */
  function cleanSvg(svgText) {
    try {
      var doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      var root = doc.documentElement;
      if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;

      var bad = root.querySelectorAll('script, foreignObject, iframe, object, embed');
      for (var i = 0; i < bad.length; i++) bad[i].parentNode.removeChild(bad[i]);

      var all = root.querySelectorAll('*');
      var strip = function (n) {
        for (var a = n.attributes.length - 1; a >= 0; a--) {
          var name = n.attributes[a].name.toLowerCase();
          var val = String(n.attributes[a].value);
          if (name.indexOf('on') === 0 || /^\s*javascript:/i.test(val)) n.removeAttribute(n.attributes[a].name);
        }
      };
      strip(root);
      for (var j = 0; j < all.length; j++) strip(all[j]);

      var node = document.importNode(root, true);
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', 'Diagram');
      node.removeAttribute('height');
      return node;
    } catch (_) {
      return null;
    }
  }

  function removeMermaidTemps(id) {
    try {
      [id, 'd' + id, 'i' + id].forEach(function (x) {
        var n = document.getElementById(x);
        if (n && n.parentNode) n.parentNode.removeChild(n);
      });
    } catch (_) {}
  }

  function renderMermaidSvg(def, dark) {
    var s = validateMermaid(def);
    if (!s) return Promise.resolve(null);

    return loadMermaid().then(function (m) {
      if (!m) return null;
      var id = 'atkvz-m' + (++_idCounter);
      try {
        configureMermaid(m, dark);
        return Promise.resolve(m.parse(s, { suppressErrors: true })).then(function (ok) {
          if (!ok) return null;
          return m.render(id, s);
        }).then(function (res) {
          removeMermaidTemps(id);
          return res && typeof res.svg === 'string' ? cleanSvg(res.svg) : null;
        }).catch(function () {
          removeMermaidTemps(id);
          return null;
        });
      } catch (_) {
        removeMermaidTemps(id);
        return null;
      }
    }).catch(function () { return null; });
  }

  function buildMermaidFrame(def, svgNode, dark) {
    var fig = frame('mermaid', 'Diagram');
    fig.setAttribute('data-vz-src', def);
    fig.setAttribute('data-vz-theme', dark ? 'dark' : 'light');
    var holder = el('div', 'atk-vz-diagram');
    holder.appendChild(svgNode);
    fig.appendChild(holder);
    return fig;
  }

  function whenVisible(node) {
    if (node.getClientRects().length > 0 || typeof global.IntersectionObserver !== 'function') {
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      var io = new global.IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) { io.disconnect(); resolve(); return; }
        }
      });
      io.observe(node);
    });
  }

  function refreshTheme(root) {
    var scope = root || document;
    var figs = scope.querySelectorAll('.atk-vz[data-vz-kind="mermaid"]');
    var dark = isDark();
    var want = dark ? 'dark' : 'light';
    Array.prototype.forEach.call(figs, function (fig) {
      if (fig.getAttribute('data-vz-theme') === want) return;
      var def = fig.getAttribute('data-vz-src');
      if (!def) return;
      renderMermaidSvg(def, dark).then(function (svg) {
        if (!svg || !fig.isConnected) return;
        var holder = fig.querySelector('.atk-vz-diagram');
        if (!holder) return;
        while (holder.firstChild) holder.removeChild(holder.firstChild);
        holder.appendChild(svg);
        fig.setAttribute('data-vz-theme', want);
      });
    });
  }

  function bindThemeOnce() {
    if (_themeBound || !global.matchMedia) return;
    _themeBound = true;
    try {
      var mq = global.matchMedia('(prefers-color-scheme: dark)');
      var fn = function () { refreshTheme(document); };
      if (mq.addEventListener) mq.addEventListener('change', fn);
      else if (mq.addListener) mq.addListener(fn);
    } catch (_) {}
  }

  function resolveMsg(target) {
    if (!target || target.nodeType !== 1) return null;
    if (target.classList.contains('msg') && target.classList.contains('bot')) return target;
    var m = target.closest ? target.closest('.msg.bot') : null;
    return m || null;
  }

  function findBubble(msg) {
    var kids = msg.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].classList && kids[i].classList.contains('bubble')) return kids[i];
    }
    return null;
  }

  function removeFigures(msg) {
    var figs = msg.querySelectorAll(':scope > .atk-vz');
    for (var i = 0; i < figs.length; i++) figs[i].parentNode.removeChild(figs[i]);
  }

  function insertFigure(msg, bubble, fig) {
    removeFigures(msg);
    if (bubble.nextSibling) msg.insertBefore(fig, bubble.nextSibling);
    else msg.appendChild(fig);
    if (!reducedMotion()) fig.classList.add('atk-vz-in');
  }

  function enhance(target, options) {
    try {
      var msg = resolveMsg(target);
      if (!msg || msg.hasAttribute('data-stock')) return Promise.resolve(false);

      var force = !!(options && options.force);
      var state = msg.getAttribute(ATTR_STATE);
      if (!force && (state === 'done' || state === 'none')) return Promise.resolve(state === 'done');
      if (_running.has(msg)) return _running.get(msg);

      var bubble = findBubble(msg);
      if (!bubble || bubble.classList.contains('typing')) return Promise.resolve(false);

      bindThemeOnce();
      msg.setAttribute(ATTR_STATE, 'pending');
      removeFigures(msg);

      var token = ++_seq;
      _tokens.set(msg, token);

      var d = classify(bubble);
      if (!d) {
        msg.setAttribute(ATTR_STATE, 'none');
        return Promise.resolve(false);
      }

      if (d.kind !== 'mermaid') {
        var fig = buildNative(d);
        if (!fig) { msg.setAttribute(ATTR_STATE, 'none'); return Promise.resolve(false); }
        insertFigure(msg, bubble, fig);
        msg.setAttribute(ATTR_STATE, 'done');
        return Promise.resolve(true);
      }

      var dark = isDark();
      var p = whenVisible(msg).then(function () {
        if (_tokens.get(msg) !== token) return false;
        return renderMermaidSvg(d.def, dark);
      }).then(function (svg) {
        if (svg === false || _tokens.get(msg) !== token || !msg.isConnected) return false;
        if (!svg) { msg.setAttribute(ATTR_STATE, 'none'); return false; }   /* fail open: answer + code block stay */
        insertFigure(msg, bubble, buildMermaidFrame(d.def, svg, dark));
        msg.setAttribute(ATTR_STATE, 'done');
        return true;
      }).catch(function () {
        if (_tokens.get(msg) === token) msg.setAttribute(ATTR_STATE, 'none');
        return false;
      }).then(function (r) {
        _running.delete(msg);
        return r;
      });

      _running.set(msg, p);
      return p;
    } catch (_) {
      return Promise.resolve(false);
    }
  }

  function restore(root) {
    try {
      if (!root || !root.querySelectorAll) return;
      bindThemeOnce();
      var msgs = root.querySelectorAll('.msg.bot');
      Array.prototype.forEach.call(msgs, function (msg) {
        /* a snapshot can never legitimately hold more than one visual */
        var figs = msg.querySelectorAll(':scope > .atk-vz');
        for (var i = 1; i < figs.length; i++) figs[i].parentNode.removeChild(figs[i]);

        var state = msg.getAttribute(ATTR_STATE);
        if (state === 'done' && !figs.length) { msg.removeAttribute(ATTR_STATE); state = null; }
        if (state === 'pending') { removeFigures(msg); msg.removeAttribute(ATTR_STATE); state = null; }
        if (!state) enhance(msg);
      });
      refreshTheme(root);
    } catch (_) {}
  }

  function destroy(container) {
    try {
      if (!container || !container.querySelectorAll) return;
      var scope = container;
      var msgs = [];
      if (container.classList && container.classList.contains('msg')) msgs.push(container);
      Array.prototype.push.apply(msgs, container.querySelectorAll('.msg.bot'));
      msgs.forEach(function (msg) {
        _tokens.set(msg, ++_seq);          /* invalidate any in-flight render */
        _running.delete(msg);
        removeFigures(msg);
        msg.removeAttribute(ATTR_STATE);
      });
      var stray = scope.querySelectorAll('.atk-vz');
      for (var i = 0; i < stray.length; i++) if (stray[i].parentNode) stray[i].parentNode.removeChild(stray[i]);
    } catch (_) {}
  }

  function renderDiagram(target, definition, options) {
    try {
      if (!target || target.nodeType !== 1) return Promise.resolve(false);
      var def = validateMermaid(definition);
      if (!def) return Promise.resolve(false);
      var dark = options && typeof options.dark === 'boolean' ? options.dark : isDark();
      bindThemeOnce();
      return renderMermaidSvg(def, dark).then(function (svg) {
        if (!svg || !target.isConnected) return false;
        var old = target.querySelectorAll(':scope > .atk-vz');
        for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
        target.appendChild(buildMermaidFrame(def, svg, dark));
        return true;
      }).catch(function () { return false; });
    } catch (_) {
      return Promise.resolve(false);
    }
  }

  global.VisualEngine = Object.freeze({
    enhance: enhance,
    restore: restore,
    destroy: destroy,
    renderDiagram: renderDiagram,
    version: '1.0.0'
  });
})(window);
