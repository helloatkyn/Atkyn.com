/* ═══════════════════════════════════════════════════════════════
   search.js — Atkyn Search
   UI logic · scroll · header animation · tab animation
   input · plus menu · chat rendering · stream handling
   API interaction · typing animation · copy buttons
   event listeners · application state
   ═══════════════════════════════════════════════════════════════ */

/* ── Cached DOM references ── */
const input       = document.getElementById('cbInput');
const sendBtn     = document.getElementById('sendBtn');
const pill        = document.getElementById('pill');
const msgWrap     = document.getElementById('msgWrap');
const scrollHost  = document.getElementById('scrollHost');
const logoHeader  = document.querySelector('.logo-header');
const tabBar      = document.getElementById('tabBar');
const chatbarWrap = document.querySelector('.chatbar-wrap');
const chatSpacer  = document.getElementById('chatSpacer');
const plusBtn     = document.getElementById('plusBtn');
const plusMenu    = document.getElementById('plusMenu');
const plusBackdrop = document.getElementById('plusBackdrop');

/* ── Application state ── */
let viewportResizing    = false;
let rafPending          = false;
let lastScrollY         = 0;
let accumDown           = 0;
let accumUp             = 0;
let _keyboardOpen       = false;
let isLogoCollapsed     = false;
let isTabHidden         = false;
let isTabScrolled       = false;
let _scrollRafId        = null;
let _programmaticScroll = false;
let _lastUserMsgEl      = null;
let _pinnedToBottom     = true;
let streamAbort         = null;
let _plusOpen           = false;

/* Viewport RAF IDs */
let _vvpRafId     = 0;
let _cleanupRafId = 0;
let _prevOffset   = -1;

/* Spacer dedup */
let _lastSpacerH  = -1;

/* Conversation history: max 100 turns */
const MAX_HISTORY = 100;
const _history    = [];

/* ── Typing indicator state ── */
let typingEl = null;

/* ════════════════════════════════
   SCROLL HELPERS
   ════════════════════════════════ */

function scrollToMsg(el) {
  if (!el) return;
  if (_scrollRafId !== null) cancelAnimationFrame(_scrollRafId);
  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId = requestAnimationFrame(() => {
      _scrollRafId = null;
      _programmaticScroll = true;
      const tabH   = tabBar.offsetHeight;
      const target = Math.max(0, el.offsetTop - tabH - 8);
      scrollHost.scrollTop = target;
      lastScrollY = scrollHost.scrollTop;
      accumDown = 0;
      accumUp   = 0;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { _programmaticScroll = false; });
      });
    });
  });
}

/* ════════════════════════════════
   CHATBAR / KEYBOARD POSITIONING
   ════════════════════════════════ */

function updateSpacer(kbHeight) {
  const barH    = chatbarWrap.offsetHeight;
  const spacerH = barH + (kbHeight || 0);
  if (spacerH === _lastSpacerH) return;
  _lastSpacerH = spacerH;
  chatSpacer.style.height = spacerH + 'px';
}

const _barResizeObserver = new ResizeObserver(() => {
  const kbH = _keyboardOpen
    ? Math.max(0, window.innerHeight - (window.visualViewport?.height ?? 0) - (window.visualViewport?.offsetTop ?? 0))
    : 0;
  updateSpacer(kbH);
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
  viewportResizing = true;

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
    _pinnedToBottom = (scrollHost.scrollTop + scrollHost.clientHeight) >= (scrollHost.scrollHeight - 8);
  }

  cancelAnimationFrame(_cleanupRafId);
  _cleanupRafId = requestAnimationFrame(() => {
    _cleanupRafId = requestAnimationFrame(() => {
      _cleanupRafId = 0;
      lastScrollY = scrollHost.scrollTop;
      accumDown   = 0;
      accumUp     = 0;
      viewportResizing    = false;
      _programmaticScroll = false;
    });
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
  rafPending = false;
  if (viewportResizing || _programmaticScroll) {
    lastScrollY = scrollHost.scrollTop;
    accumDown = 0;
    accumUp   = 0;
    return;
  }
  const sy    = scrollHost.scrollTop;
  const delta = sy - lastScrollY;
  if (delta === 0) return;
  lastScrollY = sy;

  if (sy <= LOGO_THRESH) {
    accumDown = 0; accumUp = 0;
    if (isLogoCollapsed) { logoHeader.classList.remove('collapsed'); isLogoCollapsed = false; }
    if (isTabHidden)     { tabBar.classList.remove('hide');          isTabHidden      = false; }
    if (isTabScrolled)   { tabBar.classList.remove('scrolled');      isTabScrolled    = false; }
    return;
  }

  if (!isLogoCollapsed) { logoHeader.classList.add('collapsed'); isLogoCollapsed = true; }
  if (!isTabScrolled)   { tabBar.classList.add('scrolled');      isTabScrolled    = true; }

  if (delta > 0) {
    accumDown += delta;
    if (accumUp > 0) accumUp = 0;
    if (!isTabHidden && accumDown >= HIDE_ACCUM) {
      tabBar.classList.add('hide'); isTabHidden = true; accumDown = 0;
    }
  } else {
    accumUp += -delta;
    if (accumDown > 0) accumDown = 0;
    if (isTabHidden && accumUp >= SHOW_ACCUM) {
      tabBar.classList.remove('hide'); isTabHidden = false; accumUp = 0;
    }
  }
}

scrollHost.addEventListener('scroll', () => {
  if (!rafPending) { rafPending = true; requestAnimationFrame(updateHeader); }
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
  typingEl = document.createElement('div');
  typingEl.className = 'msg bot';
  typingEl.innerHTML = `<div class="bubble typing"><span></span><span></span><span></span><span></span></div>`;
  msgWrap.appendChild(typingEl);
}

function removeTyping() {
  if (typingEl) { typingEl.remove(); typingEl = null; }
}

/* ════════════════════════════════
   MESSAGE RENDERING
   ════════════════════════════════ */

function addMsg(role, text) {
  const d = document.createElement('div');
  d.className = `msg ${role}`;
  const html = role === 'bot'
    ? stripMarkdown(text)
    : text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
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
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  const bubble = document.createElement('div');
  bubble.className = 'bubble web-results';
  bubble.innerHTML = results.map(r => {
    let hostname = r.url;
    try { hostname = new URL(r.url).hostname; } catch (_) {}
    return `<a class="web-card" href="${r.url}" target="_blank" rel="noopener noreferrer">
      <div class="web-card-title">${r.title}</div>
      <div class="web-card-url">${hostname}</div>
      <div class="web-card-snippet">${r.snippet}</div>
    </a>`;
  }).join('');
  wrap.appendChild(bubble);
  msgWrap.appendChild(wrap);
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
  showTyping();

  _history.push({ role: 'user', content: q });
  if (_history.length > MAX_HISTORY) _history.splice(0, _history.length - MAX_HISTORY);

  if (streamAbort) { streamAbort.abort(); streamAbort = null; }
  streamAbort = new AbortController();

  /* Answer tab pe /api/search, baaki pe /api/chat */
  const activeTab = tabBar.querySelector('.tab.active')?.dataset?.tab;
  const endpoint  = activeTab === 'ai' ? '/api/search' : '/api/chat';

  try {
    const resp = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query: q, history: _history.slice(0, -1) }),
      signal:  streamAbort.signal,
    });

    if (!resp.ok) {
      removeTyping();
      addMsg('bot', 'Something went wrong. Please try again.');
      streamAbort = null;
      return;
    }

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let sseBuffer = '';
    let fullText  = '';
    let eventType = '';

    outer: while (true) {
      const { done, value } = await reader.read();
      sseBuffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (done) break;
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
          continue;
        }
        if (!line.startsWith('data: ')) { eventType = ''; continue; }
        const data = line.slice(6).trim();
        if (data === '[DONE]') break outer;

        /* Web results event */
        if (eventType === 'results') {
          try {
            const results = JSON.parse(data);
            if (results.length) {
              removeTyping();
              _renderWebCards(results);
              showTyping();
            }
          } catch (_) {}
          eventType = '';
          continue;
        }

        /* Normal AI stream */
        try {
          const json  = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) fullText += delta;
        } catch (_) {}
      }
    }

    streamAbort = null;

    if (fullText) {
      _history.push({ role: 'assistant', content: fullText });
      if (_history.length > MAX_HISTORY) _history.splice(0, _history.length - MAX_HISTORY);
    }

    requestAnimationFrame(() => {
      removeTyping();
      if (fullText) {
        const botEl    = document.createElement('div');
        botEl.className = 'msg bot';
        const bubbleEl = document.createElement('div');
        bubbleEl.className = 'bubble';
        bubbleEl.textContent = stripMarkdown(fullText);
        botEl.appendChild(bubbleEl);
        msgWrap.appendChild(botEl);
        appendBotActions(botEl, fullText);
      }
    });

  } catch (err) {
    if (err.name === 'AbortError') return;
    removeTyping();
    addMsg('bot', 'Network error. Please try again.');
    streamAbort = null;
  }
}

/* ════════════════════════════════
   URL PARAM AUTO-SEND
   ════════════════════════════════ */

const _qParam = new URLSearchParams(location.search).get('q');
if (_qParam) { input.value = _qParam; pill.classList.add('has-text'); send(); }
                        
