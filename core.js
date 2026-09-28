/* ═══════════════════════════════════════════════════════════════════
core.js — Atkyn shared UI logic [PRODUCTION · NATIVE-SMOOTH v7]
scroll · header animation · keyboard positioning · theme refresh
chatbar entrance · plus menu · tab navigation
════════════════════════════════════════════════════════════════════ */

/* ── Reduced-motion flag ── */
let _prefersReducedMotion = typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
const chatSpacer = document.getElementById('chatSpacer');

/* ── Cached layout metrics ── */
let _tabBarHeight = tabBar ? tabBar.offsetHeight : 0;
const vvp = window.visualViewport;

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
let _programmaticScrollToken = 0;

/* Each system owns its own programmatic-scroll guard */
const _scrollOwners = { keyboard: false, message: false, tab: false };

function _setScrollOwner(owner, on) {
  _scrollOwners[owner] = !!on;
  _programmaticScroll =
    _scrollOwners.keyboard || _scrollOwners.message || _scrollOwners.tab;
}

/* ── Velocity EMA ── */
let _velocityEMA = 0;
let _lastScrollTime = 0;
const VELOCITY_ALPHA = 0.3;

/* ── Keyboard / viewport state ── */
let _cleanupRafId = 0;
let _stableKbH = 0;
let _barHeight = chatbarWrap ? chatbarWrap.offsetHeight : 0;
let _lastChatbarTransform = '';
let _keyboardStyleRestoreRaf = 0;
let _keyboardStyleToken = 0;

/* Single geometry writer: every trigger coalesces into one rAF */
let _geomRaf = 0;
let _geomForce = false;
let _pendingSampleKey = '';

/* ── Chatbar transition ownership ── */
let _chatbarTransitionOwner = null;
let _chatbarEntranceActive = false;
let _chatbarEntranceAnims = null;

/* ── Spacer guard ── */
let _lastSpacerH = -1;

/* ── Plus menu state ── */
if (typeof _plusOpen === 'undefined') {
  globalThis._plusOpen = false;
}
let _plusAnimationToken = 0;
let _plusAnimFrame = 0;
let _plusCloseFallbackTimer = 0;
let _plusTransitionEndHandler = null;
let _plusMenuBaseStyles = null;

/* ── Content transition state ── */
let _contentAnimations = [];

/* ── Public: last user message element ── */
window._lastUserMsgEl = null;

/* ── Current active tab key ── */
let _currentTabKey = (() => {
  if (!tabBar) return 'ai';
  const a = tabBar.querySelector('.tab.active');
  return a ? a.getAttribute('data-tab') : 'ai';
})();

/* ── Module cache / in-flight loads ── */
const _moduleCache = {};
const _moduleLoadPromises = {};
const _scriptLoadPromises = {};
let _tabLoadRequestId = 0;

/* ════════════════════════════════
HELPERS
════════════════════════════════ */

function resetScrollAccum() {
  _accumDown = 0;
  _accumUp = 0;
  _velocityEMA = 0;
  _lastScrollTime = 0;
}

function _nextTabLoadRequestId() {
  _tabLoadRequestId += 1;
  return _tabLoadRequestId;
}

function _isCurrentTabRequest(key, requestId) {
  return requestId === _tabLoadRequestId && _currentTabKey === key;
}

/*
 * Keyboard inset in layout-viewport px:
 *   kb = max(0, layoutHeight - (visualViewport.offsetTop + visualViewport.height))
 * The fixed chatbar's base bottom edge is at layoutHeight, so translateY(-kb)
 * lands it on the visual viewport bottom. With resizes-content the layout
 * viewport shrinks too and kb resolves to ~0.
 */
function _getLayoutViewportHeight() {
  const docHeight = document.documentElement ? document.documentElement.clientHeight : 0;
  if (Number.isFinite(docHeight) && docHeight > 0) return docHeight;

  const innerHeight = window.innerHeight;
  return Number.isFinite(innerHeight) && innerHeight > 0 ? innerHeight : 0;
}

function _isEditableElement(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
  }
  return false;
}

function _hasRelevantKeyboardFocus() {
  const active = document.activeElement;
  return _isEditableElement(active);
}

/* One read phase: layout viewport, visual viewport and bar height from the same frame */
function _readViewportSample() {
  const layoutH = _getLayoutViewportHeight();
  const vvH = Number(vvp.height);
  const vvTop = Math.max(0, Number(vvp.offsetTop) || 0);

  const rectH = chatbarWrap.getBoundingClientRect().height;
  const barH = Number.isFinite(rectH) && rectH > 0
    ? Math.ceil(rectH)
    : chatbarWrap.offsetHeight;

  return { layoutH, vvH, vvTop, barH, key: layoutH + '|' + vvTop + '|' + vvH };
}

function _measureKeyboardInset(s) {
  /* Unusable reading: keep the last committed inset */
  if (!(s.layoutH > 0) || !Number.isFinite(s.vvH) || s.vvH < 0) return _stableKbH;

  const rawInset = Math.max(0, s.layoutH - (s.vvTop + s.vvH));

  /* Closed: need a real delta. Open: track down to ~0 (1px dead-band absorbs rounding). */
  if (_stableKbH <= 0) {
    if (!_hasRelevantKeyboardFocus() || rawInset <= 50) return 0;
  } else if (rawInset < 1) {
    return 0;
  }

  return Math.max(0, Math.ceil(rawInset));
}

function _cancelKeyboardRestoreRaf() {
  if (_keyboardStyleRestoreRaf) {
    cancelAnimationFrame(_keyboardStyleRestoreRaf);
    _keyboardStyleRestoreRaf = 0;
  }
}

function _scheduleKeyboardTransitionRestore(token) {
  _cancelKeyboardRestoreRaf();

  _keyboardStyleRestoreRaf = requestAnimationFrame(() => {
    _keyboardStyleRestoreRaf = 0;

    if (
      token !== _keyboardStyleToken ||
      _keyboardOpen ||
      !chatbarWrap
    ) {
      return;
    }

    chatbarWrap.style.transition = '';
    _chatbarTransitionOwner = null;
  });
}

/* ════════════════════════════════
SEND BUTTON MODE
════════════════════════════════ */

let _sendMode = 'send';

function _setSendMode(mode) {
  if (!sendBtn || mode === _sendMode) return;

  _sendMode = mode;

  if (mode === 'cross') {
    sendBtn.innerHTML = SVG_CROSS;
    sendBtn.classList.add('cross-mode');
  } else {
    sendBtn.innerHTML = SVG_SEND;
    sendBtn.classList.remove('cross-mode');
  }
}

/* Non-AI tab clear/cancel only; submission is owned elsewhere */
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
  if (!el || !scrollHost) return;

  if (_scrollRafId !== null) {
    cancelAnimationFrame(_scrollRafId);
    _scrollRafId = null;
  }

  const requestToken = ++_programmaticScrollToken;

  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId = null;

    if (requestToken !== _programmaticScrollToken) return;

    _setScrollOwner('message', true);

    if (tabBar) _tabBarHeight = tabBar.offsetHeight;
    const target = Math.max(0, el.offsetTop - _tabBarHeight - 8);

    if (_prefersReducedMotion) {
      scrollHost.scrollTop = target;
      _lastScrollY = target;
      resetScrollAccum();
      _setScrollOwner('message', false);
      return;
    }

    scrollHost.scrollTo({ top: target, behavior: 'smooth' });
    _lastScrollY = target;
    resetScrollAccum();

    window.setTimeout(() => {
      if (requestToken !== _programmaticScrollToken) return;
      _setScrollOwner('message', false);
      if (scrollHost) _lastScrollY = scrollHost.scrollTop;
      resetScrollAccum();
    }, 450);
  });
}

window.scrollToMsg = scrollToMsg;

/* ════════════════════════════════
CHATBAR / KEYBOARD POSITIONING
════════════════════════════════ */

/* Stop the entrance; keepFade lets the opacity finish when the keyboard takes the transform */
function _cancelChatbarEntrance(keepFade) {
  if (!_chatbarEntranceActive) return;

  _chatbarEntranceActive = false;

  if (_chatbarEntranceAnims) {
    const [move, fade] = _chatbarEntranceAnims;

    move.onfinish = null;
    move.oncancel = null;
    move.cancel();

    if (!keepFade) {
      fade.cancel();
    }

    _chatbarEntranceAnims = null;
  }

  _chatbarTransitionOwner = null;
}

function _setSpacerHeight(h) {
  if (!chatSpacer || !Number.isFinite(h)) return;

  const safeH = Math.max(0, Math.ceil(h));
  const px = safeH + 'px';

  _lastSpacerH = safeH;
  if (chatSpacer.style.height === px) return;

  chatSpacer.style.height = px;
}

/* ── Geometry scheduling: all triggers funnel into one rAF ── */
function _scheduleGeometry(force) {
  if (force === true) _geomForce = true;
  if (_geomRaf) return;

  _geomRaf = requestAnimationFrame(() => {
    _geomRaf = 0;
    const f = _geomForce;
    _geomForce = false;
    _applyViewport(f);
  });
}

function _cancelGeometryRaf() {
  if (_geomRaf) {
    cancelAnimationFrame(_geomRaf);
    _geomRaf = 0;
  }
  _geomForce = false;
  _pendingSampleKey = '';
}

/* ResizeObserver is a trigger only; the bar height is read in the geometry frame */
if (chatbarWrap) {
  const _barResizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => _scheduleGeometry())
    : null;

  if (_barResizeObserver) {
    _barResizeObserver.observe(chatbarWrap);
  }
}

/* ── Chatbar entrance ── */
(function _chatbarEntrance() {
  if (!chatbarWrap || _prefersReducedMotion || typeof chatbarWrap.animate !== 'function') return;

  _chatbarEntranceActive = true;
  _chatbarTransitionOwner = 'entrance';

  /* 'backwards' fill: first keyframe applies immediately, nothing is held after the end */
  const move = chatbarWrap.animate(
    [
      { transform: 'translateY(24px) translateZ(0)' },
      { transform: 'translateY(0) translateZ(0)' }
    ],
    { duration: 450, easing: EASE.chatbarEnter, fill: 'backwards' }
  );

  const fade = chatbarWrap.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: 350, easing: 'ease-out', fill: 'backwards' }
  );

  _chatbarEntranceAnims = [move, fade];

  const finish = () => {
    if (!_chatbarEntranceActive) return;

    _chatbarEntranceActive = false;
    _chatbarEntranceAnims = null;

    if (_chatbarTransitionOwner === 'entrance') {
      _chatbarTransitionOwner = null;
    }
  };

  move.onfinish = finish;
  move.oncancel = finish;
})();

/* Instant: geometry follows VisualViewport frame by frame, never animated */
function _writeChatbarTransform(transform) {
  _cancelKeyboardRestoreRaf();
  _keyboardStyleToken += 1;
  _chatbarTransitionOwner = 'keyboard';

  chatbarWrap.style.transition = 'none';
  chatbarWrap.style.transform = transform;
  _lastChatbarTransform = chatbarWrap.style.transform;
}

/* ── Keyboard / VisualViewport positioning (the only writer of chatbar transform + spacer) ── */
function _applyViewport(force = false) {
  if (!vvp || !chatbarWrap) return;

  /* Read phase */
  const sample = _readViewportSample();
  _barHeight = sample.barH;

  let kbHeight = _measureKeyboardInset(sample);
  const wasOpen = _stableKbH > 0;

  /*
   * A closed → open jump is committed only when two consecutive frames report
   * identical layout + visual viewport geometry, so a half-updated viewport
   * (layout and visual viewport disagreeing mid-transition) is never latched.
   */
  if (!force && !wasOpen && kbHeight > 0) {
    if (_pendingSampleKey === sample.key) {
      _pendingSampleKey = '';
    } else {
      _pendingSampleKey = sample.key;
      _scheduleGeometry();
      kbHeight = 0;
    }
  } else {
    _pendingSampleKey = '';
  }

  /* Write phase */

  /* Closed viewport must not touch the entrance; a real inset takes over */
  if (_chatbarEntranceActive && kbHeight === 0) {
    _stableKbH = 0;
    _keyboardOpen = false;
    _setSpacerHeight(_barHeight);
    return;
  }

  if (!force && kbHeight === _stableKbH) {
    _keyboardOpen = kbHeight > 0;

    if (kbHeight > 0 && chatbarWrap.style.transform !== _lastChatbarTransform) {
      _writeChatbarTransform(_lastChatbarTransform);
    }

    _setSpacerHeight(_barHeight + kbHeight);
    return;
  }

  if (kbHeight > 0 && _chatbarEntranceActive) {
    _cancelChatbarEntrance(true);
  }

  _stableKbH = kbHeight;
  _keyboardOpen = kbHeight > 0;

  _writeChatbarTransform(
    kbHeight > 0
      ? `translateY(-${kbHeight}px) translateZ(0)`
      : 'translateZ(0)'
  );

  if (kbHeight === 0) {
    _scheduleKeyboardTransitionRestore(_keyboardStyleToken);
  }

  _setSpacerHeight(_barHeight + kbHeight);

  if (!wasOpen && kbHeight > 0 && scrollHost) {
    const chatVisible = !chatArea || chatArea.style.display !== 'none';

    if (chatVisible) {
      _setScrollOwner('keyboard', true);
      const anchor = window._lastUserMsgEl;

      scrollHost.scrollTop = anchor
        ? Math.max(0, anchor.offsetTop - 16)
        : scrollHost.scrollHeight;
    }
  }

  cancelAnimationFrame(_cleanupRafId);

  _cleanupRafId = requestAnimationFrame(() => {
    _cleanupRafId = 0;
    if (scrollHost) _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
    _setScrollOwner('keyboard', false);
  });
}

function fixViewport(force = false) {
  if (!vvp || !chatbarWrap) return;

  /* Listeners may pass an Event; only an explicit true forces */
  if (force === true) {
    _cancelGeometryRaf();
    _applyViewport(true);
    return;
  }

  _scheduleGeometry();
}

/* Resume: the viewport is republished a frame after visibility returns */
function _recoverViewportAfterLifecycle() {
  if (!vvp || !chatbarWrap || document.visibilityState === 'hidden') return;

  _cancelGeometryRaf();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (document.visibilityState !== 'hidden') {
        _applyViewport(true);
      }
    });
  });
}

if (vvp) {
  vvp.addEventListener('resize', () => fixViewport(), { passive: true });
  vvp.addEventListener('scroll', () => fixViewport(), { passive: true });

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

/* Window resize complements VisualViewport for orientation/layout changes */
window.addEventListener('resize', () => {
  if (vvp) fixViewport();
}, { passive: true });

window.addEventListener('orientationchange', () => {
  if (vvp) fixViewport();
}, { passive: true });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    _recoverViewportAfterLifecycle();
  }
}, { passive: true });

window.addEventListener('pageshow', _recoverViewportAfterLifecycle, { passive: true });

window.addEventListener('pagehide', () => {
  _cancelGeometryRaf();
  _cancelKeyboardRestoreRaf();

  if (_cleanupRafId) {
    cancelAnimationFrame(_cleanupRafId);
    _cleanupRafId = 0;
    _setScrollOwner('keyboard', false);
  }

  _cancelChatbarEntrance();
}, { passive: true });

/* ════════════════════════════════
THEME / PREFERENCE CHANGE DETECTION
════════════════════════════════ */

/*
 * Theme change: MQ listeners run before rAF callbacks in the same frame, and the
 * geometry read phase forces style + layout, so one scheduled frame already reads
 * post-theme bar height and live viewport values.
 */
if (window.matchMedia) {
  const themeMQ = window.matchMedia('(prefers-color-scheme: dark)');
  const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  const _onThemeChange = () => _scheduleGeometry();

  /* Reduced motion */
  const _onReducedMotionChange = (e) => {
    _prefersReducedMotion = e.matches;

    if (_prefersReducedMotion) {
      _cancelChatbarEntrance();
      _clearContentAnimation();

      if (_plusOpen || (plusMenu && plusMenu.classList.contains('open'))) {
        _capturePlusMenuBaseStyles();

        _plusAnimationToken += 1;
        if (_plusAnimFrame) {
          cancelAnimationFrame(_plusAnimFrame);
          _plusAnimFrame = 0;
        }
        if (_plusCloseFallbackTimer) {
          clearTimeout(_plusCloseFallbackTimer);
          _plusCloseFallbackTimer = 0;
        }
        _removePlusTransitionListener();

        if (_plusOpen) {
          plusMenu.style.transition = 'none';
          plusMenu.style.transform = '';
          plusMenu.style.opacity = '';
          plusMenu.classList.add('open');
          plusBackdrop?.classList.add('open');
        } else {
          _finishPlusClose(_plusAnimationToken);
        }
      }
    }

    _scheduleGeometry(true);
  };

  if (themeMQ.addEventListener) {
    themeMQ.addEventListener('change', _onThemeChange);
  } else if (themeMQ.addListener) {
    themeMQ.addListener(_onThemeChange);
  }

  if (reducedMotionMQ.addEventListener) {
    reducedMotionMQ.addEventListener('change', _onReducedMotionChange);
  } else if (reducedMotionMQ.addListener) {
    reducedMotionMQ.addListener(_onReducedMotionChange);
  }
}

/* ════════════════════════════════
HEADER / TAB SCROLL ANIMATION
════════════════════════════════ */

const HIDE_ACCUM = 40;
const SHOW_ACCUM = 55;
const LOGO_THRESH = 10;

function updateHeader(now) {
  _rafPending = false;

  if (!scrollHost || !logoHeader || !tabBar) return;

  if (_programmaticScroll) {
    _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
    return;
  }

  const sy = scrollHost.scrollTop;
  const delta = sy - _lastScrollY;

  if (delta === 0) return;

  now = now || performance.now();
  /* First sample after a reset has no previous timestamp */
  const dt = _lastScrollTime ? Math.max(1, now - _lastScrollTime) : 16;

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

const _scheduleHeaderUpdate = typeof window.requestPostAnimationFrame === 'function'
  ? window.requestPostAnimationFrame.bind(window)
  : window.requestAnimationFrame.bind(window);

if (scrollHost) {
  scrollHost.addEventListener('scroll', () => {
    if (_programmaticScroll) {
      _lastScrollY = scrollHost.scrollTop;
      return;
    }

    if (!_rafPending) {
      _rafPending = true;
      _scheduleHeaderUpdate(updateHeader);
    }
  }, { passive: true });
}

/* ════════════════════════════════
INPUT & PILL
════════════════════════════════ */

if (pill && input) {
  pill.addEventListener('pointerdown', (e) => {
    const target = e.target instanceof Element ? e.target : null;

    /* Plus button has its own click handler */
    if (plusBtn && target && (target === plusBtn || plusBtn.contains(target))) {
      return;
    }

    if (
      target &&
      target !== pill &&
      target !== input &&
      !target.closest('button, .overlay-input-wrap')
    ) {
      return;
    }

    if (document.activeElement === input || _keyboardOpen) return;

    e.preventDefault();

    requestAnimationFrame(() => {
      if (input && document.activeElement !== input) {
        input.focus({ preventScroll: true });
      }
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

function _capturePlusMenuBaseStyles() {
  if (!plusMenu || _plusMenuBaseStyles) return;

  _plusMenuBaseStyles = {
    transition: plusMenu.style.transition,
    transform: plusMenu.style.transform,
    opacity: plusMenu.style.opacity
  };
}

/* Restore base styles */
function _restorePlusMenuBaseStyles() {
  if (!plusMenu || !_plusMenuBaseStyles) return;

  plusMenu.style.transition = _plusMenuBaseStyles.transition;
  plusMenu.style.transform = _plusMenuBaseStyles.transform;
  plusMenu.style.opacity = _plusMenuBaseStyles.opacity;
  _plusMenuBaseStyles = null;
}

function _removePlusTransitionListener() {
  if (!plusMenu || !_plusTransitionEndHandler) return;
  plusMenu.removeEventListener('transitionend', _plusTransitionEndHandler);
  _plusTransitionEndHandler = null;
}

function _cancelPlusAnimation() {
  _plusAnimationToken += 1;

  if (_plusAnimFrame) {
    cancelAnimationFrame(_plusAnimFrame);
    _plusAnimFrame = 0;
  }

  if (_plusCloseFallbackTimer) {
    clearTimeout(_plusCloseFallbackTimer);
    _plusCloseFallbackTimer = 0;
  }

  _removePlusTransitionListener();
}

function _finishPlusOpen(token) {
  if (!plusMenu || token !== _plusAnimationToken || !_plusOpen) return;

  _removePlusTransitionListener();
  plusMenu.style.transition = '';
  plusMenu.style.transform = '';
  plusMenu.style.opacity = '';
}

function _finishPlusClose(token) {
  if (!plusMenu || token !== _plusAnimationToken || _plusOpen) return;

  _removePlusTransitionListener();

  if (_plusCloseFallbackTimer) {
    clearTimeout(_plusCloseFallbackTimer);
    _plusCloseFallbackTimer = 0;
  }

  plusMenu.classList.remove('open');
  plusBackdrop?.classList.remove('open');
  _restorePlusMenuBaseStyles();
}

function openPlusMenu() {
  if (!plusBtn || !plusMenu || !plusBackdrop) return;
  if (_plusOpen) return;

  _capturePlusMenuBaseStyles();
  _cancelPlusAnimation();

  const token = _plusAnimationToken;

  _plusOpen = true;
  plusBackdrop.classList.add('open');

  plusMenu.classList.add('open');

  if (_prefersReducedMotion) {
    plusMenu.style.transition = '';
    plusMenu.style.transform = '';
    plusMenu.style.opacity = '';
    return;
  }

  plusMenu.style.transition = 'none';
  plusMenu.style.transform = 'scale(0.88) translateY(10px)';
  plusMenu.style.opacity = '0';

  /* Two frames: the start state must be rendered before the transition is armed */
  _plusAnimFrame = requestAnimationFrame(() => {
    _plusAnimFrame = requestAnimationFrame(() => {
      _plusAnimFrame = 0;

      if (token !== _plusAnimationToken || !_plusOpen) return;

      plusMenu.style.transition =
        `transform 0.3s ${EASE.menuOpen}, opacity 0.2s ease-out`;
      plusMenu.style.transform = 'scale(1) translateY(0)';
      plusMenu.style.opacity = '1';

      /* Transform is the longest transition; finish on it */
      const onOpen = (e) => {
        if (
          e.target !== plusMenu ||
          e.propertyName !== 'transform' ||
          token !== _plusAnimationToken
        ) {
          return;
        }

        _finishPlusOpen(token);
      };

      _plusTransitionEndHandler = onOpen;
      plusMenu.addEventListener('transitionend', onOpen);
    });
  });
}

function closePlusMenu() {
  if (!_plusOpen || !plusMenu || !plusBackdrop) return;

  _cancelPlusAnimation();

  _plusOpen = false;
  plusBackdrop.classList.remove('open');

  const token = _plusAnimationToken;

  if (_prefersReducedMotion) {
    _finishPlusClose(token);
    return;
  }

  plusMenu.style.transition =
    `transform 0.22s ${EASE.menuClose}, opacity 0.18s ease-in`;
  plusMenu.style.transform = 'scale(0.88) translateY(10px)';
  plusMenu.style.opacity = '0';

  const onClose = (e) => {
    if (
      e.target !== plusMenu ||
      e.propertyName !== 'transform' ||
      token !== _plusAnimationToken ||
      _plusOpen
    ) {
      return;
    }

    _finishPlusClose(token);
  };

  _plusTransitionEndHandler = onClose;
  plusMenu.addEventListener('transitionend', onClose);

  /* Fallback if transitionend never fires */
  _plusCloseFallbackTimer = window.setTimeout(() => {
    _plusCloseFallbackTimer = 0;

    if (token !== _plusAnimationToken || _plusOpen) return;
    _finishPlusClose(token);
  }, 320);
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

/* Outside tap */
if (plusMenu || plusBtn) {
  document.addEventListener('click', (e) => {
    if (!_plusOpen) return;

    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    if (
      plusMenu?.contains(target) ||
      plusBtn?.contains(target)
    ) {
      return;
    }

    closePlusMenu();
  });
}

/* Escape */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _plusOpen) {
    closePlusMenu();
  }
});

['pmPhoto', 'pmCamera', 'pmFile', 'pmLocation'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', closePlusMenu);
});

/* ════════════════════════════════
TAB BAR — race-safe content swap
════════════════════════════════ */

async function _loadTab(key, requestId = null) {
  if (!pageContent) return;

  /* Public calls keep the historical behavior; internal calls also require the tab to stay selected */
  const internalRequest = requestId !== null;
  if (requestId === null) {
    requestId = _nextTabLoadRequestId();
  }

  const isActiveRequest = () =>
    requestId === _tabLoadRequestId &&
    (!internalRequest || _currentTabKey === key);

  if (key === 'ai') {
    if (!isActiveRequest()) return;

    if (chatArea) chatArea.style.display = '';
    pageContent.style.display = 'none';
    return;
  }

  if (!isActiveRequest()) return;

  if (chatArea) chatArea.style.display = 'none';
  pageContent.style.display = '';

  if (_moduleCache[key]) {
    const initFn = window['_atkynInit_' + key];
    if (typeof initFn === 'function' && isActiveRequest()) {
      initFn();
    }
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

    if (!_moduleLoadPromises[key]) {
      _moduleLoadPromises[key] = _loadScript(`modules/${key}/${key}.js`)
        .then(() => {
          _moduleCache[key] = true;
          return true;
        })
        .catch((error) => {
          delete _moduleLoadPromises[key];
          throw error;
        });
    }

    await _moduleLoadPromises[key];

    if (!_isCurrentTabRequest(key, requestId)) return;
  } catch (_) {
    if (_isCurrentTabRequest(key, requestId)) {
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
  if (_scriptLoadPromises[src]) return _scriptLoadPromises[src];

  _scriptLoadPromises[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;

    const cleanup = () => {
      s.onload = null;
      s.onerror = null;
    };

    s.onload = () => {
      cleanup();
      resolve();
    };

    s.onerror = (error) => {
      cleanup();
      delete _scriptLoadPromises[src];
      if (s.parentNode) s.parentNode.removeChild(s);
      reject(error);
    };

    document.head.appendChild(s);
  });

  return _scriptLoadPromises[src];
}

/* ── Content transition ── */
function _clearContentAnimation() {
  if (!_contentAnimations.length) return;

  _contentAnimations.forEach((anim) => anim.cancel());
  _contentAnimations = [];
}

function _animateContentIn() {
  if (!pageContent) return;

  _clearContentAnimation();

  if (_prefersReducedMotion || typeof pageContent.animate !== 'function') return;

  /* 'backwards' fill: start state applies immediately, nothing is held after the end */
  _contentAnimations = [
    pageContent.animate(
      [{ transform: 'translateY(8px)' }, { transform: 'translateY(0)' }],
      { duration: 280, easing: EASE.contentSwap, fill: 'backwards' }
    ),
    pageContent.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 220, easing: 'ease-out', fill: 'backwards' }
    )
  ];
}

let _activeTabEl = tabBar ? tabBar.querySelector('.tab.active') : null;

if (tabBar) {
  tabBar.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const tab = target ? target.closest('.tab') : null;

    if (!tab || tab.classList.contains('active')) return;

    const key = tab.getAttribute('data-tab');
    if (!key) return;

    const requestId = _nextTabLoadRequestId();

    if (_currentTabKey === 'ai' && _msgWrap) {
      try {
        sessionStorage.setItem('atkyn_chat_html', _msgWrap.innerHTML);
        sessionStorage.setItem(
          'atkyn_chat_scroll',
          String(scrollHost ? scrollHost.scrollTop : 0)
        );
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
        if (pill) pill.classList.remove('has-text');
        _setSendMode('send');
      }
    }

    /* Instant scroll reset; smooth scrolling here would queue bouncing animations */
    if (scrollHost) {
      ++_programmaticScrollToken;
      _scrollOwners.message = false;
      _setScrollOwner('tab', true);
      scrollHost.scrollTop = 0;
      _lastScrollY = 0;
      resetScrollAccum();

      requestAnimationFrame(() => {
        _setScrollOwner('tab', false);
        if (scrollHost) _lastScrollY = scrollHost.scrollTop;
      });
    }

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

    await _loadTab(key, requestId);

    if (!_isCurrentTabRequest(key, requestId)) return;

    if (key === 'ai') {
      _clearContentAnimation();
    } else {
      _animateContentIn();
    }
  }, { passive: true });
}

/* ── Public API ── */
window._atkynModuleCache = _moduleCache;
window._atkynPageContent = pageContent;
window._atkynAnimateIn = _animateContentIn;
window._atkynLoadTab = _loadTab;
