/* ═══════════════════════════════════════════════════════════════════
core.js — Atkyn shared UI logic
UPDATED: keyboard / URL-bar separation
Preserves document-level scroll, keyboard stability, chatbar anchoring
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
const chatArea = document.getElementById('chatArea');
const _msgWrap = document.getElementById('msgWrap');

/* ── Chatbar must remain viewport-anchored during document scroll ── */
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
let _accumDown = 0;
let _accumUp = 0;
let _keyboardOpen = false;
let _isLogoCollapsed = false;
let _isTabHidden = false;
let _isTabScrolled = false;
let _scrollRafId = null;
let _programmaticScroll = false;
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
let _lastChatbarTransform = '';

/* ── Keyboard context ── */
let _keyboardContext = false;

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
DOCUMENT SCROLL HELPERS
════════════════════════════════ */
function _getScrollY() {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

function _setScrollY(y, behavior = 'auto') {
  window.scrollTo({
    top: Math.max(0, Math.round(y)),
    behavior
  });
}

function _getScrollHeight() {
  return Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0,
    scrollHost ? scrollHost.scrollHeight : 0
  );
}

function _getOffsetTop(el) {
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  return rect.top + _getScrollY();
}

function resetScrollAccum() {
  _accumDown = 0;
  _accumUp = 0;
  _velocityEMA = 0;
  _lastScrollTime = 0;
}

/* ════════════════════════════════
KEYBOARD CONTEXT HELPERS
════════════════════════════════ */
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

_keyboardContext = _isEditable(document.activeElement);

document.addEventListener('focusin', (e) => {
  if (_isEditable(e.target)) {
    _keyboardContext = true;
  }
}, true);

document.addEventListener('focusout', (e) => {
  const next = e.relatedTarget;

  if (!_isEditable(next)) {
    _keyboardContext = false;
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
      pill.classList.remove('has-text');
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
    _programmaticScroll = true;

    const tabBarH = tabBar ? tabBar.offsetHeight : 0;
    const target = Math.max(0, _getOffsetTop(el) - tabBarH - 8);

    _lastScrollY = target;
    resetScrollAccum();

    if (_prefersReducedMotion) {
      _setScrollY(target, 'auto');
      _programmaticScroll = false;
    } else {
      _setScrollY(target, 'smooth');
      setTimeout(() => {
        _programmaticScroll = false;
      }, 420);
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

  /*
    These thresholds intentionally ignore small browser-toolbar deltas.
    URL-bar animation usually produces relatively small height changes.
    Real keyboards normally produce much larger visual viewport changes.
  */
  const openMin = Math.max(140, Math.round(window.innerHeight * 0.16));
  const closeMax = 80;
  const updateMin = 72;

  /* Keyboard is currently closed. */
  if (_stableKbH === 0) {
    if (!_keyboardContext) return 0;
    if (raw >= openMin) return raw;
    return 0;
  }

  /* Keyboard is currently open. */
  if (raw <= closeMax) return 0;

  /*
    If focus is gone but the viewport has not yet collapsed,
    hold the current keyboard offset until the browser actually settles.
    This avoids a premature drop that would momentarily hide the chatbar.
  */
  if (!_keyboardContext) return _stableKbH;

  /*
    Ignore small changes while the keyboard is already open.
    This prevents URL-bar or browser-chrome noise from moving the bar.
  */
  if (Math.abs(raw - _stableKbH) < updateMin) return _stableKbH;

  if (raw >= openMin) return raw;

  return _stableKbH;
}

/* ── Keyboard / VisualViewport positioning ── */
function _applyViewport(force = false) {
  if (!window.visualViewport || !chatbarWrap) return;
  if (!force && performance.now() < _themeFreezeUntil) return;

  const vvp = window.visualViewport;
  const kbHeight = _computeKeyboardHeight(vvp);

  if (!force && kbHeight === _stableKbH) return;

  const wasOpen = _stableKbH > 0;

  _stableKbH = kbHeight;
  _keyboardOpen = kbHeight > 0;

  const transform = kbHeight > 0
    ? `translateY(-${kbHeight}px) translateZ(0)`
    : 'translateZ(0)';

  if (force || transform !== _lastChatbarTransform) {
    if (_kbAnimFrame) {
      cancelAnimationFrame(_kbAnimFrame);
      _kbAnimFrame = null;
    }

    if (force || _prefersReducedMotion) {
      chatbarWrap.style.transition = 'none';
      chatbarWrap.style.transform = transform;

      requestAnimationFrame(() => {
        if (_stableKbH === kbHeight) {
          chatbarWrap.style.transition = '';
        }
      });
    } else {
      const dur = kbHeight > 0 ? '0.35s' : '0.28s';
      const ease = kbHeight > 0 ? EASE.keyboardUp : EASE.keyboardDown;

      chatbarWrap.style.transition = `transform ${dur} ${ease}`;
      chatbarWrap.style.transform = transform;

      const capturedKbH = kbHeight;

      _kbAnimFrame = requestAnimationFrame(() => {
        _kbAnimFrame = null;
        setTimeout(() => {
          if (_stableKbH === capturedKbH) {
            chatbarWrap.style.transition = '';
          }
        }, 380);
      });
    }

    _lastChatbarTransform = transform;
  }

  _setSpacerHeight(_barHeight + kbHeight);

  if (!wasOpen && kbHeight > 0) {
    _programmaticScroll = true;

    const anchor = window._lastUserMsgEl;
    const target = anchor
      ? Math.max(0, _getOffsetTop(anchor) - 16)
      : _getScrollHeight();

    _setScrollY(target, 'auto');
  }

  cancelAnimationFrame(_cleanupRafId);

  _cleanupRafId = requestAnimationFrame(() => {
    _cleanupRafId = 0;
    _lastScrollY = _getScrollY();
    resetScrollAccum();
    _programmaticScroll = false;
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

  /*
    visualViewport scroll is only useful while keyboard positioning is active.
    Ignoring it during normal scroll removes unnecessary viewport churn.
  */
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

  if (!logoHeader || !tabBar) return;

  const sy = _getScrollY();

  if (_programmaticScroll) {
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

    if (_isLogoCollapsed) {
      logoHeader.classList.remove('collapsed');
      _isLogoCollapsed = false;
    }

    if (_isTabHidden) {
      tabBar.classList.remove('hide');
      _isTabHidden = false;
    }

    if (_isTabScrolled) {
      tabBar.classList.remove('scrolled');
      _isTabScrolled = false;
    }

    return;
  }

  if (!_isLogoCollapsed) {
    logoHeader.classList.add('collapsed');
    _isLogoCollapsed = true;
  }

  if (!_isTabScrolled) {
    tabBar.classList.add('scrolled');
    _isTabScrolled = true;
  }

  if (_velocityEMA > 0.05) {
    _accumDown += delta;
    if (_accumUp > 0) _accumUp = 0;

    if (!_isTabHidden && _accumDown >= HIDE_ACCUM) {
      tabBar.classList.add('hide');
      _isTabHidden = true;
      _accumDown = 0;
    }
  } else if (_velocityEMA < -0.05) {
    _accumUp += -delta;
    if (_accumDown > 0) _accumDown = 0;

    if (_isTabHidden && _accumUp >= SHOW_ACCUM) {
      tabBar.classList.remove('hide');
      _isTabHidden = false;
      _accumUp = 0;
    }
  }
}

const _scheduleHeaderUpdate = window.requestPostAnimationFrame || requestAnimationFrame;

window.addEventListener('scroll', () => {
  if (!_rafPending) {
    _rafPending = true;
    _scheduleHeaderUpdate(updateHeader);
  }
}, { passive: true });

_lastScrollY = _getScrollY();

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
  if (!pageContent) return;

  if (key === 'ai') {
    if (chatArea) chatArea.style.display = '';
    pageContent.style.display = 'none';
    return;
  }

  if (chatArea) chatArea.style.display = 'none';
  pageContent.style.display = '';

  if (_moduleCache[key]) {
    const initFn = window['_atkynInit_' + key];
    if (typeof initFn === 'function') initFn();
    return;
  }

  pageContent.innerHTML =
    '<div class="tab-skeleton">' +
      '<div class="sk-line"></div>' +
      '<div class="sk-line sk-short"></div>' +
      '<div class="sk-line"></div>' +
    '</div>';

  try {
    _loadModuleCSS(key);
    await _loadScript(`modules/${key}/${key}.js`);
    _moduleCache[key] = true;
  } catch (_) {
    pageContent.innerHTML = '<div class="tab-empty"><p>Coming soon</p></div>';
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

    _programmaticScroll = true;
    _setScrollY(0, _prefersReducedMotion ? 'auto' : 'smooth');
    resetScrollAccum();

    setTimeout(() => {
      _programmaticScroll = false;
    }, _prefersReducedMotion ? 0 : 420);

    if (logoHeader && _isLogoCollapsed) {
      logoHeader.classList.remove('collapsed');
      _isLogoCollapsed = false;
    }

    if (tabBar && _isTabHidden) {
      tabBar.classList.remove('hide');
      _isTabHidden = false;
    }

    if (tabBar && _isTabScrolled) {
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
