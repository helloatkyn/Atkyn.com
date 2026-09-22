/* ═══════════════════════════════════════════════════════════════════
   core.js — Atkyn shared UI logic [PRODUCTION · RE-ENGINEERED v7]
   scroll · header animation · keyboard positioning · theme refresh
   chatbar entrance · plus menu · tab navigation
   ════════════════════════════════════════════════════════════════════

   KEY CHANGES FROM v6
   ───────────────────
   • Single-owner keyboard state machine — no competing transform writers.
   • _chatbarTransitionOwner / _chatbarKeyboardTransitionToken /
     _chatbarKeyboardTransitionCleanup / _chatbarEntranceActive /
     _chatbarEntranceRaf / _chatbarEntranceCleanup /
     _chatbarEntranceBaseStyles all removed; one update path.
   • _themeFreezeUntil removed — theme changes no longer block viewport.
   • _themeRefreshRaf replaced by normal fixViewport() call.
   • getViewportState() is the one authoritative source of keyboard geometry.
   • _applyViewport() is the one authoritative chatbar-transform writer.
   • fixViewport() gates duplicate RAF scheduling with one boolean flag.
   • Plus-menu easing changed to non-overshooting curve.
   • `will-change: transform` applied only during active keyboard animation.
   • ResizeObserver no longer gated on _themeFreezeUntil.
   • prefers-reduced-motion: transition removed instantly, no stale styles.
═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ── Reduced-motion flag ── */
let _prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Easing constants ── */
const EASE = {
  keyboardMove : 'cubic-bezier(0.32, 0.72, 0, 1)',
  headerHide   : 'cubic-bezier(0.4, 0, 1, 1)',
  headerShow   : 'cubic-bezier(0, 0, 0.2, 1)',
  chatbarEnter : 'cubic-bezier(0.16, 1, 0.3, 1)',
  menuOpen     : 'cubic-bezier(0.32, 0.72, 0, 1)',   // was overshooting — fixed
  menuClose    : 'cubic-bezier(0.4, 0, 1, 1)',
  contentSwap  : 'cubic-bezier(0.16, 1, 0.3, 1)'
};

/* ── Stable DOM references ── */
const scrollHost    = document.getElementById('scrollHost');
const logoHeader    = document.querySelector('.logo-header');
const tabBar        = document.getElementById('tabBar');
const chatbarWrap   = document.querySelector('.chatbar-wrap');
const plusBtn       = document.getElementById('plusBtn');
const plusMenu      = document.getElementById('plusMenu');
const plusBackdrop  = document.getElementById('plusBackdrop');
const pill          = document.getElementById('pill');
const input         = document.getElementById('cbInput');
const sendBtn       = document.getElementById('sendBtn');
const pageContent   = document.getElementById('pageContent');
const chatArea      = document.getElementById('chatArea');
const _msgWrap      = document.getElementById('msgWrap');
const chatSpacer    = document.getElementById('chatSpacer');

/* ── Visual Viewport reference ── */
const vvp = window.visualViewport;

/* ── Cached layout metrics ── */
const _tabBarHeight = tabBar ? tabBar.offsetHeight : 0;

/* ── SVG constants ── */
const SVG_SEND  = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="5 11 12 4 19 11"/></svg>';
const SVG_CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/* ════════════════════════════════
   SCROLL / HEADER STATE
════════════════════════════════ */

let _rafPending            = false;
let _lastScrollY           = 0;
let _accumDown             = 0;
let _accumUp               = 0;
let _isLogoCollapsed       = false;
let _isTabHidden           = false;
let _isTabScrolled         = false;
let _scrollRafId           = null;
let _programmaticScroll    = false;
let _programmaticScrollToken = 0;
let _plusOpen              = false;
let _velocityEMA           = 0;
let _lastScrollTime        = 0;

const VELOCITY_ALPHA = 0.3;

function resetScrollAccum() {
  _accumDown   = 0;
  _accumUp     = 0;
  _velocityEMA = 0;
  _lastScrollTime = 0;
}

/* ════════════════════════════════
   KEYBOARD / VIEWPORT STATE MACHINE
   ─────────────────────────────────
   SINGLE SOURCE OF TRUTH:  getViewportState()
   SINGLE TRANSFORM WRITER: _applyViewport()
   SINGLE RAF SCHEDULER:    fixViewport() via _vvpDirty flag
════════════════════════════════ */

let _keyboardOpen         = false;   // public-ish: read by input handler
let _stableKbH            = 0;       // last committed keyboard height
let _barHeight            = chatbarWrap ? chatbarWrap.offsetHeight : 0;
let _lastChatbarTransform = '';
let _lastSpacerH          = -1;
let _vvpDirty             = false;   // RAF pending for viewport update
let _vvpRafId             = 0;
let _willChangeActive     = false;   // true while keyboard animation is live

/*
 * getViewportState — ONE place that calculates keyboard geometry.
 *
 * Accounts for offsetTop (important on Android Chrome when the address bar
 * is partially visible) and uses a 50 px threshold to distinguish real
 * keyboard from minor browser-UI movement.
 */
function getViewportState() {
  if (!vvp) {
    return {
      viewportHeight   : window.innerHeight,
      viewportOffsetTop: 0,
      keyboardInset    : 0,
      keyboardOpen     : false
    };
  }

  const viewportHeight    = vvp.height;
  const viewportOffsetTop = vvp.offsetTop;
  const viewportBottom    = viewportOffsetTop + viewportHeight;
  const rawInset          = Math.max(0, window.innerHeight - viewportBottom);
  const keyboardInset     = rawInset > 50 ? Math.round(rawInset) : 0;

  return {
    viewportHeight,
    viewportOffsetTop,
    keyboardInset,
    keyboardOpen: keyboardInset > 0
  };
}

function _setSpacerHeight(h) {
  if (!chatSpacer || h === _lastSpacerH) return;
  _lastSpacerH = h;
  chatSpacer.style.height = h + 'px';
}

/*
 * _setWillChange — apply or remove will-change: transform.
 * Only active during keyboard animation to avoid excessive GPU layer cost.
 */
function _setWillChange(active) {
  if (!chatbarWrap) return;
  if (active === _willChangeActive) return;
  _willChangeActive = active;
  chatbarWrap.style.willChange = active ? 'transform' : '';
}

/*
 * _applyViewport — THE ONLY function that writes chatbarWrap.style.transform.
 *
 * Everything that used to fight over the transform (entrance animation,
 * keyboard animation, theme freeze recovery) now routes through here.
 *
 * Called from:
 *   • fixViewport() RAF callback  — normal keyboard events
 *   • theme-change handler        — after repaint (no freeze delay)
 *   • reduced-motion change       — immediate snap
 *   • chatbar entrance completion — to sync after entrance finishes
 */
function _applyViewport(opts) {
  if (!chatbarWrap) return;

  const { keyboardInset, keyboardOpen } = getViewportState();

  const wasOpen = _keyboardOpen;
  _stableKbH    = keyboardInset;
  _keyboardOpen = keyboardOpen;

  const targetTransform = keyboardInset > 0
    ? `translateY(-${keyboardInset}px) translateZ(0)`
    : 'translateZ(0)';

  const force        = opts?.force   ?? false;
  const skipAnim     = opts?.instant ?? _prefersReducedMotion;
  const transformChanged = targetTransform !== _lastChatbarTransform;

  if (!force && !transformChanged) {
    _setSpacerHeight(_barHeight + keyboardInset);
    return;
  }

  _lastChatbarTransform = targetTransform;
  _setSpacerHeight(_barHeight + keyboardInset);

  if (skipAnim) {
    /* Instant snap — clear any in-progress transition first. */
    _setWillChange(false);
    chatbarWrap.style.transition = 'none';
    chatbarWrap.style.transform  = targetTransform;

    /* One RAF to clear the no-transition override so future CSS transitions work. */
    requestAnimationFrame(() => {
      if (chatbarWrap && chatbarWrap.style.transform === targetTransform) {
        chatbarWrap.style.transition = '';
      }
    });
    return;
  }

  /* Animated update. */
  _setWillChange(true);

  const dur  = keyboardInset > 0 ? '0.35s' : '0.28s';
  chatbarWrap.style.transition = `transform ${dur} ${EASE.keyboardMove}`;
  chatbarWrap.style.transform  = targetTransform;

  /* Remove will-change once the transition settles. */
  const onSettle = (e) => {
    if (e.target !== chatbarWrap || e.propertyName !== 'transform') return;
    chatbarWrap.removeEventListener('transitionend',    onSettle);
    chatbarWrap.removeEventListener('transitioncancel', onSettle);
    /* Only clear if the transform hasn't changed again. */
    if (chatbarWrap.style.transform === targetTransform) {
      chatbarWrap.style.transition = '';
      _setWillChange(false);
    }
  };

  chatbarWrap.addEventListener('transitionend',    onSettle, { once: true });
  chatbarWrap.addEventListener('transitioncancel', onSettle, { once: true });

  /* Scroll-anchor when keyboard first opens. */
  if (!wasOpen && keyboardOpen && scrollHost) {
    const chatVisible = !chatArea || chatArea.style.display !== 'none';
    if (chatVisible) {
      _programmaticScroll = true;
      const anchor = window._lastUserMsgEl;
      scrollHost.scrollTop = anchor
        ? Math.max(0, anchor.offsetTop - 16)
        : scrollHost.scrollHeight;
    }
  }

  /* Re-sync scroll accumulator on next frame. */
  requestAnimationFrame(() => {
    if (scrollHost) _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
    _programmaticScroll = false;
  });
}

/*
 * fixViewport — debounced RAF gate.
 * VisualViewport emits many resize/scroll events during keyboard animation.
 * We mark dirty and coalesce into ONE RAF so we never restart a transition
 * mid-flight.
 */
function fixViewport() {
  if (!vvp) return;
  if (_vvpDirty) return;   // already scheduled — don't queue a second RAF
  _vvpDirty = true;

  _vvpRafId = requestAnimationFrame(() => {
    _vvpDirty = false;
    _vvpRafId = 0;
    _applyViewport();
  });
}

/* ── Wire up VisualViewport (or legacy fallback) ── */
if (vvp) {
  vvp.addEventListener('resize', fixViewport, { passive: true });
  vvp.addEventListener('scroll', fixViewport, { passive: true });

  _setSpacerHeight(_barHeight);
  _applyViewport({ force: true, instant: true });
} else {
  /* Legacy: no VisualViewport — keep body height in sync with window. */
  (function _legacyFix() {
    const h = window.innerHeight + 'px';
    if (document.body.style.height !== h) document.body.style.height = h;
  })();
  window.addEventListener('resize', () => {
    const h = window.innerHeight + 'px';
    if (document.body.style.height !== h) document.body.style.height = h;
  }, { passive: true });
  _setSpacerHeight(_barHeight);
}

/* ── ResizeObserver: update spacer when chatbar height changes ── */
if (chatbarWrap && typeof ResizeObserver === 'function') {
  const _barResizeObserver = new ResizeObserver((entries) => {
    /* Ignore while plus menu is open — menu DOM changes don't resize the bar. */
    if (_plusOpen) return;

    const entry = entries[entries.length - 1];
    if (!entry) return;

    const bs   = entry.borderBoxSize;
    const barH = bs
      ? (bs[0] ? bs[0].blockSize : bs.blockSize)
      : entry.contentRect.height;

    _barHeight = Math.round(barH);
    _setSpacerHeight(_barHeight + _stableKbH);
  });

  _barResizeObserver.observe(chatbarWrap);
}

/* ════════════════════════════════
   CHATBAR ENTRANCE ANIMATION
   ─────────────────────────────────
   Entrance uses opacity + a Y-translate that is INDEPENDENT of the
   keyboard transform.  They compose via separate CSS properties:
   opacity and transform.  The entrance completes and then hands off
   cleanly; no ownership flag needed.
════════════════════════════════ */

(function _chatbarEntrance() {
  if (!chatbarWrap || _prefersReducedMotion) return;

  /* Snapshot current viewport so we start at the right position. */
  const { keyboardInset } = getViewportState();
  const baseTransform = keyboardInset > 0
    ? `translateY(-${keyboardInset}px) translateZ(0)`
    : 'translateZ(0)';

  /*
   * We animate a SEPARATE element wrapper property: opacity.
   * The transform is pre-set to the correct keyboard-adjusted value.
   * This means fixViewport() can overwrite transform at any time without
   * conflicting with the entrance.
   */
  chatbarWrap.style.transition = 'none';
  chatbarWrap.style.transform  = baseTransform;
  chatbarWrap.style.opacity    = '0';
  _lastChatbarTransform        = baseTransform;

  requestAnimationFrame(() => {
    if (!chatbarWrap) return;

    chatbarWrap.style.transition = `opacity 0.35s ease-out`;
    chatbarWrap.style.opacity    = '1';

    const onEnd = (e) => {
      if (e.target !== chatbarWrap || e.propertyName !== 'opacity') return;
      chatbarWrap.removeEventListener('transitionend', onEnd);
      chatbarWrap.style.transition = '';
      chatbarWrap.style.opacity    = '';
    };

    chatbarWrap.addEventListener('transitionend', onEnd);

    /* Fallback: clear after 500 ms in case transitionend doesn't fire. */
    window.setTimeout(() => {
      chatbarWrap.removeEventListener('transitionend', onEnd);
      if (chatbarWrap.style.opacity !== '') {
        chatbarWrap.style.transition = '';
        chatbarWrap.style.opacity    = '';
      }
    }, 500);
  });
})();

/* ════════════════════════════════
   THEME / PREFERENCE CHANGE
════════════════════════════════ */

if (window.matchMedia) {
  const themeMQ        = window.matchMedia('(prefers-color-scheme: dark)');
  const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  /*
   * On theme change: immediately re-read viewport geometry and force-apply.
   * No freeze window — the brief repaint is handled by the browser; we do
   * not need to suppress viewport events during it.  If the keyboard was
   * open, the VisualViewport geometry stays stable across a theme repaint
   * on modern Android Chrome and iOS Safari.
   */
  const _onThemeChange = () => {
    /* Cancel any pending debounce RAF so the forced apply runs immediately. */
    if (_vvpDirty && _vvpRafId) {
      cancelAnimationFrame(_vvpRafId);
      _vvpRafId = 0;
      _vvpDirty = false;
    }

    /*
     * Wait two animation frames: the first lets the CSS repaint start,
     * the second lets layout settle so offsetHeight is accurate.
     */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (chatbarWrap) _barHeight = chatbarWrap.offsetHeight;
        _applyViewport({ force: true, instant: true });
      });
    });
  };

  const _onReducedMotionChange = (e) => {
    _prefersReducedMotion = e.matches;

    if (_prefersReducedMotion) {
      /* Cancel plus menu animation and snap to final state. */
      if (_plusOpen && plusMenu) {
        _cancelPlusAnimation();
        plusMenu.style.transition = 'none';
        plusMenu.style.transform  = '';
        plusMenu.style.opacity    = '';
        plusMenu.classList.add('open');
        plusBackdrop?.classList.add('open');
      }
    }

    /* Snap chatbar immediately. */
    _applyViewport({ force: true, instant: true });
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

window._lastUserMsgEl = null;

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
   HEADER / TAB SCROLL ANIMATION
════════════════════════════════ */

const HIDE_ACCUM  = 40;
const SHOW_ACCUM  = 55;
const LOGO_THRESH = 10;

function updateHeader(now) {
  _rafPending = false;

  if (!scrollHost || !logoHeader || !tabBar) return;
  if (_programmaticScroll) {
    _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
    return;
  }

  const sy    = scrollHost.scrollTop;
  const delta = sy - _lastScrollY;
  if (delta === 0) return;

  now = now || performance.now();
  const dt = Math.max(1, now - _lastScrollTime);

  _velocityEMA = _velocityEMA === 0
    ? delta / dt
    : _velocityEMA * (1 - VELOCITY_ALPHA) + (delta / dt) * VELOCITY_ALPHA;

  _lastScrollY    = sy;
  _lastScrollTime = now;

  if (sy <= LOGO_THRESH) {
    resetScrollAccum();

    if (_isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
    if (_isTabHidden)     { tabBar.classList.remove('hide');          _isTabHidden     = false; }
    if (_isTabScrolled)   { tabBar.classList.remove('scrolled');      _isTabScrolled   = false; }
    return;
  }

  if (!_isLogoCollapsed) { logoHeader.classList.add('collapsed'); _isLogoCollapsed = true; }
  if (!_isTabScrolled)   { tabBar.classList.add('scrolled');      _isTabScrolled   = true; }

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

const _scheduleHeaderUpdate = window.requestPostAnimationFrame || requestAnimationFrame;

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

    if (plusBtn && target && (target === plusBtn || plusBtn.contains(target))) return;
    if (
      target &&
      target !== pill &&
      target !== input &&
      !target.closest('button, .overlay-input-wrap')
    ) return;

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

let _plusAnimationToken       = 0;
let _plusAnimFrame            = 0;
let _plusCloseFallbackTimer   = 0;
let _plusTransitionEndHandler = null;
let _plusMenuBaseStyles       = null;

function _capturePlusMenuBaseStyles() {
  if (!plusMenu || _plusMenuBaseStyles) return;
  _plusMenuBaseStyles = {
    transition: plusMenu.style.transition,
    transform : plusMenu.style.transform,
    opacity   : plusMenu.style.opacity
  };
}

function _restorePlusMenuBaseStyles() {
  if (!plusMenu || !_plusMenuBaseStyles) return;
  plusMenu.style.transition = _plusMenuBaseStyles.transition;
  plusMenu.style.transform  = _plusMenuBaseStyles.transform;
  plusMenu.style.opacity    = _plusMenuBaseStyles.opacity;
  _plusMenuBaseStyles = null;
}

function _removePlusTransitionListener() {
  if (!plusMenu || !_plusTransitionEndHandler) return;
  plusMenu.removeEventListener('transitionend', _plusTransitionEndHandler);
  _plusTransitionEndHandler = null;
}

function _cancelPlusAnimation() {
  _plusAnimationToken += 1;
  if (_plusAnimFrame)          { cancelAnimationFrame(_plusAnimFrame); _plusAnimFrame = 0; }
  if (_plusCloseFallbackTimer) { clearTimeout(_plusCloseFallbackTimer); _plusCloseFallbackTimer = 0; }
  _removePlusTransitionListener();
}

function _finishPlusOpen(token) {
  if (!plusMenu || token !== _plusAnimationToken || !_plusOpen) return;
  _removePlusTransitionListener();
  plusMenu.style.transition = '';
  plusMenu.style.transform  = '';
  plusMenu.style.opacity    = '';
}

function _finishPlusClose(token) {
  if (!plusMenu || token !== _plusAnimationToken || _plusOpen) return;
  _removePlusTransitionListener();
  if (_plusCloseFallbackTimer) { clearTimeout(_plusCloseFallbackTimer); _plusCloseFallbackTimer = 0; }
  plusMenu.classList.remove('open');
  _restorePlusMenuBaseStyles();
}

function openPlusMenu() {
  if (!plusBtn || !plusMenu || !plusBackdrop || _plusOpen) return;

  _capturePlusMenuBaseStyles();
  _cancelPlusAnimation();

  _plusOpen = true;
  plusBackdrop.classList.add('open');
  plusMenu.classList.add('open');

  if (_prefersReducedMotion) {
    plusMenu.style.transition = '';
    plusMenu.style.transform  = '';
    plusMenu.style.opacity    = '';
    return;
  }

  const token = _plusAnimationToken;

  plusMenu.style.transition = 'none';
  plusMenu.style.transform  = 'scale(0.88) translateY(10px)';
  plusMenu.style.opacity    = '0';

  _plusAnimFrame = requestAnimationFrame(() => {
    _plusAnimFrame = 0;
    if (token !== _plusAnimationToken || !_plusOpen) return;

    plusMenu.style.transition = `transform 0.3s ${EASE.menuOpen}, opacity 0.2s ease-out`;
    plusMenu.style.transform  = 'scale(1) translateY(0)';
    plusMenu.style.opacity    = '1';

    const onOpen = (e) => {
      if (e.target !== plusMenu || e.propertyName !== 'opacity' || token !== _plusAnimationToken) return;
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

  plusMenu.style.transition = `transform 0.22s ${EASE.menuClose}, opacity 0.18s ease-in`;
  plusMenu.style.transform  = 'scale(0.88) translateY(10px)';
  plusMenu.style.opacity    = '0';

  const onClose = (e) => {
    if (
      e.target !== plusMenu ||
      e.propertyName !== 'opacity' ||
      token !== _plusAnimationToken ||
      _plusOpen
    ) return;
    _finishPlusClose(token);
  };

  _plusTransitionEndHandler = onClose;
  plusMenu.addEventListener('transitionend', onClose);

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

if (plusMenu || plusBtn) {
  document.addEventListener('click', (e) => {
    if (!_plusOpen) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    if (plusMenu?.contains(target) || plusBtn?.contains(target)) return;
    closePlusMenu();
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _plusOpen) closePlusMenu();
});

['pmPhoto', 'pmCamera', 'pmFile', 'pmLocation'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', closePlusMenu);
});

/* ════════════════════════════════
   TAB BAR — race-safe content swap
════════════════════════════════ */

let _currentTabKey = (() => {
  if (!tabBar) return 'ai';
  const a = tabBar.querySelector('.tab.active');
  return a ? a.getAttribute('data-tab') : 'ai';
})();

const _moduleCache        = {};
const _moduleLoadPromises = {};
const _scriptLoadPromises = {};
let _tabLoadRequestId     = 0;

function _nextTabLoadRequestId() {
  _tabLoadRequestId += 1;
  return _tabLoadRequestId;
}

function _isCurrentTabRequest(key, requestId) {
  return requestId === _tabLoadRequestId && _currentTabKey === key;
}

async function _loadTab(key, requestId = null) {
  if (!pageContent) return;

  const internalRequest = requestId !== null;
  if (requestId === null) requestId = _nextTabLoadRequestId();

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
    if (typeof initFn === 'function' && isActiveRequest()) initFn();
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
        .then(() => { _moduleCache[key] = true; return true; })
        .catch((error) => { delete _moduleLoadPromises[key]; throw error; });
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
  const link  = document.createElement('link');
  link.id     = id;
  link.rel    = 'stylesheet';
  link.href   = `modules/${key}/${key}.css`;
  document.head.appendChild(link);
}

function _loadScript(src) {
  if (_scriptLoadPromises[src]) return _scriptLoadPromises[src];

  _scriptLoadPromises[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src   = src;
    s.async = true;
    const cleanup = () => { s.onload = null; s.onerror = null; };
    s.onload  = () => { cleanup(); resolve(); };
    s.onerror = (err) => { cleanup(); delete _scriptLoadPromises[src]; reject(err); };
    document.head.appendChild(s);
  });

  return _scriptLoadPromises[src];
}

/* ── Content swap animation ── */

let _contentAnimationRaf        = 0;
let _contentAnimationEnd        = null;
let _contentAnimationBaseStyles = null;

function _clearContentAnimation() {
  if (!pageContent) return;
  if (_contentAnimationRaf) { cancelAnimationFrame(_contentAnimationRaf); _contentAnimationRaf = 0; }
  if (_contentAnimationEnd) { pageContent.removeEventListener('transitionend', _contentAnimationEnd); _contentAnimationEnd = null; }
  if (_contentAnimationBaseStyles) {
    pageContent.style.opacity    = _contentAnimationBaseStyles.opacity;
    pageContent.style.transform  = _contentAnimationBaseStyles.transform;
    pageContent.style.transition = _contentAnimationBaseStyles.transition;
    _contentAnimationBaseStyles  = null;
  }
}

function _animateContentIn() {
  if (!pageContent) return;
  _clearContentAnimation();
  if (_prefersReducedMotion) return;

  _contentAnimationBaseStyles = {
    opacity    : pageContent.style.opacity,
    transform  : pageContent.style.transform,
    transition : pageContent.style.transition
  };

  pageContent.style.opacity    = '0';
  pageContent.style.transform  = 'translateY(8px)';
  pageContent.style.transition = 'none';

  _contentAnimationRaf = requestAnimationFrame(() => {
    _contentAnimationRaf = 0;

    pageContent.style.transition = `opacity 0.22s ease-out, transform 0.28s ${EASE.contentSwap}`;
    pageContent.style.opacity    = '1';
    pageContent.style.transform  = 'translateY(0)';

    const onEnd = (e) => {
      if (e.target !== pageContent || e.propertyName !== 'opacity') return;
      if (_contentAnimationEnd !== onEnd) return;

      pageContent.removeEventListener('transitionend', onEnd);
      _contentAnimationEnd = null;

      if (_contentAnimationBaseStyles) {
        pageContent.style.opacity    = _contentAnimationBaseStyles.opacity;
        pageContent.style.transform  = _contentAnimationBaseStyles.transform;
        pageContent.style.transition = _contentAnimationBaseStyles.transition;
        _contentAnimationBaseStyles  = null;
      }
    };

    _contentAnimationEnd = onEnd;
    pageContent.addEventListener('transitionend', onEnd);
  });
}

/* ── Tab-bar click handler ── */

let _activeTabEl = tabBar ? tabBar.querySelector('.tab.active') : null;

if (tabBar) {
  tabBar.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const tab    = target ? target.closest('.tab') : null;
    if (!tab || tab.classList.contains('active')) return;

    const key = tab.getAttribute('data-tab');
    if (!key) return;

    const requestId = _nextTabLoadRequestId();

    if (_currentTabKey === 'ai' && _msgWrap) {
      try {
        sessionStorage.setItem('atkyn_chat_html',   _msgWrap.innerHTML);
        sessionStorage.setItem('atkyn_chat_scroll', String(scrollHost ? scrollHost.scrollTop : 0));
      } catch (_) {}
    }

    if (_activeTabEl) _activeTabEl.classList.remove('active');
    tab.classList.add('active');
    _activeTabEl   = tab;
    _currentTabKey = key;

    let q = '';
    try { q = sessionStorage.getItem('atkyn_last_query') || ''; } catch (_) {}

    if (key === 'ai') {
      if (input) input.value = '';
      if (pill) { pill.classList.remove('has-text'); pill.classList.remove('non-ai-tab'); }
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

    if (scrollHost) {
      ++_programmaticScrollToken;
      _programmaticScroll  = true;
      scrollHost.scrollTop = 0;
      _lastScrollY         = 0;
      resetScrollAccum();

      requestAnimationFrame(() => {
        if (requestId !== _tabLoadRequestId) return;
        _programmaticScroll = false;
        _lastScrollY        = scrollHost.scrollTop;
      });
    }

    if (logoHeader && _isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
    if (tabBar && _isTabHidden)         { tabBar.classList.remove('hide');          _isTabHidden     = false; }
    if (tabBar && _isTabScrolled)       { tabBar.classList.remove('scrolled');      _isTabScrolled   = false; }

    await _loadTab(key, requestId);
    if (!_isCurrentTabRequest(key, requestId)) return;

    _animateContentIn();
  }, { passive: true });
}

/* ════════════════════════════════
   PUBLIC API
════════════════════════════════ */

window._atkynModuleCache = _moduleCache;
window._atkynPageContent = pageContent;
window._atkynAnimateIn   = _animateContentIn;
window._atkynLoadTab     = _loadTab;
