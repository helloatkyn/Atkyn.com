/* ═══════════════════════════════════════════════════════════════
   renderer.js — Atkyn Search
   Markdown + Math : marked.js@13 + marked-katex-extension + KaTeX
   Code highlight  : highlight.js
   ═══════════════════════════════════════════════════════════════ */

/* ── HTML entity escape ── */
function _he(s) {
  const src = String(s);
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if      (c === '&')  out.push('&amp;');
    else if (c === '<')  out.push('&lt;');
    else if (c === '>')  out.push('&gt;');
    else if (c === '"')  out.push('&quot;');
    else if (c === "'")  out.push('&#39;');
    else                 out.push(c);
  }
  return out.join('');
}

/* ── Cheap string hash for render caching ── */
function _cheapHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h;
}

/* ── Collapse excessive blank lines, strip leading/trailing newlines ── */
function _normalizeNewlines(str) {
  let start = 0;
  while (start < str.length && str[start] === '\n') start++;
  let end = str.length - 1;
  while (end >= start && str[end] === '\n') end--;
  if (start > end) return '';
  const out = [];
  let i = start;
  while (i <= end) {
    if (str[i] !== '\n') { out.push(str[i]); i++; }
    else {
      let run = 0;
      while (i <= end && str[i] === '\n') { run++; i++; }
      out.push('\n');
      if (run > 1) out.push('\n');
    }
  }
  return out.join('');
}

/* ── Generate collision-resistant placeholder ── */
function _makePlaceholder(type, index) {
  const random = Math.random().toString(36).slice(2, 10);
  return '\uE000ATKYN_' + type + '_' + random + '_' + index + '\uE001';
}

/* ── Stack-based scanner for complete LaTeX environments ── */
function _findCompleteEnvironments(str) {
  const envs = [];
  const stack = [];
  const startPositions = [];

  let pos = 0;
  while (pos < str.length) {
    const beginIdx = str.indexOf('\\begin{', pos);
    const endIdx = str.indexOf('\\end{', pos);

    if (beginIdx === -1 && endIdx === -1) break;

    if (endIdx !== -1 && (beginIdx === -1 || endIdx < beginIdx)) {
      // Found \end before any \begin
      const match = str.substring(endIdx + 6).match(/^([^}]*)\}/);
      if (match) {
        const envName = match[1];
        if (stack.length > 0 && stack[stack.length - 1] === envName) {
          // Complete an environment
          const startPos = startPositions.pop();
          stack.pop();
          const endPos = endIdx + 6 + envName.length + 1;
          envs.push({
            content: str.substring(startPos, endPos),
            start: startPos,
            end: endPos,
            envName: envName
          });
          pos = endPos;
          continue;
        }
      }
      pos = endIdx + 1;
      continue;
    }

    if (beginIdx !== -1 && (endIdx === -1 || beginIdx < endIdx)) {
      const match = str.substring(beginIdx + 7).match(/^([^}]*)\}/);
      if (match) {
        const envName = match[1];
        stack.push(envName);
        startPositions.push(beginIdx);
        pos = beginIdx + 7 + envName.length + 1;
      } else {
        pos = beginIdx + 1;
      }
      continue;
    }

    pos++;
  }

  return envs;
}

/* ── Protect and wrap complete LaTeX environments ── */
function _protectLatexEnvironments(str) {
  const environments = [];
  let protectedStr = str;

  const envs = _findCompleteEnvironments(protectedStr);
  // Sort by start descending to replace without offset issues
  envs.sort((a, b) => b.start - a.start);

  for (let i = 0; i < envs.length; i++) {
    const env = envs[i];
    const placeholder = _makePlaceholder('ENV', environments.length);
    const wrapped = '$$\n' + env.content.trim() + '\n$$';
    environments.push({ placeholder, content: wrapped });
    protectedStr = protectedStr.substring(0, env.start) +
                   placeholder +
                   protectedStr.substring(env.end);
  }

  return { str: protectedStr, environments };
}

/* ── Protect explicit math delimiters ── */
function _protectExplicitMath(str) {
  const mathBlocks = [];
  let protectedStr = str;

  // Protect $$...$$ display math
  protectedStr = protectedStr.replace(/\$\$([\s\S]*?)\$\$/g, function(match) {
    const placeholder = _makePlaceholder('MATH_DISPLAY', mathBlocks.length);
    mathBlocks.push({ placeholder, content: match });
    return placeholder;
  });

  // Protect \[...\] display math
  protectedStr = protectedStr.replace(/\\\[([\s\S]*?)\\\]/g, function(match) {
    const placeholder = _makePlaceholder('MATH_BRACKET', mathBlocks.length);
    mathBlocks.push({ placeholder, content: match });
    return placeholder;
  });

  // Protect $...$ inline math (but not currency)
  protectedStr = protectedStr.replace(/\$([^$\n]+?)\$/g, function(match, inner) {
    if (/^\s*[\d,]+\s*$/.test(inner)) return match;
    if (/^\s*[\d,]+\s*\.\s*[\d]+\s*$/.test(inner)) return match;
    const placeholder = _makePlaceholder('MATH_INLINE', mathBlocks.length);
    mathBlocks.push({ placeholder, content: match });
    return placeholder;
  });

  // Protect \(...\) inline math
  protectedStr = protectedStr.replace(/\\\(([\s\S]*?)\\\)/g, function(match) {
    const placeholder = _makePlaceholder('MATH_PAREN', mathBlocks.length);
    mathBlocks.push({ placeholder, content: match });
    return placeholder;
  });

  return { str: protectedStr, mathBlocks };
}

/* ── Detect bare LaTeX expressions ── */
function _detectBareLatex(str) {
  const lines = str.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip lines with placeholders
    if (/\uE000ATKYN_/.test(line)) {
      result.push(line);
      continue;
    }

    if (!line || line.trim() === '') {
      result.push(line);
      continue;
    }

    const trimmed = line.trim();

    // Must contain LaTeX commands
    const hasLatexCommand = /\\[a-zA-Z]+/.test(trimmed);
    if (!hasLatexCommand) {
      result.push(line);
      continue;
    }

    // Must have mathematical structure
    const hasMathStructure = /[\^_]/.test(trimmed) ||
                            /\\frac\s*\{[^}]*\}\s*\{[^}]*\}/.test(trimmed) ||
                            /\\sqrt\s*\{[^}]*\}/.test(trimmed) ||
                            /[a-zA-Z]\s*[=+*/^-]\s*[a-zA-Z0-9]/.test(trimmed) ||
                            /[=+*/^-]\s*[a-zA-Z0-9]/.test(trimmed) ||
                            /[a-zA-Z0-9]\s*[=+*/^-]/.test(trimmed);

    if (!hasMathStructure) {
      result.push(line);
      continue;
    }

    // Check for common math commands
    const mathCommands = ['\\int', '\\sum', '\\prod', '\\lim', '\\sin', '\\cos',
                         '\\tan', '\\log', '\\ln', '\\alpha', '\\beta', '\\gamma',
                         '\\theta', '\\pi', '\\infty', '\\pm', '\\leq', '\\geq',
                         '\\neq', '\\cdot', '\\partial', '\\nabla'];

    let hasMathCommand = false;
    for (let j = 0; j < mathCommands.length; j++) {
      if (trimmed.includes(mathCommands[j])) {
        hasMathCommand = true;
        break;
      }
    }

    if (!hasMathCommand && !/\\begin|\\end/.test(trimmed)) {
      if (!/\\frac|\\sqrt/.test(trimmed) && !/[\^_]\s*\{/.test(trimmed)) {
        result.push(line);
        continue;
      }
    }

    // Check it's not prose with a single LaTeX symbol
    const wordCount = trimmed.split(/\s+/).length;
    const latexCount = (trimmed.match(/\\[a-zA-Z]+/g) || []).length;

    if (wordCount > 10 && latexCount <= 2) {
      result.push(line);
      continue;
    }

    if (wordCount <= 3 && latexCount === 1 && !/[\^_=]/.test(trimmed)) {
      result.push(line);
      continue;
    }

    // Wrap as display math
    result.push('$$\n' + trimmed + '\n$$');
  }

  return result.join('\n');
}

/* ── Safe LaTeX normalization with code block protection ── */
function _normalizeLatex(raw) {
  if (!raw) return raw;

  // Step 1: Protect fenced code blocks
  let protectedStr = raw;
  const fencedCode = [];

  protectedStr = protectedStr.replace(/(```[\s\S]*?```)/g, function(match) {
    const placeholder = _makePlaceholder('FENCED_CODE', fencedCode.length);
    fencedCode.push({ placeholder, content: match });
    return placeholder;
  });

  // Step 2: Protect inline code
  const inlineCode = [];
  protectedStr = protectedStr.replace(/`([^`]+)`/g, function(match) {
    const placeholder = _makePlaceholder('INLINE_CODE', inlineCode.length);
    inlineCode.push({ placeholder, content: match });
    return placeholder;
  });

  // Step 3: Protect explicit math
  const mathResult = _protectExplicitMath(protectedStr);
  protectedStr = mathResult.str;
  const explicitMath = mathResult.mathBlocks;

  // Step 4: Protect complete LaTeX environments
  const envResult = _protectLatexEnvironments(protectedStr);
  protectedStr = envResult.str;
  const environments = envResult.environments;

  // Step 5: Detect bare LaTeX
  protectedStr = _detectBareLatex(protectedStr);

  // Step 6: Restore in reverse order
  // Restore environments (already wrapped with $$)
  for (let i = environments.length - 1; i >= 0; i--) {
    protectedStr = protectedStr.replace(environments[i].placeholder, environments[i].content);
  }

  // Restore explicit math
  for (let i = explicitMath.length - 1; i >= 0; i--) {
    protectedStr = protectedStr.replace(explicitMath[i].placeholder, explicitMath[i].content);
  }

  // Restore inline code
  for (let i = inlineCode.length - 1; i >= 0; i--) {
    protectedStr = protectedStr.replace(inlineCode[i].placeholder, inlineCode[i].content);
  }

  // Restore fenced code
  for (let i = fencedCode.length - 1; i >= 0; i--) {
    protectedStr = protectedStr.replace(fencedCode[i].placeholder, fencedCode[i].content);
  }

  return protectedStr;
}

/* ── Configure marked once at module load ── */
function _buildMarked() {
  marked.use(markedKatex({
    throwOnError: false,
    errorColor: '#888888',
    trust: false,
    output: 'html',
    nonStandard: true
  }));

  marked.use({
    breaks: true,
    gfm: true,
    renderer: {
      code(code, lang) {
        const language  = (lang  || '').trim().toLowerCase();
        const codeStr   = String(code || '');
        const label     = language || 'code';
        const id        = 'cb' + Math.random().toString(36).slice(2, 8);

        let highlighted = _he(codeStr);
        if (typeof hljs !== 'undefined') {
          try {
            const valid  = language && hljs.getLanguage(language);
            const result = valid
              ? hljs.highlight(codeStr, { language, ignoreIllegals: true })
              : hljs.highlightAuto(codeStr);
            highlighted = result.value;
          } catch (_) {
            highlighted = _he(codeStr);
          }
        }

        return (
          '<div class="code-block" id="' + id + '">' +
            '<div class="code-block-header">' +
              '<span class="code-block-lang">' + _he(label) + '</span>' +
              '<button class="code-copy-btn" data-target="' + id + '">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
                  '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
                  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
                '</svg> Copy' +
              '</button>' +
            '</div>' +
            '<pre><code class="hljs">' + highlighted + '</code></pre>' +
          '</div>'
        );
      }
    }
  });
}

_buildMarked();

/* ── Core render pipeline ── */
function _safePipeline(raw) {
  if (!raw) return '';
  const text = _normalizeNewlines(_normalizeLatex(raw));
  if (!text) return '';
  try { return marked.parse(text); }
  catch (_) { return '<pre class="render-fallback">' + _he(raw) + '</pre>'; }
}

/* ── UniversalMessageRenderer ──
   Supports both one-shot rendering and streaming with debounce. ── */
class UniversalMessageRenderer {
  constructor() {
    this.rawContent      = '';
    this.renderedContent = '';
    this._hash           = null;
    this._buf            = '';
    this._streaming      = false;
  }

  render(content) {
    this.rawContent = content;
    const h = _cheapHash(content);
    if (h === this._hash && this.renderedContent) return this.renderedContent;
    this._hash = h;
    return (this.renderedContent = _safePipeline(content));
  }

  startStream() {
    this._buf            = '';
    this._streaming      = true;
    this.rawContent      = '';
    this.renderedContent = '';
    this._hash           = null;
  }

  pushChunk(chunk) {
    if (!this._streaming) this.startStream();
    this.rawContent = (this._buf += chunk);
    return (this.renderedContent = _safePipeline(this._buf));
  }

  finishStream() {
    this._streaming = false;
    return (this.renderedContent = _safePipeline(this._buf));
  }

  getHTML() { return this.renderedContent; }
  getRaw()  { return this.rawContent; }
}

/* ── createStreamingRenderer ──
   Factory for streaming use — debounces DOM updates to debounceMs. ── */
function createStreamingRenderer(onUpdate, debounceMs = 40) {
  const renderer = new UniversalMessageRenderer();
  renderer.startStream();
  let _timer = null;
  let _done  = false;

  function _flush(final) {
    clearTimeout(_timer);
    _timer = null;
    if (typeof onUpdate === 'function') {
      onUpdate(final ? renderer.finishStream() : renderer.getHTML(), { final });
    }
  }

  return {
    push(chunk) {
      if (_done) return;
      renderer.pushChunk(chunk);
      clearTimeout(_timer);
      _timer = setTimeout(function() { _flush(false); }, debounceMs);
    },
    finish() {
      if (_done) return;
      _done = true;
      clearTimeout(_timer);
      _flush(true);
    },
    getRenderer() { return renderer; },
  };
}

/* ── Public helpers ── */
function universalRender(content) { return new UniversalMessageRenderer().render(content); }
function renderMarkdown(text)     { return universalRender(text); }
