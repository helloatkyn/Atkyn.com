/* ═══════════════════════════════════════════════════════════════════
core.js — Atkyn shared UI logic [PRODUCTION · NATIVE-SMOOTH v6]
scroll · header animation · keyboard positioning · theme refresh
chatbar entrance · plus menu · tab navigation
════════════════════════════════════════════════════════════════════ */

/* ── Reduced-motion flag ── */
let _prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
const _tabBarHeight = tabBar ? tabBar.offsetHeight : 0;
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

/* ── Velocity EMA ── */
let _velocityEMA = 0;
let _lastScrollTime = 0;
const VELOCITY_ALPHA = 0.3;

/* ── Keyboard / viewport state ── */
let _cleanupRafId = 0;
let _stableKbH = 0;
let _vvpDebounce = 0;
let _barHeight = chatbarWrap ? chatbarWrap.offsetHeight : 0;
let _lastChatbarTransform = '';
let _keyboardStyleRestoreRaf = 0;
let _keyboardStyleToken = 0;
let _resizeObserverRaf = 0;

/* ── Chatbar transition ownership ── */
let _chatbarTransitionOwner = null;
let _chatbarEntranceActive = false;
let _chatbarEntranceRaf = 0;
let _chatbarEntranceFallbackTimer = 0;
let _chatbarEntranceCleanup = null;
let _chatbarEntranceBaseStyles = null;

/* ── Spacer guard ── */
let _lastSpacerH = -1;

/* ── Theme refresh scheduling ── */
let _themeRefreshRaf = 0;
let _themeRefreshToken = 0;

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

/* Keep the scroll state self-consistent whenever ownership changes. */
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
 * The layout viewport and visual viewport are different coordinate spaces.
 * `offsetTop` places the visual viewport inside the layout viewport, so
 * `offsetTop + height` is the visual-viewport bottom in layout-viewport
 * coordinates.  `documentElement.clientHeight` is the layout-viewport
 * height and is preferred over window.innerHeight because innerHeight can
 * remain stale in some mobile/WebView configurations.
 *
 * With interactive-widget=resizes-content, the layout viewport itself is
 * reduced by the IME, so the two bottoms converge and this returns ~0.
 * Where the browser only resizes the visual viewport, the difference is
 * the portion of the layout viewport hidden by the keyboard.
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

function _measureKeyboardInset() {
  if (!vvp || !chatbarWrap) return 0;

  const layoutHeight = _getLayoutViewportHeight();
  if (!(layoutHeight > 0)) return 0;

  const vvHeight = Number(vvp.height);
  const vvOffsetTop = Number(vvp.offsetTop);
  if (!Number.isFinite(vvHeight) || !Number.isFinite(vvOffsetTop) || vvHeight < 0) {
    return 0;
  }

  const visualBottom = Math.max(0, vvOffsetTop) + vvHeight;
  const rawInset = Math.max(0, layoutHeight - visualBottom);

  /*
   * When closed, require a meaningful geometry delta before declaring an
   * IME inset.  This prevents ordinary browser-UI movement from being
   * promoted to keyboard state. Once the keyboard is already considered
   * open, keep tracking every positive pixel until the geometry reaches 0;
   * this prevents the final keyboard-closing frames from clipping the pill.
   */
  if (_stableKbH <= 0) {
    if (!_hasRelevantKeyboardFocus() || rawInset <= 50) return 0;
  } else if (rawInset <= 0.5) {
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

/*
 * Keep this listener intentionally narrow. Message/search submission is
 * owned by the existing send/search subsystem; this only handles the
 * non-AI tab clear/cancel state already provided by core.js.
 */
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

    _programmaticScroll = true;

    const target = Math.max(0, el.offsetTop - _tabBarHeight - 8);

    if (_prefersReducedMotion) {
      scrollHost.scrollTop = target;
      _lastScrollY = target;
      resetScrollAccum();
      _programmaticScroll = false;
      return;
    }

    scrollHost.scrollTo({ top: target, behavior: 'smooth' });
    _lastScrollY = target;
    resetScrollAccum();

    window.setTimeout(() => {
      if (requestToken !== _programmaticScrollToken) return;
      _programmaticScroll = false;
      if (scrollHost) _lastScrollY = scrollHost.scrollTop;
      resetScrollAccum();
    }, 450);
  });
}

window.scrollToMsg = scrollToMsg;

/* ════════════════════════════════
CHATBAR / KEYBOARD POSITIONING
════════════════════════════════ */

/* Cancel only the entrance animation; never wipe styles owned elsewhere. */
function _cancelChatbarEntrance() {
  if (!_chatbarEntranceActive) return;

  _chatbarEntranceActive = false;

  if (_chatbarEntranceRaf) {
    cancelAnimationFrame(_chatbarEntranceRaf);
    _chatbarEntranceRaf = 0;
  }

  if (_chatbarEntranceFallbackTimer) {
    clearTimeout(_chatbarEntranceFallbackTimer);
    _chatbarEntranceFallbackTimer = 0;
  }

  if (_chatbarEntranceCleanup) {
    _chatbarEntranceCleanup();
    _chatbarEntranceCleanup = null;
  }

  _chatbarTransitionOwner = null;

  if (chatbarWrap && _chatbarEntranceBaseStyles) {
    chatbarWrap.style.willChange = _chatbarEntranceBaseStyles.willChange;
    chatbarWrap.style.transition = _chatbarEntranceBaseStyles.transition;
    chatbarWrap.style.transform = _chatbarEntranceBaseStyles.transform;
    chatbarWrap.style.opacity = _chatbarEntranceBaseStyles.opacity;
  }

  _chatbarEntranceBaseStyles = null;
}

function _setSpacerHeight(h) {
  if (!chatSpacer || !Number.isFinite(h)) return;

  const safeH = Math.max(0, Math.ceil(h));
  if (safeH === _lastSpacerH) return;

  _lastSpacerH = safeH;
  chatSpacer.style.height = safeH + 'px';
}

if (chatbarWrap) {
  const _barResizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;

      const borderBoxSize = entry.borderBoxSize;
      const measuredH = borderBoxSize
        ? (borderBoxSize[0] ? borderBoxSize[0].blockSize : borderBoxSize.blockSize)
        : entry.contentRect.height;

      if (!Number.isFinite(measuredH)) return;

      /*
       * Measure here, but defer the spacer write to the next frame.  The
       * observer must never synchronously write layout in the same delivery
       * phase that produced the measurement; doing so can create feedback
       * loops when the wrapper participates in the same layout tree.
       */
      _barHeight = Math.max(0, Math.ceil(measuredH));

      if (_resizeObserverRaf) return;

      _resizeObserverRaf = requestAnimationFrame(() => {
        _resizeObserverRaf = 0;
        _setSpacerHeight(_barHeight + _stableKbH);
      });
    })
    : null;

  if (_barResizeObserver) {
    _barResizeObserver.observe(chatbarWrap);
  }
}

/* ── Chatbar entrance animation ── */
(function _chatbarEntrance() {
  if (!chatbarWrap || _prefersReducedMotion) return;

  _chatbarEntranceActive = true;
  _chatbarTransitionOwner = 'entrance';

  _chatbarEntranceBaseStyles = {
    willChange: chatbarWrap.style.willChange,
    transition: chatbarWrap.style.transition,
    transform: chatbarWrap.style.transform,
    opacity: chatbarWrap.style.opacity
  };

  chatbarWrap.style.willChange = 'transform,opacity';
  chatbarWrap.style.transition = 'none';
  chatbarWrap.style.transform = 'translateY(24px) translateZ(0)';
  chatbarWrap.style.opacity = '0';

  const finish = () => {
    if (!_chatbarEntranceActive) return;

    _chatbarEntranceActive = false;
    _chatbarEntranceRaf = 0;

    if (_chatbarEntranceFallbackTimer) {
      clearTimeout(_chatbarEntranceFallbackTimer);
      _chatbarEntranceFallbackTimer = 0;
    }

    if (_chatbarEntranceCleanup) {
      _chatbarEntranceCleanup();
      _chatbarEntranceCleanup = null;
    }

    /*
     * Keyboard/viewport updates take ownership of transform + transition.
     * Never clear those styles from the entrance completion path.
     */
    if (_chatbarTransitionOwner === 'entrance' && !_keyboardOpen) {
      chatbarWrap.style.willChange = _chatbarEntranceBaseStyles?.willChange || '';
      chatbarWrap.style.transition = _chatbarEntranceBaseStyles?.transition || '';
      chatbarWrap.style.transform = _chatbarEntranceBaseStyles?.transform || '';
      chatbarWrap.style.opacity = _chatbarEntranceBaseStyles?.opacity || '';
      _chatbarTransitionOwner = null;
      _lastChatbarTransform = '';
    } else {
      chatbarWrap.style.willChange = _chatbarEntranceBaseStyles?.willChange || '';
      chatbarWrap.style.opacity = _chatbarEntranceBaseStyles?.opacity || '';
    }

    _chatbarEntranceBaseStyles = null;
  };

  let ended = false;
  const onTransitionEnd = (e) => {
    if (e.target !== chatbarWrap || e.propertyName !== 'transform' || ended) return;
    ended = true;
    finish();
  };

  const onTransitionCancel = (e) => {
    if (e.target !== chatbarWrap || e.propertyName !== 'transform' || ended) return;
    ended = true;
    finish();
  };

  chatbarWrap.addEventListener('transitionend', onTransitionEnd);
  chatbarWrap.addEventListener('transitioncancel', onTransitionCancel);
  _chatbarEntranceCleanup = () => {
    chatbarWrap.removeEventListener('transitionend', onTransitionEnd);
    chatbarWrap.removeEventListener('transitioncancel', onTransitionCancel);
  };

  _chatbarEntranceRaf = requestAnimationFrame(() => {
    _chatbarEntranceRaf = 0;

    if (!_chatbarEntranceActive) return;

    chatbarWrap.style.transition =
      `transform 0.45s ${EASE.chatbarEnter}, opacity 0.35s ease-out`;
    chatbarWrap.style.transform = 'translateY(0) translateZ(0)';
    chatbarWrap.style.opacity = '1';
  });

  /*
   * transitionend is the primary completion signal. A conservative fallback
   * handles environments where a transform transition is interrupted early.
   */
  _chatbarEntranceFallbackTimer = window.setTimeout(() => {
    _chatbarEntranceFallbackTimer = 0;
    if (_chatbarEntranceActive && !_keyboardOpen && ended === false) {
      finish();
    }
  }, 500);
})();

/* ── Keyboard / VisualViewport positioning ── */
function _applyViewport(force = false) {
  if (!vvp || !chatbarWrap) return;

  const kbHeight = _measureKeyboardInset();
  const wasOpen = _stableKbH > 0;

  /*
   * During the initial/normal entrance animation, a closed viewport must not
   * steal transform ownership from the entrance system.  A real keyboard
   * inset is different: it immediately becomes the authoritative owner.
   */
  if (_chatbarEntranceActive && kbHeight === 0) {
    _stableKbH = 0;
    _keyboardOpen = false;
    _setSpacerHeight(_barHeight);
    return;
  }

  if (!force && kbHeight === _stableKbH) {
    _keyboardOpen = kbHeight > 0;
    _setSpacerHeight(_barHeight + kbHeight);
    return;
  }

  if (kbHeight > 0 && _chatbarEntranceActive) {
    _cancelChatbarEntrance();
  }

  _stableKbH = kbHeight;
  _keyboardOpen = kbHeight > 0;

  const transform = kbHeight > 0
    ? `translateY(-${kbHeight}px) translateZ(0)`
    : 'translateZ(0)';

  if (force || transform !== _lastChatbarTransform || wasOpen !== _keyboardOpen) {
    _cancelKeyboardRestoreRaf();
    _keyboardStyleToken += 1;
    _chatbarTransitionOwner = 'keyboard';

    /*
     * VisualViewport can report many intermediate values while the OSK is
     * moving.  A CSS transition here would animate toward obsolete values
     * and visibly lag behind the physical keyboard.  Geometry tracking must
     * therefore be instantaneous; the OSK supplies the native motion itself.
     */
    chatbarWrap.style.transition = 'none';
    chatbarWrap.style.transform = transform;
    _lastChatbarTransform = transform;

    if (kbHeight === 0) {
      _scheduleKeyboardTransitionRestore(_keyboardStyleToken);
    }
  }

  _setSpacerHeight(_barHeight + kbHeight);

  if (!wasOpen && kbHeight > 0 && scrollHost) {
    const chatVisible = !chatArea || chatArea.style.display !== 'none';

    if (chatVisible) {
      _programmaticScroll = true;
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
    _programmaticScroll = false;
  });
}

function fixViewport(force = false) {
  if (!vvp || !chatbarWrap) return;

  if (_vvpDebounce) {
    if (force) {
      cancelAnimationFrame(_vvpDebounce);
      _vvpDebounce = 0;
    } else {
      return;
    }
  }

  if (force) {
    _applyViewport(true);
    return;
  }

  _vvpDebounce = requestAnimationFrame(() => {
    _vvpDebounce = 0;
    _applyViewport(false);
  });
}

function _recoverViewportAfterLifecycle() {
  if (!vvp || !chatbarWrap || document.visibilityState === 'hidden') return;

  if (_vvpDebounce) {
    cancelAnimationFrame(_vvpDebounce);
    _vvpDebounce = 0;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (document.visibilityState !== 'hidden') {
        _applyViewport(true);
      }
    });
  });
}

if (vvp) {
  vvp.addEventListener('resize', fixViewport, { passive: true });
  vvp.addEventListener('scroll', fixViewport, { passive: true });

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

/* Window resize complements VisualViewport events for orientation/layout changes. */
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
  if (_vvpDebounce) {
    cancelAnimationFrame(_vvpDebounce);
    _vvpDebounce = 0;
  }

  if (_keyboardStyleRestoreRaf) {
    cancelAnimationFrame(_keyboardStyleRestoreRaf);
    _keyboardStyleRestoreRaf = 0;
  }

  if (_themeRefreshRaf) {
    cancelAnimationFrame(_themeRefreshRaf);
    _themeRefreshRaf = 0;
  }
  _themeRefreshToken += 1;

  if (_cleanupRafId) {
    cancelAnimationFrame(_cleanupRafId);
    _cleanupRafId = 0;
  }

  if (_chatbarEntranceActive) {
    _cancelChatbarEntrance();
  } else if (_chatbarEntranceFallbackTimer) {
    clearTimeout(_chatbarEntranceFallbackTimer);
    _chatbarEntranceFallbackTimer = 0;
  }

  if (_resizeObserverRaf) {
    cancelAnimationFrame(_resizeObserverRaf);
    _resizeObserverRaf = 0;
  }
}, { passive: true });

/* ════════════════════════════════
THEME / PREFERENCE CHANGE DETECTION
════════════════════════════════ */

/*
 * Theme CSS remains owned by the existing theme system. core.js only
 * refreshes viewport-owned geometry after a system color-scheme change.
 * Geometry is never frozen: VisualViewport events remain authoritative even
 * while the browser is repainting the new theme.
 */
if (window.matchMedia) {
  const themeMQ = window.matchMedia('(prefers-color-scheme: dark)');
  const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  const _onThemeChange = () => {
    const token = ++_themeRefreshToken;

    if (_themeRefreshRaf) {
      cancelAnimationFrame(_themeRefreshRaf);
      _themeRefreshRaf = 0;
    }

    /*
     * Do not snapshot or replay keyboard geometry.  The latest viewport
     * measurement is the only authoritative state after the theme repaint.
     */
    _themeRefreshRaf = requestAnimationFrame(() => {
      _themeRefreshRaf = requestAnimationFrame(() => {
        _themeRefreshRaf = 0;

        if (token !== _themeRefreshToken) return;
        if (chatbarWrap) {
          const measured = chatbarWrap.getBoundingClientRect().height;
          if (Number.isFinite(measured) && measured > 0) {
            _barHeight = Math.max(0, Math.ceil(measured));
          } else {
            _barHeight = chatbarWrap.offsetHeight;
          }
        }

        _setSpacerHeight(_barHeight + _stableKbH);
        _applyViewport(true);
      });
    });
  };

  const _onReducedMotionChange = (e) => {
    _prefersReducedMotion = e.matches;

    if (_prefersReducedMotion) {
      /* Entrance animation is visual-only and must stop immediately. */
      _cancelChatbarEntrance();

      if (_plusOpen || (plusMenu && plusMenu.classList.contains('open'))) {
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

    _applyViewport(true);
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

    /* Plus button has its own click handler — never let it trigger input focus. */
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

let _plusAnimationToken = 0;
let _plusAnimFrame = 0;
let _plusCloseFallbackTimer = 0;
let _plusTransitionEndHandler = null;
let _plusMenuBaseStyles = null;

function _capturePlusMenuBaseStyles() {
  if (!plusMenu || _plusMenuBaseStyles) return;

  /* bottom is CSS-owned — not captured, not restored inline. */
  _plusMenuBaseStyles = {
    transition: plusMenu.style.transition,
    transform: plusMenu.style.transform,
    opacity: plusMenu.style.opacity
  };
}

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

  /*
   * Menu position is CSS-owned — no inline bottom override needed.
   * No getBoundingClientRect (avoids forced reflow on the composited layer).
   * No input.blur() — keyboard state is independent of menu state.
   */
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

  _plusAnimFrame = requestAnimationFrame(() => {
    _plusAnimFrame = 0;

    if (token !== _plusAnimationToken || !_plusOpen) return;

    plusMenu.style.transition =
      `transform 0.3s ${EASE.menuOpen}, opacity 0.2s ease-out`;
    plusMenu.style.transform = 'scale(1) translateY(0)';
    plusMenu.style.opacity = '1';

    const onOpen = (e) => {
      if (
        e.target !== plusMenu ||
        e.propertyName !== 'opacity' ||
        token !== _plusAnimationToken
      ) {
        return;
      }

      _finishPlusOpen(token);
    };

    _plusTransitionEndHandler = onOpen;
    plusMenu.addEventListener('transitionend', onOpen);
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
      e.propertyName !== 'opacity' ||
      token !== _plusAnimationToken ||
      _plusOpen
    ) {
      return;
    }

    _finishPlusClose(token);
  };

  _plusTransitionEndHandler = onClose;
  plusMenu.addEventListener('transitionend', onClose);

  /*
   * transitionend is normally deterministic, but a detached/hidden element
   * can skip it. Never leave an invisible sheet in the hit-test tree.
   */
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

/* Reliable outside tap without interfering with the plus button itself. */
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

/* Escape closes the sheet, matching the expected mobile overlay behavior. */
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

  /*
   * A direct/public _atkynLoadTab(key) call keeps the historical behavior:
   * it may load/show the requested tab even before _currentTabKey is changed.
   * Internal tab-click requests additionally require that tab to remain selected.
   */
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
      reject(error);
    };

    document.head.appendChild(s);
  });

  return _scriptLoadPromises[src];
}

let _contentAnimationRaf = 0;
let _contentAnimationEnd = null;
let _contentAnimationBaseStyles = null;

function _clearContentAnimation() {
  if (!pageContent) return;

  if (_contentAnimationRaf) {
    cancelAnimationFrame(_contentAnimationRaf);
    _contentAnimationRaf = 0;
  }

  if (_contentAnimationEnd) {
    pageContent.removeEventListener('transitionend', _contentAnimationEnd);
    _contentAnimationEnd = null;
  }

  if (_contentAnimationBaseStyles) {
    pageContent.style.opacity = _contentAnimationBaseStyles.opacity;
    pageContent.style.transform = _contentAnimationBaseStyles.transform;
    pageContent.style.transition = _contentAnimationBaseStyles.transition;
    _contentAnimationBaseStyles = null;
  }
}

function _animateContentIn() {
  if (!pageContent) return;

  _clearContentAnimation();

  if (_prefersReducedMotion) return;

  _contentAnimationBaseStyles = {
    opacity: pageContent.style.opacity,
    transform: pageContent.style.transform,
    transition: pageContent.style.transition
  };

  pageContent.style.opacity = '0';
  pageContent.style.transform = 'translateY(8px)';
  pageContent.style.transition = 'none';

  _contentAnimationRaf = requestAnimationFrame(() => {
    _contentAnimationRaf = 0;

    pageContent.style.transition =
      `opacity 0.22s ease-out, transform 0.28s ${EASE.contentSwap}`;
    pageContent.style.opacity = '1';
    pageContent.style.transform = 'translateY(0)';

    const onEnd = (e) => {
      if (e.target !== pageContent || e.propertyName !== 'opacity') return;

      if (_contentAnimationEnd === onEnd) {
        pageContent.removeEventListener('transitionend', onEnd);
        _contentAnimationEnd = null;

        if (_contentAnimationBaseStyles) {
          pageContent.style.opacity = _contentAnimationBaseStyles.opacity;
          pageContent.style.transform = _contentAnimationBaseStyles.transform;
          pageContent.style.transition = _contentAnimationBaseStyles.transition;
          _contentAnimationBaseStyles = null;
        }
      }
    };

    _contentAnimationEnd = onEnd;
    pageContent.addEventListener('transitionend', onEnd);
  });
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

    /*
     * Mode switching is an instant state change. Smooth scrolling here can
     * queue browser scroll animations and make the header/chatbar appear to
     * bounce during rapid tab changes.
     */
    if (scrollHost) {
      ++_programmaticScrollToken;
      _programmaticScroll = true;
      scrollHost.scrollTop = 0;
      _lastScrollY = 0;
      resetScrollAccum();

      requestAnimationFrame(() => {
        if (requestId !== _tabLoadRequestId) return;
        _programmaticScroll = false;
        _lastScrollY = scrollHost.scrollTop;
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

    _animateContentIn();
  }, { passive: true });
}

/* ── Public API ── */
window._atkynModuleCache = _moduleCache;
window._atkynPageContent = pageContent;
window._atkynAnimateIn = _animateContentIn;
window._atkynLoadTab = _loadTab;
