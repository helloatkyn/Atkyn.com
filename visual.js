/* visual.js — ATKYN Visual Engine (frontend-only, no extra AI call).
   Adds up to three deterministic, structure-backed visuals to a finished bot answer.
   Visuals remain siblings of .bubble so answer text, citations and Copy source stay untouched.
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
    valuesMin: 3, valuesMax: 10,
    minSectionTextChars: 80,
    maxVisualsPerAnswer: 3,
    maxPerType: 1,
    maxSections: 40,
    flowMin: 3, flowMax: 8,
    relationshipMin: 2, relationshipMax: 8,
    hierarchyMaxNodes: 24,
    hierarchyMaxDepth: 3,
    chartMinRows: 2, chartMaxRows: 10
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

  function hasPositiveContext(re, text) {
    var source = String(text || '');
    var flags = (re.ignoreCase ? 'i' : '') + 'g';
    var matcher = new RegExp(re.source, flags);
    var match;
    while ((match = matcher.exec(source))) {
      var before = source.slice(Math.max(0, match.index - 36), match.index);
      if (/\b(?:no|not|without|never|isn't|is not|doesn't|don't|lacks?)\s+(?:(?:any|an?|explicit|a clear)\s+)?$/i.test(before)) continue;
      return true;
    }
    return false;
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

  /* ── Explicit, structure-backed visual types ───────────────── */
  var FLOW_CTX = /\b(?:flowchart|process flow|workflow|pipeline|lifecycle|life cycle|sequence)\b/i;
  var HIERARCHY_CTX = /\b(?:hierarch(?:y|ical)|tree|architecture|organi[sz]ation(?:al)? chart|concept map|taxonomy|components|structure)\b/i;
  var DECISION_CTX = /\b(?:decision tree|decision flow|if\/then|choose|should i|whether to)\b/i;
  var OUTCOME_RE = /^(yes|no|true|false|pass|fail|otherwise|if yes|if no)\s*(?::|[-–—])\s*(.{2,90})$/i;

  function parseArrowPair(raw) {
    var text = String(raw || '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').trim();
    var re = /<->|↔|⟶|→|->/g;
    var match = re.exec(text);
    if (!match || re.exec(text)) return null;
    var from = text.slice(0, match.index).trim();
    var to = text.slice(match.index + match[0].length).trim();
    if (!from || !to || from.length > 70 || to.length > 70) return null;
    if (/[→↔⟶]|->|<->/.test(from) || /[→↔⟶]|->|<->/.test(to)) return null;
    return { from: from, arrow: match[0], to: to };
  }

  function detectRelationships(bubble) {
    var lists = children(bubble, /^(UL|OL)$/);
    for (var i = 0; i < lists.length; i++) {
      var items = children(lists[i], /^LI$/);
      if (items.length < LIMITS.relationshipMin || items.length > LIMITS.relationshipMax) continue;
      var rows = [];
      var ok = true;
      for (var j = 0; j < items.length; j++) {
        var edge = parseArrowPair(cleanText(items[j]));
        if (!edge) { ok = false; break; }
        rows.push(edge);
      }
      if (ok) return { kind: 'relationships', title: 'Relationships', rows: rows };
    }

    var paragraphs = children(bubble, /^P$/);
    var edges = [];
    for (var k = 0; k < paragraphs.length; k++) {
      var pair = parseArrowPair(cleanText(paragraphs[k]));
      if (pair) edges.push(pair);
    }
    if (edges.length >= LIMITS.relationshipMin && edges.length <= LIMITS.relationshipMax) {
      return { kind: 'relationships', title: 'Relationships', rows: edges };
    }
    return null;
  }

  function parseTreeNode(li, depth, stats) {
    if (depth > LIMITS.hierarchyMaxDepth || ++stats.nodes > LIMITS.hierarchyMaxNodes) return null;
    var label = cleanText(li);
    if (!label || label.length > 80) return null;
    var nested = children(li, /^(UL|OL)$/);
    if (nested.length > 1) return null;
    var node = { label: label, children: [] };
    if (nested.length) {
      var items = children(nested[0], /^LI$/);
      if (items.length < 2 || items.length > 8) return null;
      stats.hasBranch = true;
      stats.maxDepth = Math.max(stats.maxDepth, depth + 1);
      for (var i = 0; i < items.length; i++) {
        var child = parseTreeNode(items[i], depth + 1, stats);
        if (!child) return null;
        node.children.push(child);
      }
    }
    return node;
  }

  function detectDecisionTree(bubble) {
    var lists = children(bubble, /^(UL|OL)$/);
    for (var i = 0; i < lists.length; i++) {
      var roots = children(lists[i], /^LI$/);
      for (var j = 0; j < roots.length; j++) {
        var question = cleanText(roots[j]);
        var nested = children(roots[j], /^(UL|OL)$/);
        if (!question || question.length > 110 || !nested.length) continue;
        if (!/[?？]$/.test(question) && !/^(if|whether|should|can|could|does|do|is|are|will|has|have)\b/i.test(question)) continue;
        var outcomes = children(nested[0], /^LI$/);
        if (outcomes.length < 2 || outcomes.length > 4) continue;
        var branches = [];
        var kinds = {};
        var valid = true;
        for (var k = 0; k < outcomes.length; k++) {
          if (children(outcomes[k], /^(UL|OL)$/).length) { valid = false; break; }
          var m = OUTCOME_RE.exec(cleanText(outcomes[k]));
          if (!m || kinds[m[1].toLowerCase()]) { valid = false; break; }
          kinds[m[1].toLowerCase()] = true;
          branches.push({ outcome: m[1], text: m[2].trim() });
        }
        var paired = (kinds.yes && kinds.no) || (kinds['if yes'] && kinds['if no']) || (kinds.true && kinds.false) || (kinds.pass && kinds.fail);
        if (valid && paired) {
          return { kind: 'decision-tree', title: 'Decision', question: question, branches: branches };
        }
      }
    }
    return null;
  }

  function detectHierarchy(bubble) {
    var contextNode = firstListChild(bubble);
    if (!contextNode) return null;
    var ctx = contextBefore(contextNode);
    if (!hasPositiveContext(HIERARCHY_CTX, ctx)) return null;
    var lists = children(bubble, /^(UL|OL)$/);
    for (var i = 0; i < lists.length; i++) {
      var roots = children(lists[i], /^LI$/);
      if (roots.length < 2 || roots.length > 6) continue;
      var stats = { nodes: 0, hasBranch: false, maxDepth: 0 };
      var tree = [];
      var valid = true;
      for (var j = 0; j < roots.length; j++) {
        var node = parseTreeNode(roots[j], 0, stats);
        if (!node) { valid = false; break; }
        tree.push(node);
      }
      if (valid && stats.hasBranch && stats.nodes >= 4) {
        return { kind: 'hierarchy', title: 'Structure', tree: tree };
      }
    }
    return null;
  }

  function firstListChild(bubble) {
    var kids = bubble ? bubble.children : [];
    for (var i = 0; i < kids.length; i++) if (/^(UL|OL)$/.test(kids[i].tagName)) return kids[i];
    return null;
  }

  function parseFlowLabels(raw) {
    var text = String(raw || '').replace(/[.!?]+$/, '').trim();
    var labels = text.split(/\s*(?:→|->|⟶)\s*/);
    if (labels.length < LIMITS.flowMin || labels.length > LIMITS.flowMax) return null;
    for (var i = 0; i < labels.length; i++) {
      labels[i] = labels[i].trim();
      if (labels[i].length < 2 || labels[i].length > LIMITS.stepLabelChars || /[→⟶]|->/.test(labels[i])) return null;
    }
    return labels;
  }

  function detectFlowchart(bubble) {
    var paragraphs = children(bubble, /^P$/);
    for (var i = 0; i < paragraphs.length; i++) {
      var labels = parseFlowLabels(cleanText(paragraphs[i]));
      if (labels) return { kind: 'flowchart', title: 'Process flow', labels: labels };
    }

    var lists = children(bubble, /^OL$/);
    for (var j = 0; j < lists.length; j++) {
      var ctx = contextBefore(lists[j]);
      if (!hasPositiveContext(FLOW_CTX, ctx)) continue;
      var items = children(lists[j], /^LI$/);
      if (items.length < LIMITS.flowMin || items.length > LIMITS.flowMax) continue;
      var steps = [];
      var valid = true;
      for (var k = 0; k < items.length; k++) {
        var t = cleanText(items[k]);
        if (!t || t.length > LIMITS.stepLabelChars) { valid = false; break; }
        steps.push(t);
      }
      if (valid) return { kind: 'flowchart', title: 'Process flow', labels: steps };
    }
    return null;
  }

  function parseNumericCell(raw) {
    var text = String(raw || '').replace(/\s+/g, ' ').trim();
    var m = text.match(/^([$€£₹¥])?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|k|K|m|M|bn|B|million|billion|thousand|crore|lakh)?$/);
    if (!m) return null;
    var value = parseFloat((m[2] + (m[3] || '')).replace(/,/g, ''));
    if (!isFinite(value) || value < 0) return null;
    return { value: value, key: (m[1] || '') + '|' + (m[4] || '').toLowerCase(), shown: text };
  }

  function detectChart(bubble) {
    var tables = bubble.querySelectorAll('table');
    for (var i = 0; i < tables.length && i < 3; i++) {
      var table = tables[i];
      var rows = table.querySelectorAll('tr');
      if (rows.length < LIMITS.chartMinRows + 1 || rows.length > LIMITS.chartMaxRows + 1) continue;
      var headers = children(rows[0], /^(TH|TD)$/);
      if (headers.length !== 2) continue;
      var categoryTitle = cleanText(headers[0]);
      var metricTitle = cleanText(headers[1]);
      if (!categoryTitle || !metricTitle || categoryTitle.length > 60 || metricTitle.length > 60) continue;
      var data = [];
      var unitKey = null;
      var ok = true;
      var allYears = true;
      var max = 0;
      var distinct = {};
      var labels = {};
      for (var j = 1; j < rows.length; j++) {
        var cells = children(rows[j], /^(TH|TD)$/);
        if (cells.length !== 2) { ok = false; break; }
        var label = cleanText(cells[0]);
        var parsed = parseNumericCell(cleanText(cells[1]));
        if (!label || label.length > 70 || !parsed || labels[label]) { ok = false; break; }
        labels[label] = true;
        if (unitKey === null) unitKey = parsed.key;
        else if (unitKey !== parsed.key) { ok = false; break; }
        if (!(parsed.value >= 1900 && parsed.value <= 2100 && Math.floor(parsed.value) === parsed.value)) allYears = false;
        if (parsed.value > max) max = parsed.value;
        distinct[parsed.value] = true;
        data.push({ label: label, value: parsed.value, shown: parsed.shown });
      }
      if (!ok || data.length < LIMITS.chartMinRows || data.length > LIMITS.chartMaxRows || allYears || max <= 0 || Object.keys(distinct).length < 2) continue;
      return { kind: 'chart', title: metricTitle + ' by ' + categoryTitle, rows: data, scale: max, categoryTitle: categoryTitle, metricTitle: metricTitle };
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
      if (!hasPositiveContext(PROCESS_CTX, contextBefore(lists[i]))) continue;

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
      if (!prosCons && !hasPositiveContext(CMP_CTX, ctx)) { i = j - 1; continue; }

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

  /* Deterministic classification. Section-level callers use a lower, bounded text floor. */
  function classify(bubble, sectionMode) {
    var text = bubble.textContent || '';
    var floor = sectionMode ? LIMITS.minSectionTextChars : LIMITS.minTextChars;
    if (text.length < floor || text.length > LIMITS.maxTextChars) return null;
    if (bubble.getElementsByTagName('*').length > LIMITS.maxNodes) return null;

    return detectMermaid(bubble) ||
           detectDecisionTree(bubble) ||
           detectRelationships(bubble) ||
           detectHierarchy(bubble) ||
           detectChart(bubble) ||
           detectTimeline(bubble) ||
           detectFlowchart(bubble) ||
           detectSteps(bubble) ||
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

  function buildFlowchart(d) {
    var fig = frame(d.kind, d.title);
    var ol = el('ol', 'atk-vz-flow');
    d.labels.forEach(function (label) {
      var li = el('li', 'atk-vz-flow-item');
      li.appendChild(el('span', 'atk-vz-flow-node', label));
      ol.appendChild(li);
    });
    fig.appendChild(ol);
    return fig;
  }

  function buildRelationships(d) {
    var fig = frame(d.kind, d.title);
    var list = el('ol', 'atk-vz-relations');
    d.rows.forEach(function (r) {
      var li = el('li', 'atk-vz-relation');
      li.appendChild(el('span', 'atk-vz-rel-from', r.from));
      li.appendChild(el('span', 'atk-vz-rel-arrow', r.arrow));
      li.appendChild(el('span', 'atk-vz-rel-to', r.to));
      list.appendChild(li);
    });
    fig.appendChild(list);
    return fig;
  }

  function buildTreeNodes(nodes, className) {
    var ul = el('ul', className);
    nodes.forEach(function (node) {
      var li = el('li', 'atk-vz-tree-item');
      li.appendChild(el('span', 'atk-vz-tree-label', node.label));
      if (node.children && node.children.length) li.appendChild(buildTreeNodes(node.children, 'atk-vz-tree-children'));
      ul.appendChild(li);
    });
    return ul;
  }

  function buildHierarchy(d) {
    var fig = frame(d.kind, d.title);
    fig.appendChild(buildTreeNodes(d.tree, 'atk-vz-hierarchy'));
    return fig;
  }

  function buildDecisionTree(d) {
    var fig = frame(d.kind, d.title);
    fig.appendChild(el('div', 'atk-vz-decision-question', d.question));
    var branches = el('div', 'atk-vz-decision-branches');
    d.branches.forEach(function (branch) {
      var item = el('div', 'atk-vz-decision-branch');
      item.appendChild(el('div', 'atk-vz-decision-outcome', branch.outcome));
      item.appendChild(el('div', 'atk-vz-decision-text', branch.text));
      branches.appendChild(item);
    });
    fig.appendChild(branches);
    return fig;
  }

  function buildChart(d) {
    var fig = frame(d.kind, d.title);
    var list = el('ul', 'atk-vz-bars atk-vz-chart');
    d.rows.forEach(function (r) {
      var li = el('li', 'atk-vz-bar');
      li.appendChild(el('span', 'atk-vz-bar-label', r.label));
      var track = el('span', 'atk-vz-bar-track');
      track.setAttribute('role', 'img');
      track.setAttribute('aria-label', r.label + ': ' + r.shown);
      var fill = el('span', 'atk-vz-bar-fill');
      fill.style.width = Math.max(2, Math.min(100, (r.value / d.scale) * 100)).toFixed(1) + '%';
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
      case 'steps':         return buildSteps(d);
      case 'timeline':      return buildTimeline(d);
      case 'comparison':    return buildComparison(d);
      case 'values':        return buildValues(d);
      case 'flowchart':     return buildFlowchart(d);
      case 'relationships': return buildRelationships(d);
      case 'hierarchy':     return buildHierarchy(d);
      case 'decision-tree': return buildDecisionTree(d);
      case 'chart':         return buildChart(d);
      default:              return null;
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

      var bad = root.querySelectorAll('script, foreignObject, iframe, object, embed, a, image');
      for (var i = 0; i < bad.length; i++) bad[i].parentNode.removeChild(bad[i]);

      var all = root.querySelectorAll('*');
      var strip = function (n) {
        for (var a = n.attributes.length - 1; a >= 0; a--) {
          var name = n.attributes[a].name.toLowerCase();
          var val = String(n.attributes[a].value);
          var attrName = n.attributes[a].name;
          var isHref = name === 'href' || name === 'xlink:href';
          var unsafeUrl = /(?:javascript:|data:|vbscript:|expression\s*\(|url\s*\(\s*['"]?(?!#))/i.test(val);
          if (name.indexOf('on') === 0 || name === 'src' || name === 'srcset' || unsafeUrl || (isHref && val.charAt(0) !== '#')) {
            n.removeAttribute(attrName);
          }
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

  function headingLevel(node) {
    return node && /^H[1-6]$/.test(node.tagName) ? parseInt(node.tagName.slice(1), 10) : 0;
  }

  function sectionTitle(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      if (headingLevel(nodes[i])) return cleanText(nodes[i]).slice(0, 100);
    }
    return '';
  }

  /* Split on actual block headings only. Nodes are cloned for analysis, never reparented. */
  function answerSections(bubble) {
    var kids = [];
    for (var i = 0; i < bubble.children.length; i++) kids.push(bubble.children[i]);
    var headingIndexes = [];
    for (var j = 0; j < kids.length; j++) if (headingLevel(kids[j])) headingIndexes.push(j);
    if (!headingIndexes.length) return null;

    var sections = [];
    var start = 0;
    var h = 0;
    while (h < headingIndexes.length) {
      var at = headingIndexes[h];
      if (at > start) sections.push({ nodes: kids.slice(start, at), title: '' });
      var end = h + 1 < headingIndexes.length ? headingIndexes[h + 1] : kids.length;
      var lastHeading = h;
      var currentAt = at;

      /* Keep adjacent heading + unordered-list comparison groups together. */
      if (headingLike(kids[at]) && kids[at + 1] && kids[at + 1].tagName === 'UL') {
        while (lastHeading + 1 < headingIndexes.length) {
          var nextAt = headingIndexes[lastHeading + 1];
          if (nextAt !== currentAt + 2 || !headingLike(kids[nextAt]) || !kids[nextAt + 1] || kids[nextAt + 1].tagName !== 'UL') break;
          currentAt = nextAt;
          lastHeading++;
        }
        end = lastHeading + 1 < headingIndexes.length ? headingIndexes[lastHeading + 1] : kids.length;
      }

      if (end > at) {
        var sourceNodes = kids.slice(at, end);
        var analysisNodes = sourceNodes.slice();
        var level = headingLevel(kids[at]);
        var priorHeading = -1;
        for (var q = at - 1; q >= 0; q--) {
          if (headingLevel(kids[q])) { priorHeading = q; break; }
        }
        if (priorHeading >= 0 && headingLevel(kids[priorHeading]) < level) {
          var onlyContextText = true;
          for (var c = priorHeading + 1; c < at; c++) {
            if (kids[c].tagName !== 'P') { onlyContextText = false; break; }
          }
          if (onlyContextText) analysisNodes = kids.slice(priorHeading, at).concat(sourceNodes);
        }
        sections.push({ nodes: analysisNodes, title: sectionTitle(sourceNodes) });
      }
      start = end;
      h = lastHeading + 1;
    }
    if (start < kids.length) sections.push({ nodes: kids.slice(start), title: '' });
    return sections.slice(0, LIMITS.maxSections);
  }

  function classifySections(bubble) {
    var sections = answerSections(bubble);
    var candidates = [];
    var seenTypes = {};
    var seenSignatures = {};

    function accept(data, title, index) {
      if (!data || candidates.length >= LIMITS.maxVisualsPerAnswer) return;
      if ((seenTypes[data.kind] || 0) >= LIMITS.maxPerType) return;
      var signature = data.kind + ':' + JSON.stringify(data);
      if (seenSignatures[signature]) return;
      seenSignatures[signature] = true;
      seenTypes[data.kind] = (seenTypes[data.kind] || 0) + 1;
      data.sectionTitle = title || '';
      data.sectionIndex = index;
      candidates.push(data);
    }

    if (sections) {
      for (var i = 0; i < sections.length && candidates.length < LIMITS.maxVisualsPerAnswer; i++) {
        var spec = sections[i];
        var sample = document.createElement('div');
        for (var j = 0; j < spec.nodes.length; j++) sample.appendChild(spec.nodes[j].cloneNode(true));
        accept(classify(sample, true), spec.title, i);
      }
    }

    /* Preserve legacy behavior for unheaded answers and for sections without a match. */
    if (!candidates.length) accept(classify(bubble, false), '', 0);
    return candidates;
  }

  function decorateFigure(fig, data) {
    if (!fig || !data) return fig;
    if (data.sectionTitle) {
      fig.setAttribute('data-vz-section', data.sectionTitle);
      fig.setAttribute('data-vz-section-index', String(data.sectionIndex));
      var caption = fig.querySelector('.atk-vz-title');
      if (caption) caption.textContent = data.title + ' — ' + data.sectionTitle;
    }
    if (!reducedMotion()) fig.classList.add('atk-vz-in');
    return fig;
  }

  function insertFigures(msg, bubble, figures) {
    removeFigures(msg);
    var reference = bubble.nextSibling;
    for (var i = 0; i < figures.length; i++) {
      if (!figures[i]) continue;
      msg.insertBefore(figures[i], reference || null);
    }
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
      msg.removeAttribute('data-vz-count');
      removeFigures(msg);

      var token = ++_seq;
      _tokens.set(msg, token);
      var plans = classifySections(bubble);
      if (!plans.length) {
        msg.removeAttribute('data-vz-count');
        msg.setAttribute(ATTR_STATE, 'none');
        return Promise.resolve(false);
      }

      var dark = isDark();
      var p = Promise.all(plans.map(function (d) {
        if (d.kind !== 'mermaid') {
          try { return Promise.resolve(decorateFigure(buildNative(d), d)); }
          catch (_) { return Promise.resolve(null); }
        }
        return whenVisible(msg).then(function () {
          if (_tokens.get(msg) !== token) return null;
          return renderMermaidSvg(d.def, dark).then(function (svg) {
            if (!svg || _tokens.get(msg) !== token || !msg.isConnected) return null;
            return decorateFigure(buildMermaidFrame(d.def, svg, dark), d);
          });
        }).catch(function () { return null; });
      })).then(function (figures) {
        if (_tokens.get(msg) !== token || !msg.isConnected) return false;
        var usable = figures.filter(function (fig) { return !!fig; });
        if (!usable.length) {
          msg.removeAttribute('data-vz-count');
          msg.setAttribute(ATTR_STATE, 'none');
          return false;
        }
        insertFigures(msg, bubble, usable);
        msg.setAttribute('data-vz-count', String(usable.length));
        msg.setAttribute(ATTR_STATE, 'done');
        return true;
      }).catch(function () {
        if (_tokens.get(msg) === token) msg.setAttribute(ATTR_STATE, 'none');
        return false;
      }).then(function (result) {
        _running.delete(msg);
        return result;
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
      var msgs = Array.prototype.slice.call(root.querySelectorAll('.msg.bot'));
      if (root.classList && root.classList.contains('msg') && root.classList.contains('bot')) msgs.unshift(root);
      Array.prototype.forEach.call(msgs, function (msg) {
        var figs = Array.prototype.slice.call(msg.querySelectorAll(':scope > .atk-vz'));
        var countByType = {};
        var seenSignatures = {};
        var kept = 0;
        for (var i = 0; i < figs.length; i++) {
          var kind = figs[i].getAttribute('data-vz-kind') || 'unknown';
          var signature = kind + ':' + (figs[i].getAttribute('data-vz-section') || '') + ':' + (figs[i].textContent || '').replace(/\s+/g, ' ').trim();
          var overType = (countByType[kind] || 0) >= LIMITS.maxPerType;
          if (kept >= LIMITS.maxVisualsPerAnswer || overType || seenSignatures[signature]) {
            figs[i].parentNode.removeChild(figs[i]);
            continue;
          }
          countByType[kind] = (countByType[kind] || 0) + 1;
          seenSignatures[signature] = true;
          kept++;
        }

        var state = msg.getAttribute(ATTR_STATE);
        var left = msg.querySelectorAll(':scope > .atk-vz').length;
        var expected = parseInt(msg.getAttribute('data-vz-count'), 10);
        if (state === 'done' && (!left || (isFinite(expected) && expected > left))) {
          removeFigures(msg);
          msg.removeAttribute('data-vz-count');
          msg.removeAttribute(ATTR_STATE);
          state = null;
        }
        if (state === 'pending') {
          _tokens.set(msg, ++_seq);
          _running.delete(msg);
          removeFigures(msg);
          msg.removeAttribute('data-vz-count');
          msg.removeAttribute(ATTR_STATE);
          state = null;
        }
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
        msg.removeAttribute('data-vz-count');
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
