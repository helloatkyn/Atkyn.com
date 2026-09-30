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

const TRANSFORM_REST = '';
const KB_OPEN_MIN = 50;
/*
 * Theme geometry freeze: the chatbar transform is immutable from the theme event until the
 * viewport has produced THEME_STABLE_FRAMES identical probes (after at least THEME_MIN_FRAMES).
 * THEME_FREEZE_MAX_MS is an absolute safety cap (one-shot timer), never a mandatory delay.
 */
const THEME_MIN_FRAMES = 12;
const THEME_STABLE_FRAMES = 6;
const THEME_FREEZE_MAX_MS = 5000;

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

const vvp = window.visualViewport;

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
const _scrollOwners = { keyboard: false, message: false, tab: false };

let _velocityEMA = 0;
let _lastScrollTime = 0;
const VELOCITY_ALPHA = 0.3;

/* Keyboard / viewport */
let _keyboardOpen = false;
let _cleanupRafId = 0;
let _stableKbH = 0;
let _barHeight = chatbarWrap ? chatbarWrap.offsetHeight : 0;
let _rawTransform = '';
let _lastChatbarTransform = '';
let _keyboardStyleRestoreRaf = 0;
let _keyboardStyleToken = 0;
let _geomRaf = 0;
let _geomForce = false;
let _pendingSampleKey = '';
let _recoverRaf = 0;
let _barRO = null;
let _barROLive = false;
let _themeGuardActive = false;
let _themeGuardToken = 0;
let _themeGuardRaf = 0;
let _themeGuardTimer = 0;
let _themeDirty = false;
let _themeForce = false;

/* Chatbar entrance */
let _chatbarTransitionOwner = null;
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
    _scrollOwners.keyboard || _scrollOwners.message || _scrollOwners.tab;
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
   VIEWPORT MEASUREMENT
   ════════════════════════════════ */

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
  return _isEditableElement(document.activeElement);
}

function _measureBarHeight() {
  const rectH = chatbarWrap.getBoundingClientRect().height;
  return Number.isFinite(rectH) && rectH > 0
    ? Math.ceil(rectH)
    : chatbarWrap.offsetHeight;
}

/* Current total translateY on the element (keyboard + any running entrance) */
function _currentTranslateY(el) {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;

  try {
    return new DOMMatrixReadOnly(t).m42 || 0;
  } catch (_) {}

  const m = /^matrix(3d)?\((.+)\)$/.exec(t);
  if (!m) return 0;
  const v = m[2].split(',').map(Number);
  return (m[1] ? v[13] : v[5]) || 0;
}

/*
 * One synchronous read. rect.bottom and visualViewport.offsetTop + height are both in
 * layout-viewport coordinates. restBottom is the bar's untransformed layout bottom,
 * so the residual below the visual viewport is the only compensation still needed.
 */
function _readViewportSample() {
  const rect = chatbarWrap.getBoundingClientRect();
  const restBottom = rect.bottom - _currentTranslateY(chatbarWrap);
  const vvH = Number(vvp.height);
  const vvTop = Math.max(0, Number(vvp.offsetTop) || 0);
  const barH = rect.height > 0 ? Math.ceil(rect.height) : chatbarWrap.offsetHeight;

  return {
    restBottom,
    vvH,
    vvTop,
    barH,
    key: restBottom + '|' + vvTop + '|' + vvH
  };
}

function _measureKeyboardInset(s) {
  if (!Number.isFinite(s.restBottom) || !Number.isFinite(s.vvH) || s.vvH <= 0) return _stableKbH;

  const rawInset = Math.max(0, s.restBottom - (s.vvTop + s.vvH));

  if (_stableKbH <= 0) {
    return rawInset > KB_OPEN_MIN && _hasRelevantKeyboardFocus() ? Math.ceil(rawInset) : 0;
  }

  return rawInset < 1 ? 0 : Math.ceil(rawInset);
}

function _setSpacerHeight(h) {
  if (!chatSpacer || !Number.isFinite(h)) return;

  const px = Math.max(0, Math.ceil(h)) + 'px';
  if (chatSpacer.style.height !== px) chatSpacer.style.height = px;
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
  if (_chatbarTransitionOwner === 'entrance') _chatbarTransitionOwner = null;
}

function _startChatbarEntrance() {
  if (!chatbarWrap || _prefersReducedMotion) return;

  _chatbarTransitionOwner = 'entrance';

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

/* Keyboard takes the transform: keepFade lets the opacity finish */
function _cancelChatbarEntrance(keepFade) {
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

  if (_chatbarTransitionOwner === 'entrance') _chatbarTransitionOwner = null;
}

/* ════════════════════════════════
   CHATBAR / KEYBOARD POSITIONING
   ════════════════════════════════ */

function _cancelKeyboardRestoreRaf() {
  if (_keyboardStyleRestoreRaf) {
    cancelAnimationFrame(_keyboardStyleRestoreRaf);
    _keyboardStyleRestoreRaf = 0;
  }
}

/* Apply a pending transition restore immediately (used before lifecycle cancel) */
function _flushKeyboardRestore() {
  if (!_keyboardStyleRestoreRaf) return;

  _cancelKeyboardRestoreRaf();

  if (!_keyboardOpen && !_entranceMove && chatbarWrap) {
    chatbarWrap.style.transition = '';
    _chatbarTransitionOwner = null;
  }
}

function _scheduleKeyboardTransitionRestore(token) {
  _cancelKeyboardRestoreRaf();

  _keyboardStyleRestoreRaf = requestAnimationFrame(() => {
    _keyboardStyleRestoreRaf = 0;

    if (token !== _keyboardStyleToken || _keyboardOpen || !chatbarWrap) return;

    chatbarWrap.style.transition = '';
    _chatbarTransitionOwner = null;
  });
}

/* Instant: geometry follows VisualViewport frame by frame, never animated. Returns true when written. */
function _writeChatbarTransform(transform) {
  if (transform === _rawTransform && chatbarWrap.style.transform === _lastChatbarTransform) {
    return false;
  }

  _cancelKeyboardRestoreRaf();
  _keyboardStyleToken += 1;
  _chatbarTransitionOwner = 'keyboard';

  chatbarWrap.style.transition = 'none';
  chatbarWrap.style.transform = transform;
  _rawTransform = transform;
  _lastChatbarTransform = chatbarWrap.style.transform;
  return true;
}

function _keyboardTransform(kbHeight) {
  return `translateY(-${kbHeight}px)`;
}

/* Geometry scheduling: every trigger funnels into one rAF */
function _scheduleGeometry(force) {
  /* Frozen: only record that geometry is dirty; the freeze loop is the single scheduler */
  if (_themeGuardActive) {
    _themeDirty = true;
    if (force === true) _themeForce = true;
    return;
  }

  if (force === true) _geomForce = true;
  if (_geomRaf) return;

  const token = _themeGuardToken;

  _geomRaf = requestAnimationFrame(() => {
    _geomRaf = 0;

    /* A theme freeze started after this frame was queued: stale, hand over to the freeze */
    if (token !== _themeGuardToken || _themeGuardActive) {
      if (_themeGuardActive) {
        _themeDirty = true;
        if (_geomForce) _themeForce = true;
      }
      _geomForce = false;
      return;
    }

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

/* Observer only invalidates; the scheduler commits */
function _onBarResize() {
  if (!chatbarWrap) return;

  const h = _measureBarHeight();
  if (!(h > 0 && h !== _barHeight)) return;

  /* Frozen: record the new height and invalidate; never reposition the pill */
  if (_themeGuardActive) {
    _barHeight = h;
    _themeDirty = true;
    return;
  }

  _scheduleGeometry();
}

/*
 * pagehide disconnects the observer; a resume that never delivers pageshow(persisted) would leave it
 * dead for good. Every resume path funnels through this idempotent attach. The flag is needed because
 * observe() on an already-observed target restarts it and re-fires its initial notification.
 */
function _ensureBarObserved() {
  if (!_barRO || !chatbarWrap || _barROLive) return;

  _barROLive = true;
  _barRO.observe(chatbarWrap);
}

if (chatbarWrap && typeof ResizeObserver === 'function') {
  _barRO = new ResizeObserver(_onBarResize);
  _ensureBarObserved();
}

_startChatbarEntrance();

/* Sole writer of chatbar transform + spacer height */
function _applyViewport(force = false) {
  if (!vvp || !chatbarWrap) return;

  /* Frozen: no caller (rAF, recovery, external fixViewport(true)) may commit during a theme freeze */
  if (_themeGuardActive) {
    _themeDirty = true;
    if (force === true) _themeForce = true;
    return;
  }

  const sample = _readViewportSample();
  _barHeight = sample.barH;

  let kbHeight = _measureKeyboardInset(sample);
  const wasOpen = _stableKbH > 0;

  /* Open/closed flips need two identical samples, unless forced or a blur proves the close */
  const flips = (kbHeight > 0) !== wasOpen;
  const needsConfirm = flips && !force && !(wasOpen && !_hasRelevantKeyboardFocus());

  if (needsConfirm) {
    if (_pendingSampleKey === sample.key) {
      _pendingSampleKey = '';
    } else {
      _pendingSampleKey = sample.key;
      _scheduleGeometry();
      kbHeight = _stableKbH;
    }
  } else {
    _pendingSampleKey = '';
  }

  if (_entranceMove && kbHeight === 0) {
    _stableKbH = 0;
    _keyboardOpen = false;
    _setSpacerHeight(_barHeight);
    return;
  }

  if (!force && kbHeight === _stableKbH) {
    _keyboardOpen = kbHeight > 0;

    if (kbHeight > 0) _writeChatbarTransform(_keyboardTransform(kbHeight));

    _setSpacerHeight(_barHeight + kbHeight);
    return;
  }

  if (kbHeight > 0 && _entranceMove) _cancelChatbarEntrance(true);

  _stableKbH = kbHeight;
  _keyboardOpen = kbHeight > 0;

  if (kbHeight > 0) {
    _writeChatbarTransform(_keyboardTransform(kbHeight));
  } else if (_rawTransform !== '') {
    if (_writeChatbarTransform(TRANSFORM_REST)) {
      _scheduleKeyboardTransitionRestore(_keyboardStyleToken);
    }
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

/*
 * Theme change is a geometry invalidation, not a keyboard close.
 * Freeze: _applyViewport() refuses to commit, so the transform, _stableKbH and _keyboardOpen keep
 * their last confirmed values. A single rAF loop probes cheap viewport values; once they are
 * unchanged for THEME_STABLE_FRAMES frames the freeze releases through the normal commit path.
 */
function _cancelThemeGuard() {
  _themeGuardToken += 1;
  _themeGuardActive = false;
  _themeDirty = false;
  _themeForce = false;

  if (_themeGuardRaf) {
    cancelAnimationFrame(_themeGuardRaf);
    _themeGuardRaf = 0;
  }

  if (_themeGuardTimer) {
    clearTimeout(_themeGuardTimer);
    _themeGuardTimer = 0;
  }
}

function _themeProbeKey() {
  return vvp.height + '|' + vvp.offsetTop + '|' + chatbarWrap.offsetHeight + '|' +
    window.innerHeight + '|' + _stableKbH + '|' + _rawTransform + '|' + chatbarWrap.style.transform;
}

/*
 * Release: same task, no paint in between. The freeze state is cleared (token bumped so every
 * pre-release frame is stale), then ONE fresh measurement goes through the normal commit path.
 * Non-forced commit keeps the existing open/closed confirmation, so a lone "closed" sample
 * can never drop a confirmed-open keyboard; the transform is never cleared blindly.
 */
function _finishThemeGuard() {
  /* Exactly-once release: a second call would cancel the confirm frame the first release just queued */
  if (!_themeGuardActive) return;

  const force = _themeForce;

  _cancelThemeGuard();

  try {
    _cancelGeometryRaf();
    _applyViewport(force);
  } catch (_) {
    _scheduleGeometry(true);
  }
}

function _startThemeGuard() {
  if (!vvp || !chatbarWrap) return;

  const wasActive = _themeGuardActive;

  /* Invalidate every queued geometry frame and any previous freeze loop */
  _cancelGeometryRaf();
  if (_themeGuardRaf) {
    cancelAnimationFrame(_themeGuardRaf);
    _themeGuardRaf = 0;
  }
  _themeGuardToken += 1;
  _themeGuardActive = true;
  _themeDirty = false;

  /* Absolute cap counts from the first theme event; repeated events do not extend it */
  if (!wasActive || !_themeGuardTimer) {
    _themeGuardTimer = window.setTimeout(() => {
      _themeGuardTimer = 0;
      if (!_themeGuardActive) return;

      /*
       * rAF is paused while hidden, so the freeze loop cannot have released and the viewport of a
       * non-rendering page is not a valid fresh measurement. Drop the freeze without committing;
       * the visibility-return recovery does the fresh, validated commit.
       */
      if (document.visibilityState === 'hidden') {
        _cancelThemeGuard();
        return;
      }

      _finishThemeGuard();
    }, THEME_FREEZE_MAX_MS);
  }

  const token = _themeGuardToken;
  let frames = 0;
  let streak = 0;
  let lastKey = '';

  try {
    lastKey = _themeProbeKey();
  } catch (_) {}

  const tick = () => {
    _themeGuardRaf = 0;
    if (token !== _themeGuardToken || !_themeGuardActive) return;

    try {
      frames += 1;
      const key = _themeProbeKey();

      if (_themeDirty || key !== lastKey) {
        streak = 0;
        _themeDirty = false;
      } else {
        streak += 1;
      }
      lastKey = key;

      if (frames >= THEME_MIN_FRAMES && streak >= THEME_STABLE_FRAMES && !_entranceMove) {
        _finishThemeGuard();
        return;
      }

      _themeGuardRaf = requestAnimationFrame(tick);
    } catch (_) {
      _finishThemeGuard();
    }
  };

  _themeGuardRaf = requestAnimationFrame(tick);
}

function fixViewport(force = false) {
  if (!vvp || !chatbarWrap) return;

  /* Listeners may pass an Event; only an explicit true forces */
  if (force === true) {
    /* During a theme freeze this only records a forced, dirty request */
    if (!_themeGuardActive) _cancelGeometryRaf();
    _applyViewport(true);
    return;
  }

  _scheduleGeometry();
}

/* Resume: the viewport is republished a frame after visibility returns */
function _recoverViewportAfterLifecycle() {
  if (!vvp || !chatbarWrap || document.visibilityState === 'hidden') return;

  _ensureBarObserved();
  _cancelGeometryRaf();

  /* A freeze in progress stays authoritative; restart its stability count and let it release */
  if (_themeGuardActive) {
    _startThemeGuard();
    return;
  }

  if (_recoverRaf) cancelAnimationFrame(_recoverRaf);

  const token = _themeGuardToken;

  _recoverRaf = requestAnimationFrame(() => {
    _recoverRaf = requestAnimationFrame(() => {
      _recoverRaf = 0;
      if (token !== _themeGuardToken) return;
      if (document.visibilityState !== 'hidden') _applyViewport(true);
    });
  });
}

if (vvp) {
  vvp.addEventListener('resize', () => fixViewport(), { passive: true });
  vvp.addEventListener('scroll', () => fixViewport(), { passive: true });

  _setSpacerHeight(_barHeight);
  _applyViewport(true);
} else {
  const _legacyFix = () => {
    const h = window.innerHeight + 'px';
    if (document.body.style.height !== h) {
      document.body.style.height = h;
    }
  };

  window.addEventListener('resize', _legacyFix, { passive: true });
  _legacyFix();
  _setSpacerHeight(_barHeight);
}

/* Window resize / orientation complement VisualViewport */
window.addEventListener('resize', () => {
  if (vvp) fixViewport();
}, { passive: true });

window.addEventListener('orientationchange', () => {
  if (vvp) fixViewport();
}, { passive: true });

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
    _recoverViewportAfterLifecycle();
  } else {
    _flushChatSave();
  }
}, { passive: true });

window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;

  _ensureBarObserved();
  _recoverViewportAfterLifecycle();
}, { passive: true });

window.addEventListener('pagehide', () => {
  _flushChatSave();
  _cancelGeometryRaf();
  _cancelThemeGuard();
  _flushKeyboardRestore();

  if (_recoverRaf) {
    cancelAnimationFrame(_recoverRaf);
    _recoverRaf = 0;
  }

  if (_cleanupRafId) {
    cancelAnimationFrame(_cleanupRafId);
    _cleanupRafId = 0;
    _setScrollOwner('keyboard', false);
  }

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

  if (_barRO) {
    _barRO.disconnect();
    _barROLive = false;
  }
}, { passive: true });

/* ════════════════════════════════
   THEME / REDUCED-MOTION CHANGE
   ════════════════════════════════ */

if (window.matchMedia) {
  const themeMQ = window.matchMedia('(prefers-color-scheme: dark)');
  const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  const _onThemeChange = () => {
    _startThemeGuard();
    _scheduleGeometry();
  };

  const _onReducedMotionChange = (e) => {
    _prefersReducedMotion = e.matches;

    if (_prefersReducedMotion) {
      _cancelChatbarEntrance();
      _clearContentAnimation();
      _settlePlusMenu();
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
