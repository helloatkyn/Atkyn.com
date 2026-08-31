/* ═══════════════════════════════════════════════════════════════════
core.js — Atkyn shared UI logic
UPDATED: restored header/tab hide-show behavior by binding it to the
actual active scroll source, without changing original animation logic
════════════════════════════════════════════════════════════════════ */

/* ── Reduced-motion flag ── */
const _prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Easing constants ── */
const EASE = {
  keyboardUp: 'cubic-bezier(0.32, 0.72, 0, 1)',
  keyboardDown: 'cubic-bezier(0.32, 0.72, 0, 1)',
  headerHide: 'cubic-bezier(0.4, 0, 1, 1)',
  headerShow: 'cubic-bezier(0, 0, 0.2, 1)',
  chatbarEnter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  menuOpen: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  menuClose: 'cubic-bezier(0.4, 0, 1, 1)',
  contentSwap: 'cubic-bezier(0.16, 1, 0.3, 1)'
};

/* ── Stable DOM references ── */
const scrollHost = document.getElementById('scrollHost');
const logoHeader = document.querySelector('.logo-header');
const tabBar = document.getElementById('tabBar');
const chatbarWrap = document.querySelector('.chatbar-wrap');
const plusBtn = document.getElementById('plusBtn');
const plusMenu = document.getElementById('plusMenu');
const plusBackdrop = document.getElementById('plusBackdrop');
const pill = document.getElementById('pill');
const input = document.getElementById('cbInput');
const sendBtn = document.getElementById('sendBtn');
const pageContent = document.getElementById('pageContent');
const _msgWrap = document.getElementById('msgWrap');

/* ── Floating chatbar remains viewport-level; this is intentional ── */
if (chatbarWrap) {
  chatbarWrap.style.position = 'fixed';
  chatbarWrap.style.left = '0';
  chatbarWrap.style.right = '0';
  chatbarWrap.style.bottom = '0';
  chatbarWrap.style.width = '100%';
}

/* ── SVG constants ── */
const SVG_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="5 11 12 4 19 11"/></svg>';
const SVG_CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/* ── Scroll / header state ── */
let _rafPending = false;
let _lastScrollY = 0;
let _currentScrollY = 0;
let _scrollSource = 'unknown'; /* host | window | unknown */
let _accumDown = 0;
let _accumUp = 0;
let _keyboardOpen = false;
let _isLogoCollapsed = false;
let _isTabHidden = false;
let _isTabScrolled = false;
let _scrollRafId = null;
let _programmaticScroll = false;
let _programmaticTimer = 0;
let _kbProgrammaticUntil = 0;
let _plusOpen = false;

/* ── Velocity EMA ── */
let _velocityEMA = 0;
let _lastScrollTime = 0;
const VELOCITY_ALPHA = 0.3;

/* ── Keyboard / viewport state ── */
let _cleanupRafId = 0;
let _stableKbH = 0;
let _kbAnimFrame = null;
let _vvpDebounce = 0;
let _barHeight = chatbarWrap ? chatbarWrap.offsetHeight : 0;

/* ── Keyboard context / synchronization state ── */
let _keyboardContext = false;
let _preKbCaptured = false;
let _preKbNearBottom = false;
let _kbMode = 'none'; /* none | bottom | preserve */
let _kbAutoScroll = false;

/* ── Spacer guard ── */
let _lastSpacerH = -1;

/* ── Theme-freeze window ── */
let _themeFreezeUntil = 0;

/* ── Public: last user message element ── */
window._lastUserMsgEl = null;

/* ── Current active tab key ── */
let _currentTabKey = 'ai';
if (tabBar) {
  const _active = tabBar.querySelector('.tab.active');
  _currentTabKey = _active ? _active.getAttribute('data-tab') : 'ai';
}

/* ── Module cache ── */
const _moduleCache = {};

/* ════════════════════════════════
HELPERS
════════════════════════════════ */
function resetScrollAccum() {
  _accumDown = 0;
  _accumUp = 0;
  _velocityEMA = 0;
  _lastScrollTime = 0;
}

function _markProgrammatic(ms) {
  _programmaticScroll = true;
  _kbProgrammaticUntil = performance.now() + ms;

  clearTimeout(_programmaticTimer);
  _programmaticTimer = setTimeout(() => {
    _programmaticScroll = false;
  }, ms);
}

function _getScrollY() {
  const winY = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  const hostY = scrollHost ? scrollHost.scrollTop : 0;
  return Math.max(winY, hostY);
}

function _getScrollMetrics() {
  const doc = document.documentElement;
  const body = document.body;

  const docH = Math.max(doc ? doc.scrollHeight : 0, body ? body.scrollHeight : 0);
  const hostH = scrollHost ? scrollHost.scrollHeight : 0;

  const winY = window.scrollY || (doc ? doc.scrollTop : 0) || 0;
  const hostY = scrollHost ? scrollHost.scrollTop : 0;

  const useHost = scrollHost && (
    _scrollSource === 'host' ||
    hostY > 0 ||
    hostH > docH + 1
  );

  if (useHost) {
    return {
      useHost: true,
      y: hostY,
      client: scrollHost.clientHeight,
      height: hostH
    };
  }

  return {
    useHost: false,
    y: winY,
    client: window.innerHeight,
    height: docH
  };
}

function _setScrollY(y, behavior = 'auto') {
  const val = Math.max(0, Math.round(y));
  const m = _getScrollMetrics();

  if (m.useHost && scrollHost) {
    if (behavior === 'auto' || _prefersReducedMotion) {
      scrollHost.scrollTop = val;
    } else {
      scrollHost.scrollTo({ top: val, behavior });
    }
    _scrollSource = 'host';
  } else {
    window.scrollTo({ top: val, behavior });
    _scrollSource = 'window';
  }

  _currentScrollY = val;
}

function _isEditable(el) {
  if (!el || el.nodeType !== 1) return false;

  const tag = el.tagName;

  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable === true
  );
}

function _capturePreKeyboard() {
  if (_preKbCaptured || _stableKbH > 0) return;

  const m = _getScrollMetrics();
  const bottomDist = Math.max(0, m.height - m.y - m.client);

  _preKbNearBottom = bottomDist < Math.max(220, Math.round(m.client * 0.35));
  _preKbCaptured = true;
}

/* ════════════════════════════════
KEYBOARD CONTEXT
════════════════════════════════ */
_keyboardContext = _isEditable(document.activeElement);

document.addEventListener('focusin', (e) => {
  if (_isEditable(e.target)) {
    _keyboardContext = true;

    if (_stableKbH === 0) {
      _capturePreKeyboard();
    }
  }
}, true);

document.addEventListener('focusout', (e) => {
  const next = e.relatedTarget;

  if (!_isEditable(next)) {
    _keyboardContext = false;

    if (_stableKbH === 0) {
      _preKbCaptured = false;
      _preKbNearBottom = false;
    }
  }
}, true);

/* ════════════════════════════════
SEND BUTTON MODE
════════════════════════════════ */
let _sendMode = 'send';

function _setSendMode(mode) {
  if (!sendBtn) return;
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

if (sendBtn) {
  sendBtn.addEventListener('click', () => {
    if (pill && pill.classList.contains('non-ai-tab')) {
      if (input) input.value = '';
      if (pill) pill.classList.remove('has-text');
      _setSendMode('send');
    }
  });
}

/* ════════════════════════════════
SCROLL TO MSG
════════════════════════════════ */
function scrollToMsg(el) {
  if (!el) return;

  if (_scrollRafId !== null) cancelAnimationFrame(_scrollRafId);

  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId = null;

    const tabBarH = tabBar ? tabBar.offsetHeight : 0;
    const top = Math.max(
      0,
      el.getBoundingClientRect().top + _getScrollY() - tabBarH - 8
    );

    _lastScrollY = top;
    resetScrollAccum();

    _markProgrammatic(_prefersReducedMotion ? 180 : 450);
    _setScrollY(top, _prefersReducedMotion ? 'auto' : 'smooth');
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

if (chatbarWrap) {
  const _barResizeObserver = new ResizeObserver((entries) => {
    if (performance.now() < _themeFreezeUntil) return;

    const entry = entries[entries.length - 1];
    const barH = entry.borderBoxSize
      ? entry.borderBoxSize[0].blockSize
      : entry.contentRect.height;

    _barHeight = Math.round(barH);
    _setSpacerHeight(_barHeight + _stableKbH);
  });

  _barResizeObserver.observe(chatbarWrap);
}

/* ── Chatbar entrance animation ── */
(function _chatbarEntrance() {
  if (!chatbarWrap || _prefersReducedMotion) return;

  chatbarWrap.style.willChange = 'transform,opacity';
  chatbarWrap.style.transition = 'none';
  chatbarWrap.style.transform = 'translateY(24px) translateZ(0)';
  chatbarWrap.style.opacity = '0';

  chatbarWrap.getBoundingClientRect();

  requestAnimationFrame(() => {
    chatbarWrap.style.transition = `transform 0.45s ${EASE.chatbarEnter}, opacity 0.35s ease-out`;
    chatbarWrap.style.transform = 'translateY(0) translateZ(0)';
    chatbarWrap.style.opacity = '1';

    chatbarWrap.addEventListener('transitionend', function _onEntry(e) {
      if (e.propertyName !== 'transform') return;
      chatbarWrap.removeEventListener('transitionend', _onEntry);

      chatbarWrap.style.willChange = '';
      chatbarWrap.style.transition = '';
      chatbarWrap.style.transform = '';
      chatbarWrap.style.opacity = '';
    });
  });
})();

/* ── Keyboard height state machine ── */
function _computeKeyboardHeight(vvp) {
  const raw = Math.max(0, Math.round(window.innerHeight - vvp.height - vvp.offsetTop));

  const openMin = Math.max(120, Math.round(window.innerHeight * 0.14));
  const closeMax = 64;
  const noise = 6;

  if (_stableKbH === 0) {
    if (!_keyboardContext) return 0;
    if (raw >= openMin) return raw;
    return 0;
  }

  if (raw <= closeMax) return 0;

  if (Math.abs(raw - _stableKbH) <= noise) {
    return _stableKbH;
  }

  return raw;
}

/* ── Keyboard scroll synchronization ── */
function _adjustScrollForKeyboard(delta) {
  if (!delta) return;

  const y = _getScrollY();

  _markProgrammatic(180);
  _setScrollY(y + delta, 'auto');
}

function _syncKeyboardScroll(oldKb, newKb) {
  if (oldKb === 0 && newKb > 0) {
    if (!_preKbCaptured) {
      _capturePreKeyboard();
    }

    _kbMode = _preKbNearBottom ? 'bottom' : 'preserve';
    _kbAutoScroll = _kbMode === 'bottom';
  }

  if (_kbMode === 'bottom' && _kbAutoScroll && oldKb !== newKb) {
    _adjustScrollForKeyboard(newKb - oldKb);
  }

  if (newKb === 0 && oldKb > 0) {
    _kbMode = 'none';
    _kbAutoScroll = false;
    _preKbCaptured = false;
    _preKbNearBottom = false;
  }
}

/* ── Keyboard / VisualViewport positioning ── */
function _applyViewport(force = false) {
  _vvpDebounce = 0;

  if (!window.visualViewport || !chatbarWrap) return;
  if (!force && performance.now() < _themeFreezeUntil) return;

  const vvp = window.visualViewport;
  const kbHeight = _computeKeyboardHeight(vvp);

  if (!force && kbHeight === _stableKbH) return;

  const oldKb = _stableKbH;

  _stableKbH = kbHeight;
  _keyboardOpen = kbHeight > 0;

  if (_kbAnimFrame) {
    cancelAnimationFrame(_kbAnimFrame);
    _kbAnimFrame = null;
  }

  chatbarWrap.style.transition = 'none';
  chatbarWrap.style.transform = kbHeight > 0
    ? `translateY(-${kbHeight}px) translateZ(0)`
    : 'translateZ(0)';

  _setSpacerHeight(_barHeight + kbHeight);
  _syncKeyboardScroll(oldKb, kbHeight);

  cancelAnimationFrame(_cleanupRafId);

  _cleanupRafId = requestAnimationFrame(() => {
    _cleanupRafId = 0;
    resetScrollAccum();
  });
}

function fixViewport() {
  if (_vvpDebounce) return;
  if (performance.now() < _themeFreezeUntil) return;

  _vvpDebounce = requestAnimationFrame(() => {
    _vvpDebounce = 0;
    _applyViewport(false);
  });
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', fixViewport, { passive: true });

  window.visualViewport.addEventListener('scroll', () => {
    if (_keyboardContext || _stableKbH > 0) {
      fixViewport();
    }
  }, { passive: true });

  _setSpacerHeight(_barHeight);
  _applyViewport(true);
} else {
  function _legacyFix() {
    const h = window.innerHeight + 'px';
    if (document.body.style.height !== h) {
      document.body.style.height = h;
    }
  }

  window.addEventListener('resize', _legacyFix, { passive: true });
  _legacyFix();
  _setSpacerHeight(_barHeight);
}

/* ════════════════════════════════
THEME CHANGE DETECTION
════════════════════════════════ */
if (window.matchMedia) {
  const themeMQ = window.matchMedia('(prefers-color-scheme: dark)');

  const _onThemeChange = () => {
    _themeFreezeUntil = performance.now() + 350;

    if (_vvpDebounce) {
      cancelAnimationFrame(_vvpDebounce);
      _vvpDebounce = 0;
    }

    if (_kbAnimFrame) {
      cancelAnimationFrame(_kbAnimFrame);
      _kbAnimFrame = null;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (chatbarWrap) {
          _barHeight = chatbarWrap.offsetHeight;
        }

        _setSpacerHeight(_barHeight + _stableKbH);
        _applyViewport(true);
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
const HIDE_ACCUM = 40;
const SHOW_ACCUM = 55;
const LOGO_THRESH = 10;

function updateHeader() {
  _rafPending = false;

  const sy = _currentScrollY;

  if (_programmaticScroll || performance.now() < _kbProgrammaticUntil) {
    _lastScrollY = sy;
    resetScrollAccum();
    return;
  }

  const delta = sy - _lastScrollY;
  if (delta === 0) return;

  const now = performance.now();
  const dt = Math.max(1, now - _lastScrollTime);

  _velocityEMA = _velocityEMA === 0
    ? delta / dt
    : _velocityEMA * (1 - VELOCITY_ALPHA) + (delta / dt) * VELOCITY_ALPHA;

  _lastScrollY = sy;
  _lastScrollTime = now;

  if (sy <= LOGO_THRESH) {
    resetScrollAccum();

    if (_isLogoCollapsed && logoHeader) {
      logoHeader.classList.remove('collapsed');
      _isLogoCollapsed = false;
    }

    if (_isTabHidden && tabBar) {
      tabBar.classList.remove('hide');
      _isTabHidden = false;
    }

    if (_isTabScrolled && tabBar) {
      tabBar.classList.remove('scrolled');
      _isTabScrolled = false;
    }

    return;
  }

  if (!_isLogoCollapsed && logoHeader) {
    logoHeader.classList.add('collapsed');
    _isLogoCollapsed = true;
  }

  if (!_isTabScrolled && tabBar) {
    tabBar.classList.add('scrolled');
    _isTabScrolled = true;
  }

  if (_velocityEMA > 0.05) {
    _accumDown += delta;
    if (_accumUp > 0) _accumUp = 0;

    if (!_isTabHidden && _accumDown >= HIDE_ACCUM && tabBar) {
      tabBar.classList.add('hide');
      _isTabHidden = true;
      _accumDown = 0;
    }
  } else if (_velocityEMA < -0.05) {
    _accumUp += -delta;
    if (_accumDown > 0) _accumDown = 0;

    if (_isTabHidden && _accumUp >= SHOW_ACCUM && tabBar) {
      tabBar.classList.remove('hide');
      _isTabHidden = false;
      _accumUp = 0;
    }
  }
}

const _scheduleHeaderUpdate = window.requestPostAnimationFrame || requestAnimationFrame;

/*
  Single capture-phase scroll listener.
  This works for both #scrollHost scrolling and document/window scrolling,
  without creating duplicate header systems.
*/
function _onMainScroll(e) {
  const t = e.target;
  if (!t) return;

  const isMainScroller =
    t === document ||
    t === document.documentElement ||
    t === document.body ||
    (scrollHost && t === scrollHost);

  if (!isMainScroller) return;

  const source = (scrollHost && t === scrollHost) ? 'host' : 'window';
  const y = source === 'host'
    ? scrollHost.scrollTop
    : (window.scrollY || document.documentElement.scrollTop || 0);

  if (
    _keyboardOpen &&
    !_programmaticScroll &&
    performance.now() > _kbProgrammaticUntil
  ) {
    _kbAutoScroll = false;
  }

  if (_scrollSource === 'unknown') {
    _scrollSource = source;
    _lastScrollY = y;
  }

  if (_scrollSource !== source) {
    _scrollSource = source;
    _currentScrollY = y;
    _lastScrollY = y;
    resetScrollAccum();
    return;
  }

  if (y === _currentScrollY) return;

  _currentScrollY = y;

  if (!_rafPending) {
    _rafPending = true;
    _scheduleHeaderUpdate(updateHeader);
  }
}

document.addEventListener('scroll', _onMainScroll, {
  capture: true,
  passive: true
});

_currentScrollY = _getScrollY();
_lastScrollY = _currentScrollY;

if (scrollHost && scrollHost.scrollTop > 0) {
  _scrollSource = 'host';
} else if ((window.scrollY || document.documentElement.scrollTop || 0) > 0) {
  _scrollSource = 'window';
}

/* ════════════════════════════════
INPUT & PILL
════════════════════════════════ */
if (pill && input) {
  pill.addEventListener('pointerdown', (e) => {
    if (
      e.target !== pill &&
      e.target !== input &&
      !e.target.closest('button, .overlay-input-wrap')
    ) {
      return;
    }

    if (document.activeElement === input || _keyboardOpen) return;

    e.preventDefault();

    requestAnimationFrame(() => {
      input.focus();
    });
  }, { passive: false });

  input.addEventListener('input', () => {
    const hasText = input.value.trim().length > 0;
    pill.classList.toggle('has-text', hasText);

    if (pill.classList.contains('non-ai-tab')) {
      _setSendMode(hasText ? 'cross' : 'send');
    }
  });
}

/* ════════════════════════════════
PLUS MENU
════════════════════════════════ */
function openPlusMenu() {
  if (!plusBtn || !plusMenu || !plusBackdrop) return;

  const rect = plusBtn.getBoundingClientRect();
  const vvp = window.visualViewport;
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
    plusMenu.style.transform = 'scale(1) translateY(0)';
    plusMenu.style.opacity = '1';

    plusMenu.addEventListener('transitionend', function _onOpen(e) {
      if (e.propertyName !== 'opacity') return;
      plusMenu.removeEventListener('transitionend', _onOpen);
      plusMenu.style.transition = '';
      plusMenu.style.transform = '';
      plusMenu.style.opacity = '';
    });
  });
}

function closePlusMenu() {
  if (!_plusOpen || !plusMenu || !plusBackdrop) return;

  _plusOpen = false;
  plusBackdrop.classList.remove('open');

  if (_prefersReducedMotion) {
    plusMenu.classList.remove('open');
    return;
  }

  plusMenu.style.transition = `transform 0.22s ${EASE.menuClose}, opacity 0.18s ease-in`;
  plusMenu.style.transform = 'scale(0.88) translateY(10px)';
  plusMenu.style.opacity = '0';

  plusMenu.addEventListener('transitionend', function _onClose(e) {
    if (e.propertyName !== 'opacity') return;
    plusMenu.removeEventListener('transitionend', _onClose);
    plusMenu.classList.remove('open');
    plusMenu.style.cssText = '';
  });
}

if (plusBtn) {
  plusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _plusOpen ? closePlusMenu() : openPlusMenu();
  });
}

if (plusBackdrop) {
  plusBackdrop.addEventListener('click', closePlusMenu);
}

['pmPhoto', 'pmCamera', 'pmFile', 'pmLocation'].forEach((id) => {
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
    if (pageContent) pageContent.style.display = 'none';
    return;
  }

  if (chatArea) chatArea.style.display = 'none';
  if (pageContent) pageContent.style.display = '';

  if (_moduleCache[key]) {
    const initFn = window['_atkynInit_' + key];
    if (typeof initFn === 'function') initFn();
    return;
  }

  if (pageContent) {
    pageContent.innerHTML =
      '<div class="tab-skeleton">' +
        '<div class="sk-line"></div>' +
        '<div class="sk-line sk-short"></div>' +
        '<div class="sk-line"></div>' +
      '</div>';
  }

  try {
    _loadModuleCSS(key);
    await _loadScript(`modules/${key}/${key}.js`);
    _moduleCache[key] = true;
  } catch (_) {
    if (pageContent) {
      pageContent.innerHTML = '<div class="tab-empty"><p>Coming soon</p></div>';
    }
  }
}

function _loadModuleCSS(key) {
  const id = `_atkyn_css_${key}`;
  if (document.getElementById(id)) return;

  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `modules/${key}/${key}.css`;

  document.head.appendChild(link);
}

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function _animateContentIn() {
  if (!pageContent || _prefersReducedMotion) return;

  pageContent.style.opacity = '0';
  pageContent.style.transform = 'translateY(8px)';
  pageContent.style.transition = 'none';

  pageContent.getBoundingClientRect();

  pageContent.style.transition = `opacity 0.22s ease-out, transform 0.28s ${EASE.contentSwap}`;
  pageContent.style.opacity = '1';
  pageContent.style.transform = 'translateY(0)';
}

let _activeTabEl = tabBar ? tabBar.querySelector('.tab.active') : null;

if (tabBar) {
  tabBar.addEventListener('click', async (e) => {
    const tab = e.target.closest('.tab');
    if (!tab || tab.classList.contains('active')) return;

    const key = tab.getAttribute('data-tab');
    if (!key) return;

    if (_currentTabKey === 'ai' && _msgWrap) {
      try {
        sessionStorage.setItem('atkyn_chat_html', _msgWrap.innerHTML);
        sessionStorage.setItem('atkyn_chat_scroll', String(_getScrollY()));
      } catch (_) {}
    }

    if (_activeTabEl) _activeTabEl.classList.remove('active');
    tab.classList.add('active');

    _activeTabEl = tab;
    _currentTabKey = key;

    let q = '';
    try {
      q = sessionStorage.getItem('atkyn_last_query') || '';
    } catch (_) {}

    if (key === 'ai') {
      if (input) input.value = '';
      if (pill) {
        pill.classList.remove('has-text');
        pill.classList.remove('non-ai-tab');
      }
      _setSendMode('send');
    } else {
      if (pill) pill.classList.add('non-ai-tab');

      if (q && input) {
        input.value = q;
        if (pill) pill.classList.add('has-text');
        _setSendMode('cross');
      } else {
        _setSendMode('send');
      }
    }

    _markProgrammatic(_prefersReducedMotion ? 180 : 420);
    _setScrollY(0, _prefersReducedMotion ? 'auto' : 'smooth');
    resetScrollAccum();

    if (_isLogoCollapsed && logoHeader) {
      logoHeader.classList.remove('collapsed');
      _isLogoCollapsed = false;
    }

    if (_isTabHidden && tabBar) {
      tabBar.classList.remove('hide');
      _isTabHidden = false;
    }

    if (_isTabScrolled && tabBar) {
      tabBar.classList.remove('scrolled');
      _isTabScrolled = false;
    }

    await _loadTab(key);
    _animateContentIn();
  }, { passive: true });
}

/* ── Public API ── */
window._atkynModuleCache = _moduleCache;
window._atkynPageContent = pageContent;
window._atkynAnimateIn = _animateContentIn;
window._atkynLoadTab = _loadTab;
window._atkynGetScrollY = _getScrollY;
window._atkynSetScrollY = _setScrollY;
