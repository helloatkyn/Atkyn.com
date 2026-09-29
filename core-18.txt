/* core.js — Atkyn shared UI logic */

/* Reduced motion */
let _prefersReducedMotion = typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Easing / timing */
const EASE = {
  chatbarEnter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  menuOpen: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  menuClose: 'cubic-bezier(0.4, 0, 1, 1)',
  contentSwap: 'cubic-bezier(0.16, 1, 0.3, 1)'
};

const PLUS_HIDDEN = 'scale(0.88) translateY(10px)';
const PLUS_SHOWN = 'scale(1) translateY(0)';
const PLUS_OPEN_MS = 300;
const PLUS_CLOSE_MS = 220;
const PLUS_OPEN_TRANSITION = `transform ${PLUS_OPEN_MS}ms ${EASE.menuOpen}, opacity 200ms ease-out`;
const PLUS_CLOSE_TRANSITION = `transform ${PLUS_CLOSE_MS}ms ${EASE.menuClose}, opacity 180ms ease-in`;


/* DOM */
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

/* Plus menu rest styles (captured once, while idle) */
const _plusMenuBase = plusMenu ? {
  transition: plusMenu.style.transition,
  transform: plusMenu.style.transform,
  opacity: plusMenu.style.opacity,
  pointerEvents: plusMenu.style.pointerEvents
} : null;


/* SVG */
const SVG_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="5 11 12 4 19 11"/></svg>';
const SVG_CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/* ── State ── */

/* Scroll / header */
let _tabBarHeight = tabBar ? tabBar.offsetHeight : 0;
let _rafPending = false;
let _headerRafId = 0;
let _lastScrollY = 0;
let _accumDown = 0;
let _accumUp = 0;
let _isLogoCollapsed = false;
let _isTabHidden = false;
let _isTabScrolled = false;
let _scrollRafId = null;
let _tabScrollRafId = 0;
let _msgScrollCleanup = null;
let _programmaticScroll = false;
let _programmaticScrollToken = 0;
const _scrollOwners = { focusScroll: false, message: false, tab: false };

let _velocityEMA = 0;
let _lastScrollTime = 0;
const VELOCITY_ALPHA = 0.3;

/* Composer / layout */
let _barHeight = chatbarWrap ? chatbarWrap.offsetHeight : 0;
let _composerSyncRaf = 0;
let _barRO = null;

/* Chatbar entrance */
let _entranceMove = null;
let _entranceFade = null;

/* Plus menu */
if (typeof _plusOpen === 'undefined') {
  globalThis._plusOpen = false;
}
let _plusAnimationToken = 0;
let _plusFallbackTimer = 0;
let _plusTransitionEndHandler = null;

/* Content transition */
let _contentAnimations = [];
let _contentFallback = null;

/* Chat persistence */
let _chatSavePending = false;
let _chatSaveScroll = 0;
let _chatSaveHandle = 0;

/* Public */
window._lastUserMsgEl = null;

/* Tabs */
let _currentTabKey = (() => {
  if (!tabBar) return 'ai';
  const a = tabBar.querySelector('.tab.active');
  return a ? a.getAttribute('data-tab') : 'ai';
})();
const _moduleCache = {};
const _moduleLoadPromises = {};
const _scriptLoadPromises = {};
const _cssPromises = {};
let _tabLoadRequestId = 0;

/* ════════════════════════════════
   HELPERS
   ════════════════════════════════ */

function _setScrollOwner(owner, on) {
  _scrollOwners[owner] = !!on;
  _programmaticScroll =
    _scrollOwners.focusScroll || _scrollOwners.message || _scrollOwners.tab;
}

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

/* Style flush only (no layout): commits a start state before a transition is armed */
function _flushStyle(el) {
  return getComputedStyle(el).opacity;
}

/* Transform + opacity enter fallback for engines without Element.animate */
function _cssEnter(el, y, moveMs, fadeMs, ease, onDone) {
  let armRaf = 0;
  let timer = 0;
  let ended = false;

  function onEnd(e) {
    if (e.target === el && e.propertyName === 'transform') end();
  }

  function clear() {
    if (armRaf) cancelAnimationFrame(armRaf);
    armRaf = 0;
    clearTimeout(timer);
    el.removeEventListener('transitionend', onEnd);
    el.style.transition = '';
    el.style.opacity = '';
    el.style.transform = '';
  }

  function end() {
    if (ended) return;
    ended = true;
    clear();
    if (onDone) onDone();
  }

  el.style.transition = 'none';
  el.style.opacity = '0';
  el.style.transform = `translateY(${y}px)`;

  /* Two frames: start state must be painted before the transition is armed */
  armRaf = requestAnimationFrame(() => {
    armRaf = requestAnimationFrame(() => {
      armRaf = 0;
      el.style.transition = `transform ${moveMs}ms ${ease}, opacity ${fadeMs}ms ease-out`;
      el.style.opacity = '';
      el.style.transform = '';
      el.addEventListener('transitionend', onEnd);
    });
  });

  /* Watchdog: never leave the element hidden if no transition runs */
  timer = window.setTimeout(end, moveMs + 120);

  return {
    cancel() {
      if (ended) return;
      ended = true;
      clear();
    }
  };
}

/* ════════════════════════════════
   NATIVE VIEWPORT / COMPOSER LAYOUT
   ════════════════════════════════ */

/*
 * Chromium's native OSK contract is the source of truth here:
 * interactive-widget=resizes-content makes the layout viewport itself shrink.
 * A bottom-fixed composer therefore follows the available layout viewport with
 * no keyboard-height inference, VisualViewport math, transform compensation,
 * or keyboard spacer.
 *
 * core.js is the only file allowed to change in this repair, so establish the
 * viewport contract here when the page has not declared it yet. The browser
 * remains responsible for the actual OSK/layout transition.
 */
function _ensureNativeKeyboardViewport() {
  if (!document.head) return;

  let meta = document.head.querySelector('meta[name="viewport"]');

  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1, interactive-widget=resizes-content';
    document.head.prepend(meta);
    return;
  }

  const current = meta.getAttribute('content') || '';
  const parts = current
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^interactive-widget\s*=/i.test(part));

  if (!parts.some((part) => /^width\s*=/i.test(part))) {
    parts.unshift('width=device-width');
  }

  parts.push('interactive-widget=resizes-content');

  const next = parts.join(', ');
  if (next !== current.trim()) meta.setAttribute('content', next);
}

_ensureNativeKeyboardViewport();

function _measureBarHeight() {
  if (!chatbarWrap) return 0;

  const rectH = chatbarWrap.getBoundingClientRect().height;
  return Number.isFinite(rectH) && rectH > 0
    ? Math.ceil(rectH)
    : chatbarWrap.offsetHeight;
}

function _setComposerSpacerHeight(h) {
  if (!chatSpacer || !Number.isFinite(h)) return;

  const px = Math.max(0, Math.ceil(h)) + 'px';
  if (chatSpacer.style.height !== px) chatSpacer.style.height = px;
}

function _syncPlusMenuOffset() {
  if (!plusMenu || !pill) return;

  const ph = Math.round(pill.getBoundingClientRect().height);
  if (ph > 0) plusMenu.style.setProperty('--pill-h', ph + 'px');
}

/*
 * Google-style shell contract: the outer composer itself is fixed to the
 * bottom edge. Only missing/incorrect fixed-bottom geometry is normalized;
 * width, margins, z-index, and visual styling remain owned by project CSS.
 */
function _ensureFixedComposerShell() {
  if (!chatbarWrap) return;

  const cs = getComputedStyle(chatbarWrap);
  if (cs.position !== 'fixed') chatbarWrap.style.position = 'fixed';
  if (cs.bottom !== '0px') chatbarWrap.style.bottom = '0px';
}

/*
 * One normal layout scheduler for composer-size changes.
 * ResizeObserver never computes keyboard geometry and never writes a transform.
 */
function _scheduleComposerSync() {
  if (_composerSyncRaf) return;

  _composerSyncRaf = requestAnimationFrame(() => {
    _composerSyncRaf = 0;

    if (!chatbarWrap) return;

    _ensureFixedComposerShell();
    _barHeight = _measureBarHeight();

    /* Base composer clearance only. There is deliberately no keyboard addend. */
    _setComposerSpacerHeight(_barHeight);
    _syncPlusMenuOffset();
  });
}

function _cancelComposerSync() {
  if (_composerSyncRaf) {
    cancelAnimationFrame(_composerSyncRaf);
    _composerSyncRaf = 0;
  }
}

/* Focus scroll is a normal composer interaction, not keyboard geometry. */
function _scheduleComposerFocusScroll() {
  if (!scrollHost || !input) return;
  if (!(navigator.maxTouchPoints > 0 || 'ontouchstart' in window)) return;
  if (!chatArea || chatArea.style.display === 'none') return;

  requestAnimationFrame(() => {
    if (document.activeElement !== input) return;

    _setScrollOwner('focusScroll', true);
    const anchor = window._lastUserMsgEl;

    scrollHost.scrollTop = anchor
      ? Math.max(0, anchor.offsetTop - 16)
      : scrollHost.scrollHeight;

    requestAnimationFrame(() => {
      _setScrollOwner('focusScroll', false);
      if (scrollHost) _lastScrollY = scrollHost.scrollTop;
    });
  });
}

if (chatbarWrap && typeof ResizeObserver === 'function') {
  _barRO = new ResizeObserver(() => _scheduleComposerSync());
  _barRO.observe(chatbarWrap);
}

_ensureFixedComposerShell();
_barHeight = _measureBarHeight();
_setComposerSpacerHeight(_barHeight);
_syncPlusMenuOffset();
_startChatbarEntrance();

function _handleLayoutResize() {
  _scheduleComposerSync();
  _scheduleComposerFocusScroll();
}

function _recoverComposerAfterLifecycle() {
  if (document.visibilityState === 'hidden' || !chatbarWrap) return;
  _scheduleComposerSync();
}

window.addEventListener('resize', _handleLayoutResize, { passive: true });
window.addEventListener('orientationchange', _handleLayoutResize, { passive: true });

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

function _cancelMessageScroll() {
  _programmaticScrollToken += 1;

  if (_scrollRafId !== null) {
    cancelAnimationFrame(_scrollRafId);
    _scrollRafId = null;
  }

  if (_msgScrollCleanup) {
    _msgScrollCleanup();
    _msgScrollCleanup = null;
  }

  _setScrollOwner('message', false);
}

/* Resolves when a smooth scroll ends, is interrupted by the user, or stalls */
function _watchScrollSettle(done) {
  let raf = 0;
  let timer = 0;
  let still = 0;
  let last = scrollHost.scrollTop;

  function cleanup() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(timer);
    scrollHost.removeEventListener('scrollend', finish);
    scrollHost.removeEventListener('touchstart', finish);
    scrollHost.removeEventListener('wheel', finish);
  }

  function finish() {
    cleanup();
    done();
  }

  scrollHost.addEventListener('touchstart', finish, { passive: true });
  scrollHost.addEventListener('wheel', finish, { passive: true });

  if ('onscrollend' in window) {
    scrollHost.addEventListener('scrollend', finish, { passive: true });
  } else {
    const tick = () => {
      const top = scrollHost.scrollTop;
      still = top === last ? still + 1 : 0;
      last = top;

      if (still >= 4) {
        finish();
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
  }

  /* Watchdog for a scroll that never starts or never reports its end */
  timer = window.setTimeout(finish, 1500);

  return cleanup;
}

function scrollToMsg(el) {
  if (!el || !scrollHost) return;

  _cancelMessageScroll();
  const token = _programmaticScrollToken;

  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId = null;

    if (token !== _programmaticScrollToken) return;

    /* Read phase */
    if (tabBar) _tabBarHeight = tabBar.offsetHeight;
    const maxTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
    const target = Math.min(maxTop, Math.max(0, el.offsetTop - _tabBarHeight - 8));
    const distance = Math.abs(target - scrollHost.scrollTop);

    _setScrollOwner('message', true);

    if (_prefersReducedMotion || distance < 1) {
      if (distance >= 1) scrollHost.scrollTop = target;
      _lastScrollY = scrollHost.scrollTop;
      resetScrollAccum();
      _setScrollOwner('message', false);
      return;
    }

    scrollHost.scrollTo({ top: target, behavior: 'smooth' });

    _msgScrollCleanup = _watchScrollSettle(() => {
      _msgScrollCleanup = null;
      if (token !== _programmaticScrollToken) return;

      _setScrollOwner('message', false);
      _lastScrollY = scrollHost.scrollTop;
      resetScrollAccum();
    });
  });
}

window.scrollToMsg = scrollToMsg;

/* ════════════════════════════════
   CHATBAR ENTRANCE
   ════════════════════════════════ */

function _endEntranceMove() {
  _entranceMove = null;
}

function _startChatbarEntrance() {
  if (!chatbarWrap || _prefersReducedMotion) return;

  if (typeof chatbarWrap.animate !== 'function') {
    _entranceMove = _cssEnter(chatbarWrap, 24, 420, 300, EASE.chatbarEnter, _endEntranceMove);
    return;
  }

  /* 'backwards' fill: start state applies immediately, nothing is held after the end */
  const move = chatbarWrap.animate(
    [
      { transform: 'translateY(24px) translateZ(0)' },
      { transform: 'translateY(0) translateZ(0)' }
    ],
    { duration: 420, easing: EASE.chatbarEnter, fill: 'backwards' }
  );

  const fade = chatbarWrap.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: 300, easing: 'ease-out', fill: 'backwards' }
  );

  move.onfinish = move.oncancel = () => {
    if (_entranceMove === move) _endEntranceMove();
  };

  fade.onfinish = fade.oncancel = () => {
    if (_entranceFade === fade) _entranceFade = null;
  };

  _entranceMove = move;
  _entranceFade = fade;
}

/* Focus cancels the movement transform; opacity may finish independently. */
function _cancelChatbarEntrance(keepFade = false) {
  const move = _entranceMove;
  const fade = _entranceFade;

  _entranceMove = null;
  if (!keepFade) _entranceFade = null;

  if (move) {
    move.onfinish = move.oncancel = null;
    move.cancel();
  }

  if (fade && !keepFade) {
    fade.onfinish = fade.oncancel = null;
    fade.cancel();
  }

}

/* Native viewport owns keyboard positioning; there is no JS keyboard geometry engine. */

/* ════════════════════════════════
   CHAT PERSISTENCE (off the tab-click path)
   ════════════════════════════════ */

function _flushChatSave() {
  if (!_chatSavePending) return;
  _chatSavePending = false;

  try {
    sessionStorage.setItem('atkyn_chat_html', _msgWrap.innerHTML);
    sessionStorage.setItem('atkyn_chat_scroll', String(_chatSaveScroll));
  } catch (_) {}
}

function _queueChatSave() {
  if (!_msgWrap) return;

  _chatSavePending = true;
  _chatSaveScroll = scrollHost ? scrollHost.scrollTop : 0;

  if (_chatSaveHandle) return;

  const run = () => {
    _chatSaveHandle = 0;
    _flushChatSave();
  };

  _chatSaveHandle = typeof requestIdleCallback === 'function'
    ? requestIdleCallback(run, { timeout: 800 })
    : window.setTimeout(run, 120);
}

/* ════════════════════════════════
   LIFECYCLE
   ════════════════════════════════ */

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    _recoverComposerAfterLifecycle();
  } else {
    _flushChatSave();
  }
}, { passive: true });

window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;

  if (_barRO && chatbarWrap) _barRO.observe(chatbarWrap);
  _recoverComposerAfterLifecycle();
}, { passive: true });

window.addEventListener('pagehide', () => {
  _flushChatSave();
  _cancelComposerSync();
  _setScrollOwner('focusScroll', false);

  if (_headerRafId) {
    cancelAnimationFrame(_headerRafId);
    _headerRafId = 0;
    _rafPending = false;
  }

  if (_tabScrollRafId) {
    cancelAnimationFrame(_tabScrollRafId);
    _tabScrollRafId = 0;
    _setScrollOwner('tab', false);
  }

  _cancelMessageScroll();
  _cancelChatbarEntrance();
  _clearContentAnimation();
  _settlePlusMenu();

  if (_barRO) _barRO.disconnect();
}, { passive: true });

/* ════════════════════════════════
   REDUCED-MOTION CHANGE
   ════════════════════════════════ */

if (window.matchMedia) {
  const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  const _onReducedMotionChange = (e) => {
    _prefersReducedMotion = e.matches;

    if (_prefersReducedMotion) {
      _cancelChatbarEntrance();
      _clearContentAnimation();
      _settlePlusMenu();
    }

    _scheduleComposerSync();
  };

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
const VELOCITY_MIN = 0.05;
const IDLE_GAP = 120;

function updateHeader(now) {
  _rafPending = false;
  _headerRafId = 0;

  if (!scrollHost || !logoHeader || !tabBar) return;

  const sy = scrollHost.scrollTop;

  if (_programmaticScroll) {
    _lastScrollY = sy;
    resetScrollAccum();
    return;
  }

  const delta = sy - _lastScrollY;

  if (delta === 0) return;

  now = now || performance.now();
  /* First sample after a reset has no previous timestamp */
  const dt = _lastScrollTime ? Math.max(1, now - _lastScrollTime) : 16;
  const v = delta / dt;

  /* Reseed on first sample, idle gap, or direction reversal so stale velocity never leaks */
  _velocityEMA = (_velocityEMA === 0 || dt > IDLE_GAP || (v > 0) !== (_velocityEMA > 0))
    ? v
    : _velocityEMA * (1 - VELOCITY_ALPHA) + v * VELOCITY_ALPHA;

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

  if (delta > 0) {
    _accumUp = 0;

    if (_velocityEMA > VELOCITY_MIN) {
      _accumDown += delta;

      if (!_isTabHidden && _accumDown >= HIDE_ACCUM) {
        tabBar.classList.add('hide');
        _isTabHidden = true;
        _accumDown = 0;
      }
    }
  } else {
    _accumDown = 0;

    if (_velocityEMA < -VELOCITY_MIN) {
      _accumUp -= delta;

      if (_isTabHidden && _accumUp >= SHOW_ACCUM) {
        tabBar.classList.remove('hide');
        _isTabHidden = false;
        _accumUp = 0;
      }
    }
  }
}

if (scrollHost) {
  scrollHost.addEventListener('scroll', () => {
    if (_programmaticScroll) {
      _lastScrollY = scrollHost.scrollTop;
      return;
    }

    if (!_rafPending) {
      _rafPending = true;
      _headerRafId = requestAnimationFrame(updateHeader);
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

    /* Attachment tray has its own handlers */
    if (target && target.closest('.attach-tray')) return;

    if (
      target &&
      target !== pill &&
      target !== input &&
      !target.closest('button, .overlay-input-wrap')
    ) {
      return;
    }

    if (document.activeElement === input) return;

    e.preventDefault();

    requestAnimationFrame(() => {
      if (input && document.activeElement !== input) {
        input.focus({ preventScroll: true });
      }
    });
  }, { passive: false });

  input.addEventListener('focus', () => {
    /* Never let the entrance animation share ownership of the composer transform. */
    _cancelChatbarEntrance(true);
    _scheduleComposerSync();
    _scheduleComposerFocusScroll();
  });

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

function _unwatchPlus() {
  if (_plusFallbackTimer) {
    clearTimeout(_plusFallbackTimer);
    _plusFallbackTimer = 0;
  }

  if (plusMenu && _plusTransitionEndHandler) {
    plusMenu.removeEventListener('transitionend', _plusTransitionEndHandler);
    _plusTransitionEndHandler = null;
  }
}

function _cancelPlusAnimation() {
  _plusAnimationToken += 1;
  _unwatchPlus();
}

/* Finish on the transform transition; watchdog covers a transition that never runs */
function _watchPlusTransition(token, done, ms) {
  const finish = () => done(token);

  _plusTransitionEndHandler = (e) => {
    if (e.target === plusMenu && e.propertyName === 'transform') finish();
  };

  plusMenu.addEventListener('transitionend', _plusTransitionEndHandler);
  _plusFallbackTimer = window.setTimeout(finish, ms + 80);
}

function _applyPlusRest() {
  plusMenu.style.transition = _plusMenuBase.transition;
  plusMenu.style.transform = _plusMenuBase.transform;
  plusMenu.style.opacity = _plusMenuBase.opacity;
  plusMenu.style.pointerEvents = _plusMenuBase.pointerEvents;
}

function _finishPlusOpen(token) {
  if (!plusMenu || token !== _plusAnimationToken || !_plusOpen) return;

  _unwatchPlus();
  _applyPlusRest();
}

function _finishPlusClose(token) {
  if (!plusMenu || token !== _plusAnimationToken || _plusOpen) return;

  _unwatchPlus();

  const instant = _prefersReducedMotion;
  if (instant) plusMenu.style.transition = 'none';

  plusMenu.classList.remove('open');
  plusBackdrop?.classList.remove('open');

  if (instant) _flushStyle(plusMenu);
  _applyPlusRest();
}

/* Jump to the final state of the current intent (reduced motion, pagehide) */
function _settlePlusMenu() {
  if (!plusMenu || !plusBackdrop) return;

  _cancelPlusAnimation();

  if (_plusOpen) {
    plusMenu.classList.add('open');
    plusBackdrop.classList.add('open');
    _applyPlusRest();
    if (_prefersReducedMotion) plusMenu.style.transition = 'none';
  } else if (plusMenu.classList.contains('open')) {
    _finishPlusClose(_plusAnimationToken);
  }
}

function openPlusMenu() {
  if (!plusBtn || !plusMenu || !plusBackdrop) return;
  if (_plusOpen) return;

  /* Menu still carries 'open' only while a close is in flight */
  const resuming = plusMenu.classList.contains('open');

  _cancelPlusAnimation();
  const token = _plusAnimationToken;

  _plusOpen = true;
  plusBackdrop.classList.add('open');

  if (_prefersReducedMotion) {
    plusMenu.classList.add('open');
    _applyPlusRest();
    plusMenu.style.transition = 'none';
    return;
  }

  plusMenu.style.pointerEvents = _plusMenuBase.pointerEvents;

  if (!resuming) {
    plusMenu.classList.add('open');
    plusMenu.style.transition = 'none';
    plusMenu.style.transform = PLUS_HIDDEN;
    plusMenu.style.opacity = '0';
    _flushStyle(plusMenu);
  }

  /* Resuming retargets from the current in-flight value: no pop */
  plusMenu.style.transition = PLUS_OPEN_TRANSITION;
  plusMenu.style.transform = PLUS_SHOWN;
  plusMenu.style.opacity = '1';

  _watchPlusTransition(token, _finishPlusOpen, PLUS_OPEN_MS);
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

  /* Closing menu must not take taps */
  plusMenu.style.pointerEvents = 'none';
  plusMenu.style.transition = PLUS_CLOSE_TRANSITION;
  plusMenu.style.transform = PLUS_HIDDEN;
  plusMenu.style.opacity = '0';

  _watchPlusTransition(token, _finishPlusClose, PLUS_CLOSE_MS);
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

    if (plusMenu?.contains(target) || plusBtn?.contains(target)) return;

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
   ATTACHMENTS
   Single owner of attachment state, tray UI and file preparation.
   search.js talks to it only through window.AtkynAttach.
   Limits below are mirrored server-side in functions/api/chat.js.
   ════════════════════════════════ */

const ATTACH = {
  MAX_FILES: 4,
  IMAGE_MAX_BYTES: 20 * 1024 * 1024,   /* raw input; re-encoded smaller before sending */
  IMAGE_MAX_DIM: 1600,
  IMAGE_QUALITY: 0.85,
  THUMB_DIM: 112,
  PDF_MAX_BYTES: 15 * 1024 * 1024,
  PDF_MAX_PAGES: 40,
  TEXT_MAX_BYTES: 1024 * 1024,
  TEXT_MAX_CHARS: 40000,               /* per file */
  TEXT_TOTAL_CHARS: 80000,             /* across all text/PDF attachments */
  NOTICE_MS: 4500
};

const _ATTACH_TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'html', 'htm', 'css',
  'js', 'mjs', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb',
  'php', 'sh', 'sql', 'kt', 'swift', 'dart', 'log', 'ini', 'toml'
]);
const _ATTACH_IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif', 'bmp']);

const PDFJS_VERSION = '3.11.174';
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/`;

const SVG_ATTACH_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const SVG_ATTACH_DOC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

const attachTray = document.getElementById('attachTray');
const attachList = document.getElementById('attachList');
const attachNotice = document.getElementById('attachNotice');

/* User-facing failure vs. silent cancellation */
class AttachError extends Error {}
class AttachCancelled extends Error {}

const _attachItems = [];
let _attachSeq = 0;
let _attachNoticeTimer = 0;
let _attachCleanupToken = 0;
let _pdfjsPromise = null;

function _alive(ctrl) {
  if (ctrl.cancelled) throw new AttachCancelled();
}

function _onAiTab() {
  return !(pill && pill.classList.contains('non-ai-tab'));
}

function _fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

function _shortName(name) {
  const n = String(name || 'file');
  return n.length > 28 ? n.slice(0, 25) + '…' : n;
}

function _attachKind(file) {
  const name = String(file.name || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const mime = String(file.type || '').toLowerCase();

  if (mime === 'image/svg+xml' || ext === 'svg') return null;
  if (mime.startsWith('image/') || _ATTACH_IMAGE_EXT.has(ext)) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('text/') || mime === 'application/json' || _ATTACH_TEXT_EXT.has(ext)) return 'text';
  return null;
}

/* ── Preparation: image ── */

async function _decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => { if (bmp.close) bmp.close(); } };
    } catch (_) { /* fall through to <img> */ }
  }

  const url = URL.createObjectURL(file);

  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function _drawJpeg(dec, maxDim, quality, square) {
  let sx = 0, sy = 0, sw = dec.w, sh = dec.h, dw, dh;

  if (square) {
    const m = Math.min(sw, sh);
    sx = (sw - m) / 2;
    sy = (sh - m) / 2;
    sw = m;
    sh = m;
    dw = dh = Math.min(maxDim, m);
  } else {
    const k = Math.min(1, maxDim / Math.max(sw, sh));
    dw = Math.max(1, Math.round(sw * k));
    dh = Math.max(1, Math.round(sh * k));
  }

  const c = document.createElement('canvas');
  c.width = dw;
  c.height = dh;

  const ctx = c.getContext('2d');
  if (!ctx) throw new AttachError("This image couldn't be processed.");

  ctx.fillStyle = '#fff';               /* JPEG has no alpha */
  ctx.fillRect(0, 0, dw, dh);
  ctx.drawImage(dec.src, sx, sy, sw, sh, 0, 0, dw, dh);

  const url = c.toDataURL('image/jpeg', quality);
  c.width = c.height = 0;               /* release backing store (iOS canvas memory cap) */

  if (url.indexOf('data:image/jpeg') !== 0) throw new AttachError("This image couldn't be processed.");
  return url;
}

async function _processImage(file, ctrl) {
  let dec;

  try {
    dec = await _decodeImage(file);
  } catch (_) {
    throw new AttachError("This image couldn't be read.");
  }

  try {
    _alive(ctrl);
    if (!dec.w || !dec.h) throw new AttachError("This image couldn't be read.");

    const dataUrl = _drawJpeg(dec, ATTACH.IMAGE_MAX_DIM, ATTACH.IMAGE_QUALITY, false);
    const thumb = _drawJpeg(dec, ATTACH.THUMB_DIM, 0.7, true);

    return { type: 'image', name: file.name || 'image', mime: 'image/jpeg', dataUrl, thumb };
  } finally {
    dec.done();
  }
}

/* ── Preparation: text / code ── */

async function _processText(file, ctrl) {
  const raw = await file.text();
  _alive(ctrl);

  const head = raw.slice(0, 8000);
  const bad = (head.match(/\uFFFD/g) || []).length;

  if (head.indexOf('\u0000') !== -1 || (head.length && bad / head.length > 0.02)) {
    throw new AttachError("This doesn't look like a text file.");
  }

  const text = raw.replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new AttachError('This file is empty.');

  return { type: 'text', name: file.name || 'file', mime: file.type || 'text/plain', text, truncated: false };
}

/* ── Preparation: PDF (pdf.js loaded on first use; reuses the shared script loader) ── */

function _loadPdfjs() {
  if (_pdfjsPromise) return _pdfjsPromise;

  _pdfjsPromise = _loadScript(PDFJS_BASE + 'pdf.min.js')
    .then(() => fetch(PDFJS_BASE + 'pdf.worker.min.js'))
    .then((res) => {
      if (!res.ok) throw new Error('pdf worker');
      return res.blob();
    })
    .then((blob) => {
      const lib = window.pdfjsLib;
      if (!lib) throw new Error('pdfjs missing');

      /* Cross-origin Workers are blocked; a same-origin blob URL is the supported route */
      lib.GlobalWorkerOptions.workerSrc =
        URL.createObjectURL(new Blob([blob], { type: 'text/javascript' }));

      return lib;
    })
    .catch((err) => {
      _pdfjsPromise = null;
      throw err;
    });

  return _pdfjsPromise;
}

async function _processPdf(file, ctrl) {
  let lib;

  try {
    lib = await _loadPdfjs();
  } catch (_) {
    throw new AttachError('PDF reader could not load. Check your connection and try again.');
  }

  _alive(ctrl);

  const buf = await file.arrayBuffer();
  _alive(ctrl);

  let doc;

  try {
    doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  } catch (err) {
    if (err && err.name === 'PasswordException') throw new AttachError('This PDF is password protected.');
    throw new AttachError("This PDF couldn't be read.");
  }

  try {
    const total = doc.numPages;
    const limit = Math.min(total, ATTACH.PDF_MAX_PAGES);
    const parts = [];
    let chars = 0;
    let pagesRead = 0;

    for (let i = 1; i <= limit; i++) {
      _alive(ctrl);

      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      page.cleanup();

      const pageText = content.items
        .map((it) => (it.str || '') + (it.hasEOL ? '\n' : ' '))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      pagesRead = i;

      if (pageText) {
        parts.push(`--- Page ${i} ---\n${pageText}`);
        chars += pageText.length;
      }

      if (chars >= ATTACH.TEXT_MAX_CHARS) break;
    }

    const text = parts.join('\n\n');

    if (!text.trim()) {
      throw new AttachError('No selectable text found (it may be a scanned PDF).');
    }

    return {
      type: 'text',
      name: file.name || 'document.pdf',
      mime: 'application/pdf',
      text,
      truncated: pagesRead < total
    };
  } finally {
    try { doc.destroy(); } catch (_) {}
  }
}

/* Applies per-file and total text budgets at the moment an item becomes ready */
function _fitTextBudget(data, self) {
  if (data.type !== 'text') return data;

  let used = 0;
  for (const it of _attachItems) {
    if (it !== self && it.status === 'ready' && it.data && it.data.type === 'text') {
      used += it.data.text.length;
    }
  }

  const cap = Math.min(ATTACH.TEXT_MAX_CHARS, ATTACH.TEXT_TOTAL_CHARS - used);

  if (cap < 200) {
    throw new AttachError('Text limit for this message reached. Remove a file first.');
  }

  if (data.text.length > cap) {
    let t = data.text.slice(0, cap);
    const last = t.charCodeAt(t.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) t = t.slice(0, -1);   /* never split a surrogate pair */
    data.text = t;
    data.truncated = true;
  }

  return data;
}

async function _processAttachment(item) {
  try {
    let data;

    if (item.kind === 'image') data = await _processImage(item.file, item.ctrl);
    else if (item.kind === 'pdf') data = await _processPdf(item.file, item.ctrl);
    else data = await _processText(item.file, item.ctrl);

    _alive(item.ctrl);

    item.data = _fitTextBudget(data, item);
    item.status = 'ready';
    _markChipReady(item);
  } catch (err) {
    if (item.ctrl.cancelled || err instanceof AttachCancelled) return;

    /* Notice first: while it is visible the tray stays open, so the failed chip can go at once */
    _showAttachNotice(
      `${_shortName(item.name)}: ${err instanceof AttachError ? err.message : "couldn't be read."}`
    );
    _removeAttachItem(item);
  } finally {
    _syncAttachUI();
  }
}

/* ── Chip rendering ── */

function _buildChip(item) {
  const el = document.createElement('div');
  el.className = 'attach-chip is-loading ' + (item.kind === 'image' ? 'is-image' : 'is-file') +
    (item.kind === 'pdf' ? ' is-pdf' : '');
  el.setAttribute('role', 'listitem');
  el.dataset.id = String(item.id);

  if (item.kind !== 'image') {
    const ico = document.createElement('span');
    ico.className = 'attach-file-ico';
    ico.innerHTML = SVG_ATTACH_DOC;

    const txt = document.createElement('span');
    txt.className = 'attach-file-text';

    const nm = document.createElement('span');
    nm.className = 'attach-file-name';
    nm.textContent = item.name;

    const meta = document.createElement('span');
    meta.className = 'attach-file-meta';
    const ext = item.name.includes('.') ? item.name.split('.').pop().toUpperCase().slice(0, 5) : 'FILE';
    meta.textContent = `${ext} · ${_fmtSize(item.file.size)}`;

    txt.appendChild(nm);
    txt.appendChild(meta);
    el.appendChild(ico);
    el.appendChild(txt);
  }

  const spin = document.createElement('span');
  spin.className = 'attach-spin';
  spin.setAttribute('aria-hidden', 'true');
  el.appendChild(spin);

  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'attach-remove';
  rm.setAttribute('aria-label', 'Remove ' + item.name);
  rm.innerHTML = SVG_ATTACH_X;
  el.appendChild(rm);

  return el;
}

function _markChipReady(item) {
  const el = item.el;
  if (!el || !el.isConnected) return;

  el.classList.remove('is-loading');

  const spin = el.querySelector('.attach-spin');
  if (spin) spin.remove();

  if (item.kind === 'image' && item.data && item.data.thumb) {
    const img = document.createElement('img');
    img.alt = item.name;
    img.src = item.data.thumb;
    el.insertBefore(img, el.firstChild);
  }
}

/* Drops chip elements of items that already left the list (kept only to animate the collapse) */
function _purgeStaleChips() {
  if (!attachList) return;

  Array.from(attachList.children).forEach((el) => {
    if (!_attachItems.some((it) => String(it.id) === el.dataset.id)) el.remove();
  });
}

/* When the last chip goes, keep its element until the tray finished collapsing */
function _scheduleListCleanup() {
  if (!attachTray || !attachList) return;

  const token = ++_attachCleanupToken;
  let timer = 0;

  const done = () => {
    attachTray.removeEventListener('transitionend', onEnd);
    clearTimeout(timer);
    if (token === _attachCleanupToken && !_attachItems.length) attachList.textContent = '';
  };

  const onEnd = (e) => {
    if (e.target === attachTray && e.propertyName === 'grid-template-rows') done();
  };

  if (_prefersReducedMotion) {
    done();
    return;
  }

  attachTray.addEventListener('transitionend', onEnd);
  timer = window.setTimeout(done, 380);   /* watchdog: same pattern as the plus menu */
}

/* ── State transitions ── */

function _removeAttachItem(item) {
  const i = _attachItems.indexOf(item);
  if (i === -1) return;

  item.ctrl.cancelled = true;           /* aborts any in-flight preparation */
  _attachItems.splice(i, 1);

  /* Keep the last chip on screen only when the tray is really about to collapse */
  if (_attachItems.length || (pill && pill.classList.contains('has-notice'))) {
    if (item.el) item.el.remove();
  } else {
    _scheduleListCleanup();
  }

  _syncAttachUI();
}

function _clearAttachments() {
  if (!_attachItems.length) return;

  _attachItems.forEach((it) => { it.ctrl.cancelled = true; });
  _attachItems.length = 0;

  _scheduleListCleanup();
  _syncAttachUI();
}

function _syncAttachUI() {
  if (!pill) return;

  const onAi = _onAiTab();
  const has = onAi && _attachItems.length > 0;
  const busy = onAi && _attachItems.some((it) => it.status === 'processing');

  pill.classList.toggle('has-attach', has);

  if (sendBtn) {
    sendBtn.classList.toggle('is-busy', busy);
    if (busy) sendBtn.setAttribute('aria-busy', 'true');
    else sendBtn.removeAttribute('aria-busy');
  }
}

function _showAttachNotice(msg) {
  if (!attachNotice || !pill) return;

  clearTimeout(_attachNoticeTimer);

  attachNotice.textContent = msg;
  attachNotice.hidden = false;
  pill.classList.add('has-notice');

  _attachNoticeTimer = window.setTimeout(_hideAttachNotice, ATTACH.NOTICE_MS);
}

/* Text stays in the DOM while the tray collapses; the collapsed tray is visibility:hidden */
function _hideAttachNotice() {
  clearTimeout(_attachNoticeTimer);
  _attachNoticeTimer = 0;
  if (pill) pill.classList.remove('has-notice');
}

function _addAttachments(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  if (!_onAiTab()) {
    _showAttachNotice('Attachments are available in the Answer tab.');
    return;
  }

  _purgeStaleChips();
  _attachCleanupToken += 1;             /* a pending collapse-cleanup must not wipe new chips */

  const problems = [];
  let added = 0;

  for (const file of files) {
    if (_attachItems.length >= ATTACH.MAX_FILES) {
      problems.push(`You can attach up to ${ATTACH.MAX_FILES} files per message.`);
      break;
    }

    const name = file.name || 'file';
    const kind = _attachKind(file);

    if (!kind) {
      problems.push(`${_shortName(name)}: unsupported file type.`);
      continue;
    }

    if (!file.size) {
      problems.push(`${_shortName(name)}: file is empty.`);
      continue;
    }

    const maxBytes = kind === 'image' ? ATTACH.IMAGE_MAX_BYTES
      : kind === 'pdf' ? ATTACH.PDF_MAX_BYTES
      : ATTACH.TEXT_MAX_BYTES;

    if (file.size > maxBytes) {
      problems.push(`${_shortName(name)}: too large (max ${_fmtSize(maxBytes)}).`);
      continue;
    }

    if (_attachItems.some((it) =>
      it.file.name === file.name && it.file.size === file.size && it.file.lastModified === file.lastModified)) {
      problems.push(`${_shortName(name)} is already attached.`);
      continue;
    }

    const item = {
      id: ++_attachSeq,
      file,
      name,
      kind,
      status: 'processing',
      ctrl: { cancelled: false },
      data: null,
      el: null
    };

    item.el = _buildChip(item);
    _attachItems.push(item);
    attachList.appendChild(item.el);
    added += 1;

    _processAttachment(item);
  }

  _syncAttachUI();

  if (added) {
    requestAnimationFrame(() => { attachList.scrollLeft = attachList.scrollWidth; });
  }

  if (problems.length) {
    _showAttachNotice(problems.length === 1 ? problems[0] : `${problems[0]} (+${problems.length - 1} more skipped)`);
  } else if (added) {
    _hideAttachNotice();
  }
}

/* ── Wiring ── */

if (attachList) {
  /* Removing a chip must not steal focus (would open/close the keyboard) */
  const keepFocus = (e) => {
    if (e.target instanceof Element && e.target.closest('.attach-remove')) e.preventDefault();
  };

  attachList.addEventListener('pointerdown', keepFocus);
  attachList.addEventListener('mousedown', keepFocus);

  attachList.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('.attach-remove') : null;
    if (!btn) return;

    const chip = btn.closest('.attach-chip');
    const item = chip ? _attachItems.find((it) => String(it.id) === chip.dataset.id) : null;
    if (item) _removeAttachItem(item);
  });
}

[['pmPhoto', 'fileInputPhoto'], ['pmCamera', 'fileInputCamera'], ['pmFile', 'fileInputFile']].forEach(([btnId, inputId]) => {
  const btn = document.getElementById(btnId);
  const fi = document.getElementById(inputId);
  if (!btn || !fi) return;

  btn.addEventListener('click', () => fi.click());

  fi.addEventListener('change', () => {
    const files = Array.from(fi.files || []);
    fi.value = '';                       /* allow re-picking the same file */
    _addAttachments(files);
  });
});

window.AtkynAttach = {
  /* Prepared attachments in attach order; [] when none, none ready, or off the Answer tab */
  getReady() {
    if (!_onAiTab()) return [];
    return _attachItems
      .filter((it) => it.status === 'ready' && it.data)
      .map((it) => Object.assign({}, it.data));
  },
  isBusy() {
    return _onAiTab() && _attachItems.some((it) => it.status === 'processing');
  },
  clear: _clearAttachments,
  notify: _showAttachNotice
};

/* ════════════════════════════════
   CONTENT TRANSITION
   ════════════════════════════════ */

function _clearContentAnimation() {
  if (_contentFallback) {
    _contentFallback.cancel();
    _contentFallback = null;
  }

  if (!_contentAnimations.length) return;

  const list = _contentAnimations;
  _contentAnimations = [];

  list.forEach((anim) => {
    anim.onfinish = anim.oncancel = null;
    anim.cancel();
  });
}

function _animateContentIn() {
  if (!pageContent) return;

  _clearContentAnimation();

  if (_prefersReducedMotion || pageContent.style.display === 'none') return;

  if (typeof pageContent.animate !== 'function') {
    _contentFallback = _cssEnter(pageContent, 8, 280, 220, EASE.contentSwap, () => {
      _contentFallback = null;
    });
    return;
  }

  const track = (anim) => {
    anim.onfinish = anim.oncancel = () => {
      const i = _contentAnimations.indexOf(anim);
      if (i !== -1) _contentAnimations.splice(i, 1);
    };
    return anim;
  };

  /* 'backwards' fill: start state applies immediately, nothing is held after the end */
  _contentAnimations = [
    track(pageContent.animate(
      [{ transform: 'translateY(8px)' }, { transform: 'translateY(0)' }],
      { duration: 280, easing: EASE.contentSwap, fill: 'backwards' }
    )),
    track(pageContent.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 220, easing: 'ease-out', fill: 'backwards' }
    ))
  ];
}

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
    const cssReady = _loadModuleCSS(key);

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

    /* Styles settle with the script so the entrance never plays on unstyled content */
    await Promise.all([_moduleLoadPromises[key], cssReady]);

    if (!_isCurrentTabRequest(key, requestId)) return;
  } catch (_) {
    if (_isCurrentTabRequest(key, requestId)) {
      pageContent.innerHTML = '<div class="tab-empty"><p>Coming soon</p></div>';
    }
  }
}

/* Resolves on load or error: a missing stylesheet must not block the tab */
function _loadModuleCSS(key) {
  if (_cssPromises[key]) return _cssPromises[key];

  const id = `_atkyn_css_${key}`;

  if (document.getElementById(id)) {
    _cssPromises[key] = Promise.resolve();
    return _cssPromises[key];
  }

  _cssPromises[key] = new Promise((resolve) => {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `modules/${key}/${key}.css`;

    link.onload = link.onerror = () => {
      link.onload = link.onerror = null;
      resolve();
    };

    document.head.appendChild(link);
  });

  return _cssPromises[key];
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

let _activeTabEl = tabBar ? tabBar.querySelector('.tab.active') : null;

if (tabBar) {
  tabBar.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const tab = target ? target.closest('.tab') : null;

    if (!tab || tab.classList.contains('active')) return;

    const key = tab.getAttribute('data-tab');
    if (!key) return;

    const requestId = _nextTabLoadRequestId();

    /* Scroll position is captured now; serialization runs off the click path */
    if (_currentTabKey === 'ai') _queueChatSave();

    _clearContentAnimation();

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
      _cancelMessageScroll();
      _setScrollOwner('tab', true);
      scrollHost.scrollTop = 0;
      _lastScrollY = 0;
      resetScrollAccum();

      if (_tabScrollRafId) cancelAnimationFrame(_tabScrollRafId);

      _tabScrollRafId = requestAnimationFrame(() => {
        _tabScrollRafId = 0;
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

    _syncAttachUI();

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
