/* ═══════════════════════════════════════════════════════════════════
core.js — Atkyn shared UI logic  [PRODUCTION · NATIVE-SMOOTH v3]
scroll · header animation · keyboard positioning · theme freeze
chatbar entrance · plus menu · tab navigation (instant, NO reload)
═══════════════════════════════════════════════════════════════════ */

/* ── Reduced-motion flag ── */
const _prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Easing constants ── */
const EASE = {
  keyboardUp:   'cubic-bezier(0.32, 0.72, 0, 1)',
  keyboardDown: 'cubic-bezier(0.32, 0.72, 0, 1)',
  headerHide:   'cubic-bezier(0.4, 0, 1, 1)',
  headerShow:   'cubic-bezier(0, 0, 0.2, 1)',
  chatbarEnter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  menuOpen:     'cubic-bezier(0.34, 1.56, 0.64, 1)',
  menuClose:    'cubic-bezier(0.4, 0, 1, 1)',
  contentSwap:  'cubic-bezier(0.16, 1, 0.3, 1)',
};

/* ── Stable DOM references (queried ONCE) ── */
const scrollHost   = document.getElementById('scrollHost');
const logoHeader   = document.querySelector('.logo-header');
const tabBar       = document.getElementById('tabBar');
const chatbarWrap  = document.querySelector('.chatbar-wrap');
const plusBtn      = document.getElementById('plusBtn');
const plusMenu     = document.getElementById('plusMenu');
const plusBackdrop = document.getElementById('plusBackdrop');
const pill         = document.getElementById('pill');
const input        = document.getElementById('cbInput');
const sendBtn      = document.getElementById('sendBtn');
const pageContent  = document.getElementById('pageContent');

/* ── SVG constants (allocation-free) ── */
const SVG_SEND  = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="5 11 12 4 19 11"/></svg>`;
const SVG_CROSS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

/* ── Scroll / header state ── */
let _rafPending         = false;
let _lastScrollY        = 0;
let _accumDown          = 0;
let _accumUp            = 0;
let _keyboardOpen       = false;
let _isLogoCollapsed    = false;
let _isTabHidden        = false;
let _isTabScrolled      = false;
let _scrollRafId        = null;
let _programmaticScroll = false;
let _plusOpen           = false;

/* ── Velocity EMA ── */
let _velocityEMA    = 0;
let _lastScrollTime = 0;
const VELOCITY_ALPHA = 0.3;

/* ── Keyboard / viewport state ── */
let _cleanupRafId = 0;
let _stableKbH    = 0;
let _kbAnimFrame  = null;
let _vvpDebounce  = 0;

/* ── Spacer guard ── */
let _lastSpacerH = -1;

/* ── Theme-freeze window (prevents dark/light bounce) ── */
let _themeFreezeUntil = 0;

/* ── Public: last user message element ── */
window._lastUserMsgEl = null;

/* ── Current active tab key ── */
let _currentTabKey = (() => {
  const a = tabBar.querySelector('.tab.active');
  return a ? a.getAttribute('data-tab') : 'ai';
})();

/* ── Module cache ── */
const _moduleCache = {};

/* ── msgWrap reference ── */
const _msgWrap = document.getElementById('msgWrap');

/* ════════════════════════════════
HELPERS
════════════════════════════════ */
function resetScrollAccum() {
  _accumDown = _accumUp = _velocityEMA = _lastScrollTime = 0;
}

/* ════════════════════════════════
SEND BUTTON MODE
════════════════════════════════ */
let _sendMode = 'send';
function _setSendMode(mode) {
  if (mode === _sendMode) return;
  _sendMode = mode;
  if (mode === 'cross') {
    sendBtn.innerHTML = SVG_CROSS;
    sendBtn.classList.add('cross-mode');
  } else {
    sendBtn.innerHTML = SVG_SEND;
    sendBtn.classList.remove('cross-mode');
  }
}

sendBtn.addEventListener('click', () => {
  if (pill.classList.contains('non-ai-tab')) {
    input.value = '';
    pill.classList.remove('has-text');
    _setSendMode('send');
  }
});

/* ════════════════════════════════
SCROLL TO MSG
════════════════════════════════ */
function scrollToMsg(el) {
  if (!el) return;
  if (_scrollRafId !== null) cancelAnimationFrame(_scrollRafId);
  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId        = null;
    _programmaticScroll = true;
    const target = Math.max(0, el.offsetTop - tabBar.offsetHeight - 8);
    if (_prefersReducedMotion) {
      scrollHost.scrollTop = target;
      _lastScrollY = target;
      resetScrollAccum();
      _programmaticScroll = false;
    } else {
      scrollHost.scrollTo({ top: target, behavior: 'smooth' });
      _lastScrollY = target;
      resetScrollAccum();
      setTimeout(() => { _programmaticScroll = false; }, 400);
    }
  });
}
window.scrollToMsg = scrollToMsg;

/* ════════════════════════════════
CHATBAR / KEYBOARD POSITIONING
════════════════════════════════ */
function _setSpacerHeight(h) {
  if (h === _lastSpacerH) return;
  _lastSpacerH = h;
  const spacer = document.getElementById('chatSpacer');
  if (spacer) spacer.style.height = h + 'px';
}

const _barResizeObserver = new ResizeObserver((entries) => {
  // Guard: skip during theme transition (prevents bounce)
  if (performance.now() < _themeFreezeUntil) return;
  const entry = entries[entries.length - 1];
  const barH  = entry.borderBoxSize
    ? entry.borderBoxSize[0].blockSize
    : entry.contentRect.height;
  _setSpacerHeight(barH + _stableKbH);
});
_barResizeObserver.observe(chatbarWrap);

/* ── Chatbar entrance animation ── */
(function _chatbarEntrance() {
  if (_prefersReducedMotion) return;
  chatbarWrap.style.cssText = 'will-change:transform,opacity;transition:none;transform:translateY(24px) translateZ(0);opacity:0';
  chatbarWrap.getBoundingClientRect();
  requestAnimationFrame(() => {
    chatbarWrap.style.transition = `transform 0.45s ${EASE.chatbarEnter}, opacity 0.35s ease-out`;
    chatbarWrap.style.transform  = 'translateY(0) translateZ(0)';
    chatbarWrap.style.opacity    = '1';
    chatbarWrap.addEventListener('transitionend', function _onEntry(e) {
      if (e.propertyName !== 'transform') return;
      chatbarWrap.removeEventListener('transitionend', _onEntry);
      chatbarWrap.style.cssText = '';
    });
  });
}());

/* ── Keyboard / VisualViewport positioning ── */
function _applyViewport() {
  _vvpDebounce = 0;
  // Guard: skip during theme transition
  if (performance.now() < _themeFreezeUntil) return;

  const vvp = window.visualViewport;
  if (!vvp) return;

  const rawKb    = Math.max(0, window.innerHeight - vvp.height - vvp.offsetTop);
  const kbHeight = rawKb > 50 ? Math.round(rawKb) : 0;
  if (kbHeight === _stableKbH) return;

  _stableKbH    = kbHeight;
  _keyboardOpen = kbHeight > 0;

  if (_kbAnimFrame) { cancelAnimationFrame(_kbAnimFrame); _kbAnimFrame = null; }

  const barH      = chatbarWrap.offsetHeight;
  const transform = kbHeight > 0 ? `translateY(-${kbHeight}px) translateZ(0)` : 'translateZ(0)';

  if (_prefersReducedMotion) {
    chatbarWrap.style.transition = 'none';
    chatbarWrap.style.transform  = transform;
  } else {
    const dur  = kbHeight > 0 ? '0.35s' : '0.28s';
    const ease = kbHeight > 0 ? EASE.keyboardUp : EASE.keyboardDown;
    chatbarWrap.style.transition = `transform ${dur} ${ease}`;
    chatbarWrap.style.transform  = transform;

    const capturedKbH = kbHeight;
    _kbAnimFrame = requestAnimationFrame(() => {
      _kbAnimFrame = null;
      setTimeout(() => {
        if (_stableKbH === capturedKbH) chatbarWrap.style.transition = '';
      }, 380);
    });
  }

  _setSpacerHeight(barH + kbHeight);

  if (kbHeight > 0) {
    _programmaticScroll = true;
    const anchor = window._lastUserMsgEl;
    scrollHost.scrollTop = anchor
      ? Math.max(0, anchor.offsetTop - 16)
      : scrollHost.scrollHeight;
  }

  cancelAnimationFrame(_cleanupRafId);
  _cleanupRafId = requestAnimationFrame(() => {
    _cleanupRafId = 0;
    _lastScrollY  = scrollHost.scrollTop;
    resetScrollAccum();
    _programmaticScroll = false;
  });
}

function fixViewport() {
  if (_vvpDebounce) return;
  if (performance.now() < _themeFreezeUntil) return;
  _vvpDebounce = requestAnimationFrame(_applyViewport);
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', fixViewport, { passive: true });
  window.visualViewport.addEventListener('scroll', fixViewport, { passive: true });
  _setSpacerHeight(chatbarWrap.offsetHeight);
  _applyViewport();
} else {
  function _legacyFix() {
    const h = window.innerHeight + 'px';
    if (document.body.style.height !== h) document.body.style.height = h;
  }
  window.addEventListener('resize', _legacyFix, { passive: true });
  _legacyFix();
  _setSpacerHeight(chatbarWrap.offsetHeight);
}

/* ════════════════════════════════
THEME CHANGE DETECTION (prevents bounce)
════════════════════════════════ */
if (window.matchMedia) {
  const themeMQ = window.matchMedia('(prefers-color-scheme: dark)');
  const _onThemeChange = () => {
    // Freeze all viewport/resize reactions for 350ms
    _themeFreezeUntil = performance.now() + 350;

    // Cancel pending work
    if (_vvpDebounce) { cancelAnimationFrame(_vvpDebounce); _vvpDebounce = 0; }
    if (_kbAnimFrame) { cancelAnimationFrame(_kbAnimFrame); _kbAnimFrame = null; }

    // Re-apply current state cleanly after transition settles
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        _setSpacerHeight(chatbarWrap.offsetHeight + _stableKbH);
        _applyViewport();
      });
    });
  };
  if (themeMQ.addEventListener) {
    themeMQ.addEventListener('change', _onThemeChange);
  } else if (themeMQ.addListener) {
    themeMQ.addListener(_onThemeChange);
  }
}

/* ════════════════════════════════
HEADER / TAB SCROLL ANIMATION
════════════════════════════════ */
const HIDE_ACCUM  = 40;
const SHOW_ACCUM  = 55;
const LOGO_THRESH = 10;

function updateHeader() {
  _rafPending = false;
  if (_programmaticScroll) {
    _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
    return;
  }

  const sy    = scrollHost.scrollTop;
  const delta = sy - _lastScrollY;
  if (delta === 0) return;

  const now = performance.now();
  const dt  = Math.max(1, now - _lastScrollTime);
  _velocityEMA = _velocityEMA === 0
    ? delta / dt
    : _velocityEMA * (1 - VELOCITY_ALPHA) + (delta / dt) * VELOCITY_ALPHA;

  _lastScrollY    = sy;
  _lastScrollTime = now;

  if (sy <= LOGO_THRESH) {
    resetScrollAccum();
    if (_isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
    if (_isTabHidden)     { tabBar.classList.remove('hide');          _isTabHidden      = false; }
    if (_isTabScrolled)   { tabBar.classList.remove('scrolled');      _isTabScrolled    = false; }
    return;
  }

  if (!_isLogoCollapsed) { logoHeader.classList.add('collapsed'); _isLogoCollapsed = true;  }
  if (!_isTabScrolled)   { tabBar.classList.add('scrolled');      _isTabScrolled    = true; }

  if (_velocityEMA > 0.05) {
    _accumDown += delta;
    if (_accumUp > 0) _accumUp = 0;
    if (!_isTabHidden && _accumDown >= HIDE_ACCUM) {
      tabBar.classList.add('hide');
      _isTabHidden = true;
      _accumDown   = 0;
    }
  } else if (_velocityEMA < -0.05) {
    _accumUp += -delta;
    if (_accumDown > 0) _accumDown = 0;
    if (_isTabHidden && _accumUp >= SHOW_ACCUM) {
      tabBar.classList.remove('hide');
      _isTabHidden = false;
      _accumUp     = 0;
    }
  }
}

/* Scroll listener — uses requestPostAnimationFrame where available (Chrome 125+) */
const _scheduleHeaderUpdate = window.requestPostAnimationFrame || requestAnimationFrame;
scrollHost.addEventListener('scroll', () => {
  if (!_rafPending) {
    _rafPending = true;
    _scheduleHeaderUpdate(updateHeader);
  }
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
  const hasText = input.value.trim().length > 0;
  pill.classList.toggle('has-text', hasText);
  if (pill.classList.contains('non-ai-tab')) {
    _setSendMode(hasText ? 'cross' : 'send');
  }
});

/* ════════════════════════════════
PLUS MENU
════════════════════════════════ */
function openPlusMenu() {
  const rect  = plusBtn.getBoundingClientRect();
  const vvp   = window.visualViewport;
  const viewH = vvp ? vvp.height : window.innerHeight;
  const bottom = (viewH - rect.top + 8) + 'px';
  _plusOpen = true;
  plusBackdrop.classList.add('open');

  if (_prefersReducedMotion) {
    plusMenu.style.bottom = bottom;
    plusMenu.classList.add('open');
    return;
  }

  plusMenu.style.cssText = `bottom:${bottom};transition:none;transform:scale(0.88) translateY(10px);opacity:0`;
  plusMenu.getBoundingClientRect();
  plusMenu.classList.add('open');

  requestAnimationFrame(() => {
    plusMenu.style.transition = `transform 0.3s ${EASE.menuOpen}, opacity 0.2s ease-out`;
    plusMenu.style.transform  = 'scale(1) translateY(0)';
    plusMenu.style.opacity    = '1';
    plusMenu.addEventListener('transitionend', function _onOpen(e) {
      if (e.propertyName !== 'opacity') return;
      plusMenu.removeEventListener('transitionend', _onOpen);
      plusMenu.style.transition = plusMenu.style.transform = plusMenu.style.opacity = '';
    });
  });
}

function closePlusMenu() {
  if (!_plusOpen) return;
  _plusOpen = false;
  plusBackdrop.classList.remove('open');

  if (_prefersReducedMotion) { plusMenu.classList.remove('open'); return; }

  plusMenu.style.transition = `transform 0.22s ${EASE.menuClose}, opacity 0.18s ease-in`;
  plusMenu.style.transform  = 'scale(0.88) translateY(10px)';
  plusMenu.style.opacity    = '0';
  plusMenu.addEventListener('transitionend', function _onClose(e) {
    if (e.propertyName !== 'opacity') return;
    plusMenu.removeEventListener('transitionend', _onClose);
    plusMenu.classList.remove('open');
    plusMenu.style.cssText = '';
  });
}

plusBtn.addEventListener('click', (e) => { e.stopPropagation(); _plusOpen ? closePlusMenu() : openPlusMenu(); });
plusBackdrop.addEventListener('click', closePlusMenu);
['pmPhoto', 'pmCamera', 'pmFile', 'pmLocation'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', closePlusMenu);
});

/* ════════════════════════════════
TAB BAR — instant content swap
════════════════════════════════ */
async function _loadTab(key) {
  const chatArea = document.getElementById('chatArea');
  if (key === 'ai') {
    if (chatArea) chatArea.style.display = '';
    pageContent.style.display = 'none';
    return;
  }
  if (chatArea) chatArea.style.display = 'none';
  pageContent.style.display = '';

  if (_moduleCache[key]) {
    if (window[`_atkynInit_${key}`]) window[`_atkynInit_${key}`]();
    return;
  }

  pageContent.innerHTML = `<div class="tab-skeleton"><div class="sk-line"></div><div class="sk-line sk-short"></div><div class="sk-line"></div></div>`;
  try {
    _loadModuleCSS(key);
    await _loadScript(`modules/${key}/${key}.js`);
    _moduleCache[key] = true;
  } catch (_) {
    pageContent.innerHTML = `<div class="tab-empty"><p>Coming soon</p></div>`;
  }
}

function _loadModuleCSS(key) {
  const id = `_atkyn_css_${key}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id   = id;
  link.rel  = 'stylesheet';
  link.href = `modules/${key}/${key}.css`;
  document.head.appendChild(link);
}

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s   = document.createElement('script');
    s.src     = src;
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function _animateContentIn() {
  if (_prefersReducedMotion) return;
  pageContent.style.opacity    = '0';
  pageContent.style.transform  = 'translateY(8px)';
  pageContent.style.transition = 'none';
  pageContent.getBoundingClientRect();
  pageContent.style.transition = `opacity 0.22s ease-out, transform 0.28s ${EASE.contentSwap}`;
  pageContent.style.opacity    = '1';
  pageContent.style.transform  = 'translateY(0)';
}

let _activeTabEl = tabBar.querySelector('.tab.active');
tabBar.addEventListener('click', async e => {
  const tab = e.target.closest('.tab');
  if (!tab || tab.classList.contains('active')) return;
  const key = tab.getAttribute('data-tab');

  if (_currentTabKey === 'ai' && _msgWrap) {
    sessionStorage.setItem('atkyn_chat_html',   _msgWrap.innerHTML);
    sessionStorage.setItem('atkyn_chat_scroll',  String(scrollHost.scrollTop));
  }

  if (_activeTabEl) _activeTabEl.classList.remove('active');
  tab.classList.add('active');
  _activeTabEl = tab;
  _currentTabKey = key;

  const q = sessionStorage.getItem('atkyn_last_query') || '';
  if (key === 'ai') {
    input.value = '';
    pill.classList.remove('has-text');
    pill.classList.remove('non-ai-tab');
    _setSendMode('send');
  } else {
    pill.classList.add('non-ai-tab');
    if (q) {
      input.value = q;
      pill.classList.add('has-text');
      _setSendMode('cross');
    } else {
      _setSendMode('send');
    }
  }

  scrollHost.scrollTo({ top: 0, behavior: _prefersReducedMotion ? 'auto' : 'smooth' });
  resetScrollAccum();
  if (_isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
  if (_isTabHidden)     { tabBar.classList.remove('hide');          _isTabHidden      = false; }
  if (_isTabScrolled)   { tabBar.classList.remove('scrolled');      _isTabScrolled    = false; }

  await _loadTab(key);
  _animateContentIn();
}, { passive: true });

/* ── Public API ── */
window._atkynModuleCache = _moduleCache;
window._atkynPageContent = pageContent;
window._atkynAnimateIn   = _animateContentIn;
window._atkynLoadTab     = _loadTab;
