/* ═══════════════════════════════════════════════════════════════
   search.js — Atkyn Search
   UI logic · scroll · header animation · tab animation
   input · plus menu · chat rendering · stream handling
   API interaction · typing animation · copy buttons
   event listeners · application state
   ═══════════════════════════════════════════════════════════════ */

/* ── Cached DOM references ── */
const input        = document.getElementById('cbInput');
const sendBtn      = document.getElementById('sendBtn');
const pill         = document.getElementById('pill');
const msgWrap      = document.getElementById('msgWrap');
const scrollHost   = document.getElementById('scrollHost');
const logoHeader   = document.querySelector('.logo-header');
const tabBar       = document.getElementById('tabBar');
const chatbarWrap  = document.querySelector('.chatbar-wrap');
const chatSpacer   = document.getElementById('chatSpacer');
const plusBtn      = document.getElementById('plusBtn');
const plusMenu     = document.getElementById('plusMenu');
const plusBackdrop = document.getElementById('plusBackdrop');

/* ── Application state ── */
let _rafPending       = false;
let _lastScrollY      = 0;
let _accumDown        = 0;
let _accumUp          = 0;
let _keyboardOpen     = false;
let _isLogoCollapsed  = false;
let _isTabHidden      = false;
let _isTabScrolled    = false;
let _scrollRafId      = null;
let _programmaticScroll = false;
let _lastUserMsgEl    = null;
let _streamAbort      = null;
let _plusOpen         = false;

/* ── Viewport / keyboard internal state ── */
let _vvpRafId    = 0;
let _cleanupRafId = 0;
let _prevOffset  = -1;

/* ── Spacer dedup ── */
let _lastSpacerH = -1;

/* ── Conversation history: max 100 turns ── */
const MAX_HISTORY = 100;
const _history    = [];

/* ── Typing indicator ── */
let _typingEl = null;

/* ════════════════════════════════
   HELPERS
   ════════════════════════════════ */

/** Reset scroll-direction accumulators. */
function resetScrollAccum() {
  _accumDown = 0;
  _accumUp   = 0;
}

/**
 * Push a message into the conversation history and enforce the turn cap.
 * @param {'user'|'assistant'} role
 * @param {string} content
 */
function pushHistory(role, content) {
  _history.push({ role, content });
  if (_history.length > MAX_HISTORY) {
    _history.splice(0, _history.length - MAX_HISTORY);
  }
}

/**
 * Escape a string for safe insertion as HTML text content via innerHTML.
 * Covers all five characters that can open injection vectors in any context.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validate that a URL uses a safe scheme before placing it in an href.
 * Returns the URL if safe, otherwise '#'.
 * @param {string} url
 * @returns {string}
 */
function safeLinkUrl(url) {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? url : '#';
  } catch (_) {
    return '#';
  }
}

/* ════════════════════════════════
   SCROLL HELPERS
   ════════════════════════════════ */

function scrollToMsg(el) {
  if (!el) return;
  if (_scrollRafId !== null) cancelAnimationFrame(_scrollRafId);
  // One RAF is enough: the element is already in the DOM when this is called,
  // and a single animation frame ensures layout is complete before we measure.
  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId = null;
    _programmaticScroll = true;
    const tabH   = tabBar.offsetHeight;
    const target = Math.max(0, el.offsetTop - tabH - 8);
    scrollHost.scrollTop = target;
    _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
    requestAnimationFrame(() => { _programmaticScroll = false; });
  });
}

/* ════════════════════════════════
   CHATBAR / KEYBOARD POSITIONING
   ════════════════════════════════ */

function updateSpacer(kbHeight) {
  // Use the cached offsetHeight; this is only called from a ResizeObserver
  // callback (which already has an up-to-date layout) or after a viewport event.
  const barH    = chatbarWrap.offsetHeight;
  const spacerH = barH + (kbHeight || 0);
  if (spacerH === _lastSpacerH) return;
  _lastSpacerH = spacerH;
  chatSpacer.style.height = spacerH + 'px';
}

const _barResizeObserver = new ResizeObserver((entries) => {
  // Prefer ResizeObserverEntry geometry to avoid a forced layout read.
  const entry = entries[entries.length - 1];
  const barH  = entry.borderBoxSize
    ? entry.borderBoxSize[0].blockSize
    : entry.contentRect.height;
  const kbH = _keyboardOpen
    ? Math.max(0, window.innerHeight - (window.visualViewport?.height ?? 0) - (window.visualViewport?.offsetTop ?? 0))
    : 0;
  const spacerH = barH + kbH;
  if (spacerH === _lastSpacerH) return;
  _lastSpacerH = spacerH;
  chatSpacer.style.height = spacerH + 'px';
});
_barResizeObserver.observe(chatbarWrap);

function fixViewport() {
  if (_vvpRafId) return;
  _vvpRafId = requestAnimationFrame(_applyViewport);
}

function _applyViewport() {
  _vvpRafId = 0;
  const vvp = window.visualViewport;
  if (!vvp) return;
  const kbHeight = Math.max(0, window.innerHeight - vvp.height - vvp.offsetTop);
  if (Math.round(kbHeight) === Math.round(_prevOffset)) return;
  const wasOpen = _keyboardOpen;
  _keyboardOpen = kbHeight > 50;
  _prevOffset   = kbHeight;

  if (_keyboardOpen && !wasOpen) {
    chatbarWrap.style.transition = 'none';
  } else if (!_keyboardOpen && wasOpen) {
    chatbarWrap.style.transition = 'transform 0.28s cubic-bezier(0.0, 0.0, 0.2, 1)';
  }

  chatbarWrap.style.transform = kbHeight > 0
    ? `translateY(-${kbHeight}px) translateZ(0)` : '';
  updateSpacer(kbHeight);

  if (kbHeight > 0) {
    _programmaticScroll = true;
    if (_lastUserMsgEl) {
      scrollHost.scrollTop = Math.max(0, _lastUserMsgEl.offsetTop - 16);
    } else {
      scrollHost.scrollTop = scrollHost.scrollHeight;
    }
  }

  // One RAF is sufficient to let the browser settle before releasing the guard.
  cancelAnimationFrame(_cleanupRafId);
  _cleanupRafId = requestAnimationFrame(() => {
    _cleanupRafId = 0;
    _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
    _programmaticScroll = false;
  });
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', fixViewport, { passive: true });
  window.visualViewport.addEventListener('scroll', fixViewport, { passive: true });
  updateSpacer(0);
  _applyViewport();
} else {
  function _legacyFix() {
    const h = window.innerHeight + 'px';
    if (document.body.style.height !== h) document.body.style.height = h;
  }
  window.addEventListener('resize', _legacyFix, { passive: true });
  _legacyFix();
  updateSpacer(0);
}

/* ════════════════════════════════
   HEADER / TAB ANIMATION
   ════════════════════════════════ */

const HIDE_ACCUM  = 40;
const SHOW_ACCUM  = 55;
const LOGO_THRESH = 10;

function updateHeader() {
  _rafPending = false;
  // Skip during programmatic scrolls (keyboard show/hide, scrollToMsg) to
  // prevent the header from flickering when we reposition the viewport.
  if (_programmaticScroll) {
    _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
    return;
  }
  const sy    = scrollHost.scrollTop;
  const delta = sy - _lastScrollY;
  if (delta === 0) return;
  _lastScrollY = sy;

  if (sy <= LOGO_THRESH) {
    resetScrollAccum();
    if (_isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
    if (_isTabHidden)     { tabBar.classList.remove('hide');           _isTabHidden      = false; }
    if (_isTabScrolled)   { tabBar.classList.remove('scrolled');       _isTabScrolled    = false; }
    return;
  }

  if (!_isLogoCollapsed) { logoHeader.classList.add('collapsed'); _isLogoCollapsed = true; }
  if (!_isTabScrolled)   { tabBar.classList.add('scrolled');      _isTabScrolled    = true; }

  if (delta > 0) {
    _accumDown += delta;
    if (_accumUp > 0) _accumUp = 0;
    if (!_isTabHidden && _accumDown >= HIDE_ACCUM) {
      tabBar.classList.add('hide'); _isTabHidden = true; _accumDown = 0;
    }
  } else {
    _accumUp += -delta;
    if (_accumDown > 0) _accumDown = 0;
    if (_isTabHidden && _accumUp >= SHOW_ACCUM) {
      tabBar.classList.remove('hide'); _isTabHidden = false; _accumUp = 0;
    }
  }
}

scrollHost.addEventListener('scroll', () => {
  if (!_rafPending) { _rafPending = true; requestAnimationFrame(updateHeader); }
}, { passive: true });

/* ════════════════════════════════
   INPUT & PILL
   ════════════════════════════════ */

pill.addEventListener('pointerdown', (e) => {
  if (e.target !== pill && e.target !== input &&
      e.target.closest('button, .overlay-input-wrap')) return;
  if (document.activeElement === input || _keyboardOpen) return;
  e.preventDefault();
  requestAnimationFrame(() => { input.focus(); });
}, { passive: false });

input.addEventListener('input', () => {
  pill.classList.toggle('has-text', input.value.trim().length > 0);
});

input.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); send(); }
});

sendBtn.addEventListener('click', send);

/* ════════════════════════════════
   PLUS MENU
   ════════════════════════════════ */

function openPlusMenu() {
  const rect = plusBtn.getBoundingClientRect();
  plusMenu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  _plusOpen = true;
  plusBackdrop.classList.add('open');
  requestAnimationFrame(() => plusMenu.classList.add('open'));
}

function closePlusMenu() {
  _plusOpen = false;
  plusMenu.classList.remove('open');
  plusBackdrop.classList.remove('open');
}

plusBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  _plusOpen ? closePlusMenu() : openPlusMenu();
});
plusBackdrop.addEventListener('click', closePlusMenu);

document.getElementById('pmPhoto').addEventListener('click',    () => { closePlusMenu(); });
document.getElementById('pmCamera').addEventListener('click',   () => { closePlusMenu(); });
document.getElementById('pmFile').addEventListener('click',     () => { closePlusMenu(); });
document.getElementById('pmLocation').addEventListener('click', () => { closePlusMenu(); });

/* ════════════════════════════════
   TAB BAR
   ════════════════════════════════ */

const _allTabs = tabBar.querySelectorAll('.tab');
tabBar.addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  _allTabs.forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
}, { passive: true });

/* ════════════════════════════════
   TYPING INDICATOR
   ════════════════════════════════ */

function showTyping() {
  // Guard: if a typing bubble already exists, remove it before creating a new
  // one. Without this, a rapid re-send would leave the old bubble in the DOM.
  removeTyping();
  _typingEl = document.createElement('div');
  _typingEl.className = 'msg bot';
  _typingEl.innerHTML = `<div class="bubble typing"><span></span><span></span><span></span><span></span></div>`;
  msgWrap.appendChild(_typingEl);
}

function removeTyping() {
  if (_typingEl) { _typingEl.remove(); _typingEl = null; }
}

/* ════════════════════════════════
   MESSAGE RENDERING
   ════════════════════════════════ */

function addMsg(role, text) {
  const d = document.createElement('div');
  d.className = `msg ${role}`;
  // Bot output goes through the Markdown renderer (trusted pipeline).
  // User text is escaped before innerHTML assignment to prevent injection.
  const html = role === 'bot'
    ? renderMarkdown(text)
    : escapeHtml(text);
  d.innerHTML = `<div class="bubble">${html}</div>`;
  msgWrap.appendChild(d);
  if (role === 'bot')  appendBotActions(d, text);
  if (role === 'user') { _lastUserMsgEl = d; scrollToMsg(d); }
}

function appendBotActions(msgEl, fullText) {
  const bar = document.createElement('div');
  bar.className = 'bot-actions';

  const actions = [
    { key: 'copy',    label: 'Copy',    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>` },
    { key: 'retry',   label: 'Retry',   svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>` },
    { key: 'like',    label: 'Like',    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/><path d="M7 10v12"/></svg>` },
    { key: 'dislike', label: 'Dislike', svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>` },
    { key: 'refresh', label: 'Refresh', svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M2.5 12a10 10 0 0 1 17.8-6.3L21.5 8"/><path d="M2.5 22v-6h6"/><path d="M21.5 12a10 10 0 0 1-17.8 6.3L2.5 16"/></svg>` },
  ];

  const btnRefs = {};
  actions.forEach(({ key, label, svg }) => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', label);
    btn.innerHTML = svg;
    btnRefs[key] = btn;
    bar.appendChild(btn);
  });

  Object.entries(btnRefs).forEach(([key, btn]) => {
    btn.addEventListener('click', () => {
      if (key === 'copy') {
        navigator.clipboard.writeText(msgEl.querySelector('.bubble')?.innerText || fullText).catch(() => {});
        btn.style.color = '#2da44e';
        setTimeout(() => btn.style.color = '', 1200);
      } else if (key === 'like') {
        btn.classList.toggle('active-like');
        btnRefs['dislike']?.classList.remove('active-dislike');
      } else if (key === 'dislike') {
        btn.classList.toggle('active-dislike');
        btnRefs['like']?.classList.remove('active-like');
      } else if (key === 'refresh' || key === 'retry') {
        btn.style.transition = 'transform 0.45s ease';
        btn.style.transform  = 'rotate(360deg)';
        setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 500);
      }
    });
  });

  msgEl.appendChild(bar);
}

/* ════════════════════════════════
   CODE COPY — delegated listener
   ════════════════════════════════ */

document.addEventListener('click', function(e) {
  const btn = e.target.closest('.code-copy-btn');
  if (!btn) return;
  const blockId = btn.getAttribute('data-target');
  const block   = document.getElementById(blockId);
  if (!block) return;

  const contentSpans = block.querySelectorAll('.code-line-content');
  let rawCode = '';
  contentSpans.forEach((span, i) => {
    rawCode += (i > 0 ? '\n' : '') + span.innerText;
  });
  if (!rawCode) rawCode = block.querySelector('pre')?.innerText || '';

  navigator.clipboard.writeText(rawCode).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied`;
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
    }, 1800);
  }).catch(() => {});
});

/* ════════════════════════════════
   WEB RESULT CARDS
   ════════════════════════════════ */

function _renderWebCards(results) {
  const wrap   = document.createElement('div');
  wrap.className = 'msg bot';
  const bubble = document.createElement('div');
  bubble.className = 'bubble web-results';

  // Escape all API-sourced text and validate URLs before injection.
  bubble.innerHTML = results.map(r => {
    let hostname = r.url;
    try { hostname = new URL(r.url).hostname; } catch (_) {}
    const href = safeLinkUrl(r.url);
    return `<a class="web-card" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
      <div class="web-card-title">${escapeHtml(r.title)}</div>
      <div class="web-card-url">${escapeHtml(hostname)}</div>
      <div class="web-card-snippet">${escapeHtml(r.snippet)}</div>
    </a>`;
  }).join('');

  wrap.appendChild(bubble);
  msgWrap.appendChild(wrap);
}

/* ════════════════════════════════
   SSE STREAM PARSER
   ════════════════════════════════ */

/**
 * Consume a ReadableStream as Server-Sent Events.
 * Calls onResults(results[]) when an `event: results` block arrives,
 * and onDelta(text) for each streamed content delta.
 * Returns the full accumulated text.
 *
 * @param {ReadableStreamDefaultReader} reader
 * @param {(results: object[]) => void} onResults
 * @param {(delta: string) => void} onDelta
 * @returns {Promise<string>}
 */
async function _parseSseStream(reader, onResults, onDelta) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let sseBuffer = '';
  let fullText  = '';
  let eventType = '';
  let done      = false;

  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    sseBuffer += done
      ? decoder.decode()                              // flush the internal buffer
      : decoder.decode(chunk.value, { stream: true });

    // On the final iteration we still need to process whatever remains.
    const lines = sseBuffer.split('\n');
    // Keep the last (possibly incomplete) line for the next iteration,
    // unless we're done — then process it too.
    sseBuffer = done ? '' : lines.pop();

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
        continue;
      }
      if (!line.startsWith('data: ')) { eventType = ''; continue; }

      const data = line.slice(6).trim();
      if (data === '[DONE]') { done = true; break; }

      if (eventType === 'results') {
        try {
          const results = JSON.parse(data);
          if (results.length) onResults(results);
        } catch (_) {}
        eventType = '';
        continue;
      }

      try {
        const json  = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content || '';
        if (delta) { fullText += delta; onDelta(delta); }
      } catch (_) {}
    }
  }

  return fullText;
}

/* ════════════════════════════════
   SEND / STREAM
   ════════════════════════════════ */

async function send() {
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  pill.classList.remove('has-text');
  addMsg('user', q);

  // Cancel any in-flight request. removeTyping() is called inside showTyping(),
  // so we don't need to call it separately here.
  if (_streamAbort) { _streamAbort.abort(); _streamAbort = null; }
  showTyping();

  pushHistory('user', q);
  _streamAbort = new AbortController();

  const activeTab = tabBar.querySelector('.tab.active')?.dataset?.tab;
  const endpoint  = '/api/chat';

  try {
    const resp = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      // Exclude the message we just pushed so the server sees prior context only.
      body:    JSON.stringify({ query: q, history: _history.slice(0, -1) }),
      signal:  _streamAbort.signal,
    });

    if (!resp.ok) {
      removeTyping();
      addMsg('bot', 'Something went wrong. Please try again.');
      _streamAbort = null;
      return;
    }

    const reader   = resp.body.getReader();
    let webCardShown = false;

    const fullText = await _parseSseStream(
      reader,
      /* onResults */ (results) => {
        if (!webCardShown) {
          removeTyping();
          _renderWebCards(results);
          showTyping();
          webCardShown = true;
        } else {
          _renderWebCards(results);
        }
      },
      /* onDelta */ () => {
        // Reserved for future live-streaming text rendering.
        // Currently we batch the full text and render after the stream ends.
      }
    );

    _streamAbort = null;

    removeTyping();

    if (fullText) {
      pushHistory('assistant', fullText);

      const botEl    = document.createElement('div');
      botEl.className = 'msg bot';
      const bubbleEl  = document.createElement('div');
      bubbleEl.className = 'bubble';
      bubbleEl.innerHTML = renderMarkdown(fullText);
      botEl.appendChild(bubbleEl);
      msgWrap.appendChild(botEl);
      appendBotActions(botEl, fullText);
    }

  } catch (err) {
    if (err.name === 'AbortError') return;
    removeTyping();
    addMsg('bot', 'Network error. Please try again.');
    _streamAbort = null;
  }
}

/* ════════════════════════════════
   URL PARAM AUTO-SEND
   ════════════════════════════════ */

const _qParam = new URLSearchParams(location.search).get('q');
if (_qParam) { input.value = _qParam; pill.classList.add('has-text'); send(); }
