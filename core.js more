'use strict';

/* ── Primitive aliases — safe wrappers for missing APIs in unusual environments ── */
let _prefersReducedMotion = !!(window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const EASE = {
  keyboardMove : 'cubic-bezier(0.32, 0.72, 0, 1)',
  menuOpen     : 'cubic-bezier(0.32, 0.72, 0, 1)',
  menuClose    : 'cubic-bezier(0.4, 0, 1, 1)',
  contentSwap  : 'cubic-bezier(0.16, 1, 0.3, 1)'
};

const _now = (window.performance && typeof window.performance.now === 'function')
  ? () => window.performance.now()
  : () => Date.now();

const _raf = typeof window.requestAnimationFrame === 'function'
  ? window.requestAnimationFrame.bind(window)
  : (cb) => window.setTimeout(() => cb(_now()), 16);

const _caf = typeof window.cancelAnimationFrame === 'function'
  ? window.cancelAnimationFrame.bind(window)
  : (id) => window.clearTimeout(id);

/* ── DOM references ── */
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
const chatArea     = document.getElementById('chatArea');
const _msgWrap     = document.getElementById('msgWrap');
const chatSpacer   = document.getElementById('chatSpacer');

const vvp = window.visualViewport || null;

// Read once as a scroll offset for message anchoring — never for chatbar geometry.
const _tabBarHeight = tabBar ? tabBar.offsetHeight : 0;

const SVG_SEND  = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="5 11 12 4 19 11"/></svg>';
const SVG_CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/* ════════════════════════════════
   SCROLL / HEADER STATE
════════════════════════════════ */

let _rafPending          = false;
let _lastScrollY         = 0;
let _accumDown           = 0;
let _accumUp             = 0;
let _isLogoCollapsed     = false;
let _isTabHidden         = false;
let _isTabScrolled       = false;
let _scrollRafId         = null;
let _programmaticScroll  = false;
let _programmaticUntil   = 0;
let _programmaticScrollToken = 0;
let _plusOpen            = false;
let _velocityEMA         = 0;
let _lastScrollTime      = 0;

const VELOCITY_ALPHA = 0.3;

function _programmaticActive(now) {
  return _programmaticScroll || (now || _now()) < _programmaticUntil;
}

function _endProgrammaticScroll() {
  _programmaticScroll = false;
  _programmaticUntil  = 0;
  if (scrollHost) _lastScrollY = scrollHost.scrollTop;
  _resetScrollAccum();
}

function _resetScrollAccum() {
  _accumDown      = 0;
  _accumUp        = 0;
  _velocityEMA    = 0;
  _lastScrollTime = 0;
}

/* ════════════════════════════════════════════════════════════════════
   UNIFIED VIEWPORT / CHATBAR GEOMETRY PIPELINE

   ONE owner for all chatbar geometry: _commitViewport().
   Every other subsystem may ONLY invalidate and schedule via _scheduleVP().

   Geometry model:
   • .chatbar-wrap — position:relative, flex-shrink:0, direct child of <body>.
     A flex sibling of #scrollHost, not a fixed overlay.
   • #chatSpacer — inside #chatArea inside #scrollHost (the scroll content).
   • #plusMenu / #plusBackdrop — position:fixed siblings. Translating the bar
     never clips or moves them.

   Ownership:
     BASE POSITION = CSS (flex column + env(safe-area-inset-bottom) padding).
     KEYBOARD LIFT = JS: transform:translateY(-inset) on .chatbar-wrap.
     CONTENT SPACE = JS: #chatSpacer height = bar height + keyboard inset.
     SAFE AREA     = CSS only — already inside the measured border-box.

   Inset is MEASURED, not modelled:
     inset = barBaseBottom − (vvp.offsetTop + vvp.height)
   Yields 0 on Android (interactive-widget=resizes-content already lifts the
   bar) and the real keyboard height on iOS Safari. Double-translation is
   structurally impossible because the measurement accounts for whatever CSS
   already did.
════════════════════════════════════════════════════════════════════ */

let _barHeight           = -1;
let _lastKbInset         = 0;
let _lastSpacerH         = -1;
let _lastTransformStr    = null;
let _kbOpen              = false;
let _kbArmed             = false;
let _lastViewportEventTs = 0;
let _viewportEventGap    = Infinity;
let _vpCommitCount       = 0;
let _geometryGeneration  = 0;
let _vpPending           = false;
let _vpRafId             = null;
let _cbTransitionTimer   = null;

const _VPReason = {
  VIEWPORT : 1,
  BAR_SIZE : 2,
  THEME    : 4,
  WINDOW   : 8,
  INIT     : 16
};
let _vpReasonFlags = 0;

// Hysteresis keeps sub-pixel rounding from causing a permanent lift.
// Two-frame confirmation on open prevents false positives from transient
// layout/visual-viewport disagreement (rotation, browser chrome animation).
const KB_OPEN_THRESH  = 12;  // px — closed→open gate
const KB_CLOSE_THRESH = 4;   // px — open→closed gate
const KB_STREAM_GAP   = 140; // ms — events within this interval = keyboard animation stream
const KB_CLAMP_RATIO  = 0.9; // inset may not exceed 90% of layout viewport height
const KB_MIN_VISIBLE  = 120; // px of layout viewport that must remain usable
const ANIM_OPEN_MS    = 350;
const ANIM_CLOSE_MS   = 280;

/* ── READ helpers ── */

function _layoutViewportHeight() {
  // documentElement.clientHeight tracks the layout viewport (ICB) reliably
  // without the innerHeight quirks some mobile browsers show mid-animation.
  const h = document.documentElement ? document.documentElement.clientHeight : 0;
  return h > 0 ? h : window.innerHeight;
}

function _measureBarBox() {
  if (!chatbarWrap) return { height: 0, baseBottom: 0 };

  // offsetHeight is the border-box height including CSS safe-area padding.
  // JS must never add safe-area on top — it is already counted here.
  const height = chatbarWrap.offsetHeight;

  // Walk the offsetParent chain to get the bar's untransformed top edge in
  // document coordinates. This is stable during keyboard open/close and theme
  // switches, unlike getBoundingClientRect() which can return a transitional
  // value mid-resize on Android (the bug that caused pill clipping on first
  // theme switch with keyboard open).
  let el  = chatbarWrap;
  let top = 0;
  while (el && el !== document.body && el !== document.documentElement) {
    top += el.offsetTop;
    el   = el.offsetParent;
  }

  // baseBottom is the untransformed bottom edge in layout-viewport coordinates.
  // Using offsetTop/offsetHeight instead of getBoundingClientRect means this
  // value is never affected by an in-flight CSS transform or a mid-resize
  // paint, so the inset calculation has no feedback loop.
  const scrollY    = window.scrollY || window.pageYOffset || 0;
  const baseBottom = top + height - scrollY;

  return { height: Math.round(height), baseBottom: Math.round(baseBottom) };
}

function _readKeyboard(box) {
  const layoutH = _layoutViewportHeight();

  if (!vvp || !(vvp.height > 0)) {
    // No VisualViewport API — keyboard compensation is impossible; stay neutral.
    _kbArmed = false;
    return { kbInset: 0, kbOpen: false, stream: false, deferred: false, layoutH };
  }

  // Measured displacement of the bar's real bottom edge below the visible
  // viewport bottom. Lifting the bar by exactly this amount brings the full
  // border-box back inside the visible area — half-clipped pill is impossible.
  const visualBottom = vvp.offsetTop + vvp.height;
  const raw          = Math.round(box.baseBottom - visualBottom);

  // Dense burst of VIEWPORT events = browser is currently animating the keyboard.
  // Follow it frame-by-frame; never add a competing CSS transition.
  const stream = _viewportEventGap <= KB_STREAM_GAP;

  let kbOpen   = false;
  let deferred = false;

  if (_kbOpen) {
    // Already open: track continuously, close only below hysteresis threshold.
    kbOpen   = raw >= KB_CLOSE_THRESH;
    _kbArmed = false;
  } else if (raw >= KB_OPEN_THRESH) {
    if (_kbArmed) {
      kbOpen   = true;  // second agreeing frame → confirmed open
      _kbArmed = false;
    } else {
      _kbArmed = true;  // first sighting → arm, confirm on next frame
      deferred = true;
    }
  } else {
    _kbArmed = false;
  }

  let kbInset = kbOpen ? raw : 0;

  // Safety clamps — a runaway inset must never push the bar off screen.
  const maxInset = Math.max(0, Math.min(layoutH * KB_CLAMP_RATIO, layoutH - KB_MIN_VISIBLE));
  if (kbInset > maxInset) {
    kbInset = Math.round(maxInset);
    if (kbInset < KB_CLOSE_THRESH) kbOpen = false;
  }
  if (kbInset < 0) kbInset = 0;

  return { kbInset, kbOpen, stream, deferred, layoutH };
}

/* ── Transition lifecycle ──
   Single cleanup timer: every arm cancels the previous.
   Timer only clears `transition` — never touches geometry. */
function _clearBarTransitionTimer() {
  if (_cbTransitionTimer !== null) {
    clearTimeout(_cbTransitionTimer);
    _cbTransitionTimer = null;
  }
}

function _endBarTransition() {
  _clearBarTransitionTimer();
  if (chatbarWrap) chatbarWrap.style.transition = '';
}

function _armBarTransitionCleanup(ms) {
  _clearBarTransitionTimer();
  _cbTransitionTimer = setTimeout(() => {
    _cbTransitionTimer = null;
    if (chatbarWrap) chatbarWrap.style.transition = '';
  }, ms + 60);
}

/* ── Pipeline gate — coalesces N invalidations into 1 commit per frame ── */
function _scheduleVP(reason) {
  _vpReasonFlags |= (reason | 0);
  if (_vpPending) return;
  _vpPending = true;
  _vpRafId   = _raf(_commitViewport);
}

/* ══════════════════════════════════════════════════════════════════
   _commitViewport — THE ONLY FUNCTION that writes chatbar geometry.

   Pattern: READ → CALCULATE → WRITE.
   No interleaved reads/writes, no forced layout inside a write,
   no magic timeouts affecting geometry, no transform accumulation.
══════════════════════════════════════════════════════════════════ */
function _commitViewport(now) {
  if (typeof now !== 'number') now = _now();

  _vpPending = false;
  _vpRafId   = null;

  const reasons      = _vpReasonFlags;
  _vpReasonFlags     = 0;

  if (!chatbarWrap) return;

  /* ── READ PHASE — all layout reads batched here, no writes yet ── */
  const box  = _measureBarBox();
  _barHeight = box.height;

  const kb = _readKeyboard(box);

  // Self-healing: if open detection was deferred to a second frame, guarantee
  // that frame even when the browser sends no further viewport events.
  // Terminates in exactly two commits (first: arm; second: confirm or disarm).
  if (kb.deferred) _scheduleVP(_VPReason.VIEWPORT);

  /* ── CALCULATE PHASE — pure, no DOM access ── */

  // Target always derived from clean base state — never accumulated.
  // translateY only, no translate3d: will-change:transform is intentionally
  // absent from chatbar.css because a promoted compositor layer clips the
  // pill's :focus-within box-shadow on some mobile WebKit builds.
  const targetTransformStr = kb.kbInset > 0
    ? 'translateY(' + (-kb.kbInset) + 'px)'
    : 'none';

  const transformChanged = targetTransformStr !== _lastTransformStr;
  const kbEdge           = kb.kbOpen !== _kbOpen;
  const spacerH          = _barHeight + kb.kbInset;
  const spacerChanged    = spacerH !== _lastSpacerH;

  if (!transformChanged && !spacerChanged) {
    // Nothing to write — keep committed state coherent.
    _kbOpen      = kb.kbOpen;
    _lastKbInset = kb.kbInset;
    return;
  }

  /* ── WRITE PHASE — transform and spacer land in the same frame ── */
  _geometryGeneration++;
  _vpCommitCount++;

  // Scroll anchor when keyboard first opens (scroll only, not geometry).
  if (kbEdge && kb.kbOpen) _anchorChatOnKeyboardOpen(now);

  if (spacerChanged && chatSpacer) {
    _lastSpacerH            = spacerH;
    chatSpacer.style.height = spacerH + 'px';
  }

  if (transformChanged) {
    _lastTransformStr = targetTransformStr;

    const geometryReset         = (reasons & (_VPReason.THEME | _VPReason.INIT)) !== 0;
    const viewportEvent         = (reasons & _VPReason.VIEWPORT) !== 0;
    const animInFlight          = chatbarWrap.style.transition !== '' &&
                                  chatbarWrap.style.transition !== 'none';
    // Animate only for a genuinely discrete keyboard jump — never during a
    // stream (browser already animating), a geometry reset, or mid-animation.
    const discreteKeyboardJump  = viewportEvent && !kb.stream && !geometryReset;
    const instant               = _prefersReducedMotion || !discreteKeyboardJump || animInFlight;

    if (instant) {
      _clearBarTransitionTimer();
      chatbarWrap.style.transition = 'none';
      chatbarWrap.style.transform  = targetTransformStr;
    } else {
      const durMs = kb.kbOpen ? ANIM_OPEN_MS : ANIM_CLOSE_MS;
      chatbarWrap.style.transition = 'transform ' + (durMs / 1000).toFixed(2) + 's ' + EASE.keyboardMove;
      chatbarWrap.style.transform  = targetTransformStr;
      _armBarTransitionCleanup(durMs);
    }
  }
  // When only the spacer changed: leave any in-flight transition alone.
  // It already targets the correct final transform; interrupting it would
  // snap a smooth, already-correct animation. The cleanup timer reclaims it.

  _kbOpen      = kb.kbOpen;
  _lastKbInset = kb.kbInset;
}

/* ── Scroll anchor on keyboard open — scroll state only, never geometry ── */
function _anchorChatOnKeyboardOpen(now) {
  if (!scrollHost) return;
  if (chatArea && chatArea.style.display === 'none') return;
  if (_programmaticActive(now)) return;

  _programmaticScroll = true;
  const anchor        = window._lastUserMsgEl;
  scrollHost.scrollTop = anchor
    ? Math.max(0, anchor.offsetTop - 16)
    : scrollHost.scrollHeight;
  _lastScrollY = scrollHost.scrollTop;
  _resetScrollAccum();

  // Synchronous hand-back + short settle grace window for browser scroll.
  _programmaticScroll = false;
  _programmaticUntil  = now + 400;
}

/* ════════════════════════════════
   VISUALVIEWPORT WIRING
   Events only mark the pipeline dirty — no geometry reads or writes.
════════════════════════════════ */

function _onViewportEvent() {
  const t              = _now();
  // Interval since the previous event: small gap = keyboard mid-animation (stream).
  _viewportEventGap    = _lastViewportEventTs ? (t - _lastViewportEventTs) : Infinity;
  _lastViewportEventTs = t;
  _scheduleVP(_VPReason.VIEWPORT);
}

if (vvp) {
  vvp.addEventListener('resize', _onViewportEvent, { passive: true });
  vvp.addEventListener('scroll', _onViewportEvent, { passive: true });
}

// Window-level invalidation covers orientation changes, layout viewport
// changes without a vvp event, and keyboards dismissed while backgrounded.
window.addEventListener('resize', () => _scheduleVP(_VPReason.WINDOW), { passive: true });
window.addEventListener('orientationchange', () => _scheduleVP(_VPReason.WINDOW), { passive: true });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Reset cadence so first post-foreground event is never treated as a stream.
    _lastViewportEventTs = 0;
    _viewportEventGap    = Infinity;
    _scheduleVP(_VPReason.WINDOW);
  }
});

/* ════════════════════════════════
   RESIZEOBSERVER — bar height
   Reads from RO entry (no forced layout), compares, invalidates.
   Never writes geometry directly — cannot feed itself.
════════════════════════════════ */

if (chatbarWrap && typeof ResizeObserver === 'function') {
  const _barRO = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;

    // Read from the entry itself to avoid a forced layout in the callback.
    const bs      = entry.borderBoxSize;
    const newH    = bs
      ? (bs[0] ? bs[0].blockSize : (typeof bs.blockSize === 'number' ? bs.blockSize : 0))
      : entry.contentRect.height;
    const rounded = Math.round(newH);

    if (rounded === _barHeight) return;
    _scheduleVP(_VPReason.BAR_SIZE);
  });
  _barRO.observe(chatbarWrap);
}

/* ════════════════════════════════
   THEME / PREFERENCE CHANGE
   CSS owns all visual theme changes.
   JS only invalidates geometry caches after theme re-applies.
════════════════════════════════ */

function _invalidateGeometryCache() {
  // Forces the next commit to re-measure rather than short-circuit on dedup.
  // Rewrites the SAME derived values — causes re-validation, not movement.
  _lastTransformStr = null;
  _lastSpacerH      = -1;
  _geometryGeneration++;
}

if (window.matchMedia) {
  let _themeMQ         = null;
  let _reducedMotionMQ = null;
  try { _themeMQ         = window.matchMedia('(prefers-color-scheme: dark)'); }      catch (_e) {}
  try { _reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (_e) {}

  const _onThemeChange = () => {
    _endBarTransition();
    // FIX: Reset _kbArmed so a partially-armed keyboard detection from before
    // the theme switch cannot combine with an unstable baseBottom during the
    // first theme-commit frame to produce a wrong large translateY (pill clip).
    _kbArmed = false;
    _invalidateGeometryCache();
    _scheduleVP(_VPReason.THEME);
    // Two-rAF re-validation: first rAF lets the browser apply the new theme's
    // style recalc; second rAF catches late font/metric changes.
    _raf(() => { _raf(() => _scheduleVP(_VPReason.THEME)); });
  };

  const _onReducedMotionChange = (e) => {
    _prefersReducedMotion = !!(e && e.matches);
    _endBarTransition();

    // FIX: Guard timer clear unconditionally, regardless of plusMenu presence,
    // to prevent timer leak when plusMenu is null but _plusOpen is true.
    if (_plusOpen) {
      if (_plusMenuTimer !== null) { clearTimeout(_plusMenuTimer); _plusMenuTimer = null; }
      if (plusMenu) {
        plusMenu.style.transition = 'none';
        plusMenu.style.transform  = '';
        plusMenu.style.opacity    = '';
      }
    }

    _invalidateGeometryCache();
    _scheduleVP(_VPReason.THEME);
  };

  if (_themeMQ) {
    if (_themeMQ.addEventListener)   _themeMQ.addEventListener('change', _onThemeChange);
    else if (_themeMQ.addListener)   _themeMQ.addListener(_onThemeChange);
  }
  if (_reducedMotionMQ) {
    if (_reducedMotionMQ.addEventListener) _reducedMotionMQ.addEventListener('change', _onReducedMotionChange);
    else if (_reducedMotionMQ.addListener) _reducedMotionMQ.addListener(_onReducedMotionChange);
  }
}

/* ════════════════════════════════
   INIT — first paint
════════════════════════════════ */

(function _init() {
  if (chatbarWrap) {
    // Clear any inline style left by a previous build so first committed
    // geometry is the first thing the user sees.
    if (chatbarWrap.style.opacity === '0') chatbarWrap.style.opacity = '';
    chatbarWrap.style.transition = '';
    _clearBarTransitionTimer();
  }

  // Double rAF: first frame lets stylesheets and fonts settle into the box
  // model; second frame is the actual paint in which geometry is committed.
  _raf(() => { _raf(() => { _scheduleVP(_VPReason.INIT); }); });

  // Safety net: if rAF was throttled (background tab, aggressive power saving),
  // the first user interaction forces one synchronous commit so the bar can
  // never be left in an uncommitted state before the user touches anything.
  const _recoverOnce = () => {
    window.removeEventListener('pointerdown', _recoverOnce, true);
    window.removeEventListener('keydown',     _recoverOnce, true);
    if (_vpCommitCount > 0) return;
    if (_vpRafId !== null) { _caf(_vpRafId); _vpRafId = null; }
    _vpPending = false;
    _commitViewport(_now());
  };
  window.addEventListener('pointerdown', _recoverOnce, true);
  window.addEventListener('keydown',     _recoverOnce, true);
})();

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

  // FIX: If a previous smooth scroll is still in progress, end it cleanly
  // before starting a new one so _programmaticScroll cannot get stuck true
  // when rapid successive calls cause token mismatches in the cleanup timeout.
  if (_programmaticScroll) _endProgrammaticScroll();

  if (_scrollRafId !== null) {
    _caf(_scrollRafId);
    _scrollRafId = null;
  }

  const requestToken = ++_programmaticScrollToken;

  _scrollRafId = _raf(() => {
    _scrollRafId = null;
    if (requestToken !== _programmaticScrollToken) return;

    _programmaticScroll = true;
    _programmaticUntil  = 0;
    const target = Math.max(0, el.offsetTop - _tabBarHeight - 8);

    if (_prefersReducedMotion) {
      scrollHost.scrollTop = target;
      _endProgrammaticScroll();
      return;
    }

    scrollHost.scrollTo({ top: target, behavior: 'smooth' });
    _lastScrollY = target;
    _resetScrollAccum();

    window.setTimeout(() => {
      if (requestToken !== _programmaticScrollToken) return;
      _endProgrammaticScroll();
    }, 450);
  });
}

window.scrollToMsg = scrollToMsg;

/* ════════════════════════════════
   HEADER / TAB SCROLL ANIMATION
   No layout reads beyond scrollTop. Normal scrolling never triggers
   a chatbar geometry commit.
════════════════════════════════ */

const HIDE_ACCUM  = 40;
const SHOW_ACCUM  = 55;
const LOGO_THRESH = 10;

function _updateHeader(now) {
  _rafPending = false;
  if (!scrollHost || !logoHeader || !tabBar) return;

  now = now || _now();
  if (_programmaticActive(now)) {
    _lastScrollY = scrollHost.scrollTop;
    _resetScrollAccum();
    return;
  }

  const sy    = scrollHost.scrollTop;
  const delta = sy - _lastScrollY;
  if (delta === 0) return;

  const dt = Math.max(1, now - _lastScrollTime);
  _velocityEMA = _velocityEMA === 0
    ? delta / dt
    : _velocityEMA * (1 - VELOCITY_ALPHA) + (delta / dt) * VELOCITY_ALPHA;

  _lastScrollY    = sy;
  _lastScrollTime = now;

  if (sy <= LOGO_THRESH) {
    _resetScrollAccum();
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

if (scrollHost) {
  scrollHost.addEventListener('scroll', () => {
    if (_programmaticActive()) {
      _lastScrollY = scrollHost.scrollTop;
      return;
    }
    if (!_rafPending) {
      _rafPending = true;
      _raf(_updateHeader);
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
    if (document.activeElement === input || _kbOpen || _lastKbInset > 0) return;

    e.preventDefault();
    _raf(() => {
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
    // Bar-height changes from input growth are reported by ResizeObserver.
  });
}

/* ════════════════════════════════
   PLUS MENU
════════════════════════════════ */

let _plusMenuTimer = null;

function openPlusMenu() {
  if (!plusBtn || !plusMenu || !plusBackdrop || _plusOpen) return;

  _plusOpen = true;
  if (_plusMenuTimer !== null) { clearTimeout(_plusMenuTimer); _plusMenuTimer = null; }

  plusBackdrop.classList.add('open');
  plusMenu.classList.add('open');

  if (_prefersReducedMotion) {
    plusMenu.style.transition = '';
    plusMenu.style.transform  = '';
    plusMenu.style.opacity    = '';
    return;
  }

  plusMenu.style.transition = 'none';
  plusMenu.style.transform  = 'scale(0.88) translateY(10px)';
  plusMenu.style.opacity    = '0';

  void plusMenu.offsetWidth; // flush styles before animating

  plusMenu.style.transition = 'transform 0.3s ' + EASE.menuOpen + ', opacity 0.2s ease-out';
  plusMenu.style.transform  = 'scale(1) translateY(0)';
  plusMenu.style.opacity    = '1';

  _plusMenuTimer = setTimeout(() => {
    _plusMenuTimer = null;
    if (!_plusOpen || !plusMenu) return;
    plusMenu.style.transition = '';
    plusMenu.style.transform  = '';
    plusMenu.style.opacity    = '';
  }, 350);
}

function closePlusMenu() {
  if (!_plusOpen || !plusMenu || !plusBackdrop) return;

  _plusOpen = false;
  if (_plusMenuTimer !== null) { clearTimeout(_plusMenuTimer); _plusMenuTimer = null; }

  plusBackdrop.classList.remove('open');

  if (_prefersReducedMotion) {
    plusMenu.classList.remove('open');
    plusMenu.style.transition = '';
    plusMenu.style.transform  = '';
    plusMenu.style.opacity    = '';
    return;
  }

  plusMenu.style.transition = 'transform 0.22s ' + EASE.menuClose + ', opacity 0.18s ease-in';
  plusMenu.style.transform  = 'scale(0.88) translateY(10px)';
  plusMenu.style.opacity    = '0';

  _plusMenuTimer = setTimeout(() => {
    _plusMenuTimer = null;
    if (_plusOpen || !plusMenu) return;
    plusMenu.classList.remove('open');
    plusMenu.style.transition = '';
    plusMenu.style.transform  = '';
    plusMenu.style.opacity    = '';
  }, 250);
}

if (plusBtn) {
  plusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _plusOpen ? closePlusMenu() : openPlusMenu();
  });
}

if (plusBackdrop) plusBackdrop.addEventListener('click', closePlusMenu);

if (plusMenu || plusBtn) {
  document.addEventListener('click', (e) => {
    if (!_plusOpen) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    if ((plusMenu && plusMenu.contains(target)) || (plusBtn && plusBtn.contains(target))) return;
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
   TAB BAR
════════════════════════════════ */

let _currentTabKey = (() => {
  if (!tabBar) return 'ai';
  const a = tabBar.querySelector('.tab.active');
  return a ? a.getAttribute('data-tab') : 'ai';
})();

const _moduleCache        = {};
const _moduleLoadPromises = {};
const _scriptLoadPromises = {};
let   _tabLoadRequestId   = 0;

function _nextTabLoadRequestId() { return ++_tabLoadRequestId; }

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
      _moduleLoadPromises[key] = _loadScript('modules/' + key + '/' + key + '.js')
        .then(() => { _moduleCache[key] = true; })
        .catch((err) => { delete _moduleLoadPromises[key]; throw err; });
    }

    await _moduleLoadPromises[key];
    if (!_isCurrentTabRequest(key, requestId)) return;

  } catch (err) {
    if (_isCurrentTabRequest(key, requestId)) {
      pageContent.innerHTML = '<div class="tab-empty"><p>Coming soon</p></div>';
    }
    console.warn('[atkyn] Tab module load failed:', key, err);
  }
}

function _loadModuleCSS(key) {
  const id = '_atkyn_css_' + key;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id   = id;
  link.rel  = 'stylesheet';
  link.href = 'modules/' + key + '/' + key + '.css';
  document.head.appendChild(link);
}

function _loadScript(src) {
  if (_scriptLoadPromises[src]) return _scriptLoadPromises[src];
  _scriptLoadPromises[src] = new Promise((resolve, reject) => {
    const s   = document.createElement('script');
    s.src     = src;
    s.async   = true;
    const cleanup = () => { s.onload = null; s.onerror = null; };
    s.onload  = () => { cleanup(); resolve(); };
    s.onerror = (err) => { cleanup(); delete _scriptLoadPromises[src]; reject(err); };
    document.head.appendChild(s);
  });
  return _scriptLoadPromises[src];
}

/* ── Content swap animation ── */
let _contentAnimTimer = null;

function _animateContentIn() {
  if (!pageContent) return;

  if (_contentAnimTimer !== null) { clearTimeout(_contentAnimTimer); _contentAnimTimer = null; }

  if (_prefersReducedMotion) {
    pageContent.style.opacity    = '';
    pageContent.style.transform  = '';
    pageContent.style.transition = '';
    return;
  }

  pageContent.style.transition = 'none';
  pageContent.style.opacity    = '0';
  pageContent.style.transform  = 'translateY(8px)';

  void pageContent.offsetWidth; // flush before animating

  pageContent.style.transition = 'opacity 0.22s ease-out, transform 0.28s ' + EASE.contentSwap;
  pageContent.style.opacity    = '1';
  pageContent.style.transform  = 'translateY(0)';

  _contentAnimTimer = setTimeout(() => {
    _contentAnimTimer = null;
    if (!pageContent) return;
    pageContent.style.transition = '';
    pageContent.style.opacity    = '';
    pageContent.style.transform  = '';
  }, 320);
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

    // Persist AI chat state before leaving.
    if (_currentTabKey === 'ai' && _msgWrap) {
      try {
        sessionStorage.setItem('atkyn_chat_html',   _msgWrap.innerHTML);
        sessionStorage.setItem('atkyn_chat_scroll', String(scrollHost ? scrollHost.scrollTop : 0));
      } catch (_e) {}
    }

    if (_activeTabEl) _activeTabEl.classList.remove('active');
    tab.classList.add('active');
    _activeTabEl   = tab;
    _currentTabKey = key;

    let q = '';
    try { q = sessionStorage.getItem('atkyn_last_query') || ''; } catch (_e) {}

    if (key === 'ai') {
      if (input) input.value = '';
      if (pill)  { pill.classList.remove('has-text'); pill.classList.remove('non-ai-tab'); }
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
      _programmaticUntil   = 0;
      scrollHost.scrollTop = 0;
      _lastScrollY         = 0;
      _resetScrollAccum();

      _raf(() => {
        // FIX: Unconditionally clear _programmaticScroll before the guard check.
        // If a second tab click fires before this rAF, the old requestId is
        // stale and the guard would return early — leaving _programmaticScroll
        // permanently true, which silently kills header scroll updates.
        _programmaticScroll = false;
        if (requestId !== _tabLoadRequestId || !scrollHost) return;
        _lastScrollY = scrollHost.scrollTop;
      });
    }

    // FIX: Reset _kbArmed on tab switch. If the keyboard was mid-detection
    // (armed but not yet confirmed) when the user switched tabs, a stale armed
    // state could combine with a changed baseBottom after content swap to
    // produce a spurious keyboard open on the next commit.
    _kbArmed = false;

    // Reset header state on tab switch.
    if (logoHeader && _isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
    if (tabBar && _isTabHidden)         { tabBar.classList.remove('hide');          _isTabHidden     = false; }
    if (tabBar && _isTabScrolled)       { tabBar.classList.remove('scrolled');      _isTabScrolled   = false; }

    // Invalidate geometry before and after the swap — toggling display and
    // injecting a module stylesheet can both change the chatbar's measured box.
    _scheduleVP(_VPReason.WINDOW);

    await _loadTab(key, requestId);

    _scheduleVP(_VPReason.WINDOW);

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

window._atkynViewportDebug = () => ({
  barHeight     : _barHeight,
  kbInset       : _lastKbInset,
  kbOpen        : _kbOpen,
  kbArmed       : _kbArmed,
  transform     : _lastTransformStr,
  spacer        : _lastSpacerH,
  commits       : _vpCommitCount,
  pending       : _vpPending,
  reasons       : _vpReasonFlags,
  generation    : _geometryGeneration,
  eventGap      : _viewportEventGap,
  transition    : chatbarWrap ? chatbarWrap.style.transition : null,
  reducedMotion : _prefersReducedMotion
});
