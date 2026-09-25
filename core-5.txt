'use strict';

/* ONE owner for chatbar geometry: _commitViewport().
   All other subsystems only invalidate + schedule.
   Commit cycle: READ → CALCULATE → WRITE (no interleaved reads/writes). */

// ── Preferences ──────────────────────────────────────────────────────────────

let _prefersReducedMotion = !!(window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const EASE = {
  keyboardMove : 'cubic-bezier(0.32, 0.72, 0, 1)',
  menuOpen     : 'cubic-bezier(0.32, 0.72, 0, 1)',
  menuClose    : 'cubic-bezier(0.4, 0, 1, 1)',
  contentSwap  : 'cubic-bezier(0.16, 1, 0.3, 1)'
};

// ── Primitives (defensive fallbacks for unusual embedders) ───────────────────

const _now = (window.performance && typeof window.performance.now === 'function')
  ? () => window.performance.now()
  : () => Date.now();

const _raf = typeof window.requestAnimationFrame === 'function'
  ? window.requestAnimationFrame.bind(window)
  : (cb) => window.setTimeout(() => cb(_now()), 16);

const _caf = typeof window.cancelAnimationFrame === 'function'
  ? window.cancelAnimationFrame.bind(window)
  : (id) => window.clearTimeout(id);

// ── DOM references (all null-guarded at point of use) ───────────────────────

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

// Read once — only used as a scroll offset for message anchoring, never for
// chatbar geometry (chatbar height is always measured live).
const _tabBarHeight = tabBar ? tabBar.offsetHeight : 0;

const SVG_SEND  = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="5 11 12 4 19 11"/></svg>';
const SVG_CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// ── Scroll / header state ────────────────────────────────────────────────────

let _rafPending            = false;
let _lastScrollY           = 0;
let _accumDown             = 0;
let _accumUp               = 0;
let _isLogoCollapsed       = false;
let _isTabHidden           = false;
let _isTabScrolled         = false;
let _scrollRafId           = null;
let _programmaticScroll    = false;
let _programmaticUntil     = 0;
let _programmaticScrollToken = 0;
let _plusOpen              = false;
let _velocityEMA           = 0;
let _lastScrollTime        = 0;

const VELOCITY_ALPHA = 0.3;

function _programmaticActive(now) {
  return _programmaticScroll || (now || _now()) < _programmaticUntil;
}

function _endProgrammaticScroll() {
  _programmaticScroll = false;
  _programmaticUntil  = 0;
  if (scrollHost) _lastScrollY = scrollHost.scrollTop;
  resetScrollAccum();
}

function resetScrollAccum() {
  _accumDown      = 0;
  _accumUp        = 0;
  _velocityEMA    = 0;
  _lastScrollTime = 0;
}

// ── Viewport / chatbar geometry pipeline ─────────────────────────────────────
//
// Model (no double translation):
//   CSS positions the bar (incl. env(safe-area-inset-bottom)).
//   JS adds ONE compensation: translate3d(0, -keyboardInset, 0)
//   spacer = measured chatbar height + keyboardInset

let _barHeight        = -1;
let _barHeightStale   = true;
let _lastKbInset      = 0;
let _lastSpacerH      = -1;
let _lastTransformStr = null;
let _kbOpen           = false;
let _lastLayoutH      = 0;
let _lastViewportEventTs = 0;
let _viewportEventGap    = Infinity;
let _vpCommitCount    = 0;
let _geometryGeneration = 0;

let _vpPending   = false;
let _vpRafId     = null;
let _cbTransitionTimer = null;

const _VPReason = {
  VIEWPORT : 1,
  BAR_SIZE : 2,
  THEME    : 4,
  WINDOW   : 8,
  INIT     : 16
};
let _vpReasonFlags = 0;

// Keyboard detection tuning.
// raw = layoutH - (vvp.offsetTop + vvp.height): correctly discriminates between
// keyboard displacement (layout fixed, visual shrinks) and chrome/rotation
// (both change together → raw ≈ 0 → no compensation).
const KB_OPEN_THRESH  = 40;
const KB_CLOSE_THRESH = 20;
const KB_STREAM_GAP   = 140; // ms — consecutive events within this window = stream
const KB_CLAMP_RATIO  = 0.9;
const KB_MIN_VISIBLE  = 120;
const ANIM_OPEN_MS    = 350;
const ANIM_CLOSE_MS   = 280;

// ── READ helpers ─────────────────────────────────────────────────────────────

function _layoutViewportHeight() {
  // documentElement.clientHeight tracks the ICB without innerHeight quirks.
  const h = document.documentElement ? document.documentElement.clientHeight : 0;
  return h > 0 ? h : window.innerHeight;
}

function _measureBar() {
  if (!chatbarWrap) return 0;
  return Math.round(chatbarWrap.offsetHeight);
}

function _readKeyboard() {
  const layoutH = _layoutViewportHeight();
  const layoutShifted = _lastLayoutH > 0 && layoutH !== _lastLayoutH;
  _lastLayoutH = layoutH;

  if (!vvp || !(vvp.height > 0)) {
    return { kbInset: 0, kbOpen: false, stream: false, layoutH };
  }

  const raw    = Math.round(layoutH - (vvp.offsetTop + vvp.height));
  const stream = _viewportEventGap <= KB_STREAM_GAP;

  let kbOpen;
  if (_kbOpen) {
    // Already open: track real value; hysteresis only decides genuine close.
    kbOpen = raw >= KB_CLOSE_THRESH;
  } else if (raw >= KB_OPEN_THRESH) {
    // Closed → open: require stable layout viewport (rotation / chrome guard).
    kbOpen = !layoutShifted;
  } else {
    kbOpen = false;
  }

  let kbInset = kbOpen ? raw : 0;

  // Safety clamp — never push bar off screen.
  const maxInset = Math.max(0, Math.min(layoutH * KB_CLAMP_RATIO, layoutH - KB_MIN_VISIBLE));
  if (kbInset > maxInset) {
    kbInset = Math.round(maxInset);
    if (kbInset < KB_CLOSE_THRESH) kbOpen = false;
  }
  if (kbInset < 0) kbInset = 0;

  return { kbInset, kbOpen, stream, layoutH };
}

// ── Transition hygiene (animation only — never geometry) ─────────────────────

function _clearBarTransitionTimer() {
  if (_cbTransitionTimer) {
    clearTimeout(_cbTransitionTimer);
    _cbTransitionTimer = null;
  }
}

function _endBarTransition() {
  _clearBarTransitionTimer();
  if (chatbarWrap && chatbarWrap.style.transition) {
    chatbarWrap.style.transition = '';
  }
}

function _armBarTransitionCleanup(gen, ms) {
  _clearBarTransitionTimer();
  _cbTransitionTimer = setTimeout(() => {
    _cbTransitionTimer = null;
    // Stale-callback guard: a newer commit owns transition state.
    if (gen !== _geometryGeneration) return;
    if (chatbarWrap) chatbarWrap.style.transition = '';
  }, ms + 60);
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

function _scheduleVP(reason) {
  _vpReasonFlags |= (reason || 0);
  if (_vpPending) return;
  _vpPending = true;
  _vpRafId   = _raf(_commitViewport);
}

function _commitViewport(now) {
  if (typeof now !== 'number') now = _now();

  _vpPending     = false;
  _vpRafId       = null;
  const reasons  = _vpReasonFlags;
  _vpReasonFlags = 0;

  if (!chatbarWrap) return;

  // ── READ PHASE ──────────────────────────────────────────────────────────────

  const sizeDirty =
    _barHeightStale ||
    (reasons & (_VPReason.BAR_SIZE | _VPReason.THEME | _VPReason.INIT | _VPReason.WINDOW)) !== 0;

  if (sizeDirty) {
    _barHeight      = _measureBar();
    _barHeightStale = false;
  }

  const kb = _readKeyboard();

  // ── CALCULATE PHASE ─────────────────────────────────────────────────────────

  // Always derived from clean base — no accumulation ever.
  const targetTransformStr = 'translate3d(0,' + (-kb.kbInset) + 'px,0)';
  const transformChanged   = targetTransformStr !== _lastTransformStr;
  const kbEdge             = kb.kbOpen !== _kbOpen;
  const spacerH            = _barHeight + kb.kbInset;
  const spacerChanged      = spacerH !== _lastSpacerH;

  if (!transformChanged && !spacerChanged) {
    _kbOpen      = kb.kbOpen;
    _lastKbInset = kb.kbInset;
    return;
  }

  // ── WRITE PHASE ─────────────────────────────────────────────────────────────
  // Transform + spacer land in the same frame — they can never disagree.

  const gen = ++_geometryGeneration;
  _vpCommitCount++;

  if (kbEdge && kb.kbOpen) {
    _anchorChatOnKeyboardOpen(now);
  }

  if (spacerChanged && chatSpacer) {
    _lastSpacerH = spacerH;
    chatSpacer.style.height = spacerH + 'px';
  }

  if (transformChanged) {
    _lastTransformStr = targetTransformStr;

    const geometryReset     = (reasons & (_VPReason.THEME | _VPReason.INIT)) !== 0;
    const viewportEvent     = (reasons & _VPReason.VIEWPORT) !== 0;
    const animInFlight      = chatbarWrap.style.transition !== '' &&
                              chatbarWrap.style.transition !== 'none';
    const discreteKbJump    = viewportEvent && !kb.stream && !geometryReset;
    // Instant when: reduced-motion, geometry revalidation, non-viewport event,
    // continuous stream (browser is animating), or a transition already in flight.
    const instant = _prefersReducedMotion || !discreteKbJump || animInFlight;

    if (instant) {
      _clearBarTransitionTimer();
      if (chatbarWrap.style.transition !== 'none') chatbarWrap.style.transition = 'none';
      chatbarWrap.style.transform = targetTransformStr;
    } else {
      // Discrete jump (typical Android): animate to the already-final target.
      const durMs = kb.kbOpen ? ANIM_OPEN_MS : ANIM_CLOSE_MS;
      chatbarWrap.style.transition = 'transform ' + (durMs / 1000).toFixed(2) + 's ' + EASE.keyboardMove;
      chatbarWrap.style.transform  = targetTransformStr;
      _armBarTransitionCleanup(gen, durMs);
    }
  }
  // When only spacer changed: leave any in-flight transition alone — it is
  // already targeting the correct final transform and will be cleaned up by
  // the armed timer.

  _kbOpen      = kb.kbOpen;
  _lastKbInset = kb.kbInset;
}

// ── Scroll anchoring on keyboard open (scroll only — no chatbar geometry) ────

function _anchorChatOnKeyboardOpen(now) {
  if (!scrollHost) return;
  if (chatArea && chatArea.style.display === 'none') return;
  if (_programmaticActive(now)) return;

  _programmaticScroll = true;
  const anchor = window._lastUserMsgEl;
  scrollHost.scrollTop = anchor
    ? Math.max(0, anchor.offsetTop - 16)
    : scrollHost.scrollHeight;
  _lastScrollY = scrollHost.scrollTop;
  resetScrollAccum();

  // Synchronous hand-back + settle grace window.
  _programmaticScroll = false;
  _programmaticUntil  = now + 400;
}

// ── VisualViewport wiring ─────────────────────────────────────────────────────
// Events only mark the pipeline dirty — no geometry reads/writes here.

function _onViewportEvent() {
  const t = _now();
  // Interval between consecutive events: small gap = stream, large gap = discrete jump.
  _viewportEventGap    = _lastViewportEventTs ? (t - _lastViewportEventTs) : Infinity;
  _lastViewportEventTs = t;
  _scheduleVP(_VPReason.VIEWPORT);
}

if (vvp) {
  vvp.addEventListener('resize', _onViewportEvent, { passive: true });
  vvp.addEventListener('scroll', _onViewportEvent, { passive: true });
} else {
  // Fallback: no VisualViewport API. Pin body height to innerHeight so CSS
  // bottom-anchoring still resolves, then run the same cadence tracking.
  const _legacyFix = () => {
    const h = window.innerHeight + 'px';
    if (document.body && document.body.style.height !== h) document.body.style.height = h;
    _onViewportEvent();
  };
  window.addEventListener('resize', _legacyFix, { passive: true });
  _legacyFix();
}

// Window-level / lifecycle invalidation (covers cases observers can miss).
window.addEventListener('resize', () => _scheduleVP(_VPReason.WINDOW), { passive: true });

window.addEventListener('orientationchange', () => {
  _barHeightStale = true;
  _scheduleVP(_VPReason.WINDOW);
}, { passive: true });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    _barHeightStale      = true;
    // Reset cadence so first event after foregrounding is never mistaken for a stream.
    _lastViewportEventTs = 0;
    _viewportEventGap    = Infinity;
    _scheduleVP(_VPReason.WINDOW);
  }
});

// ── ResizeObserver — bar height invalidation only ────────────────────────────

if (chatbarWrap && typeof ResizeObserver === 'function') {
  const _barRO = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;

    // Read from entry to avoid a forced layout.
    const bs   = entry.borderBoxSize;
    const newH = bs
      ? (bs[0] ? bs[0].blockSize : bs.blockSize)
      : entry.contentRect.height;
    const rounded = Math.round(newH);

    // Only invalidate on a real change — this observer never writes styles
    // so it cannot feed itself, but the compare prevents spurious RAF queuing.
    if (rounded === _barHeight && !_barHeightStale) return;
    _scheduleVP(_VPReason.BAR_SIZE);
  });
  _barRO.observe(chatbarWrap);
}

// A spacer height write landing in the same frame as a RO observation is
// reported as a loop limit even when values are deduped — it carries no error
// state and must not pollute the console or hide real errors.
window.addEventListener('error', (e) => {
  if (e && e.message && String(e.message).indexOf('ResizeObserver loop') === 0) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

// ── Theme / preference change ─────────────────────────────────────────────────
// System preference is the ONLY theme source. CSS handles visuals; JS only
// re-validates geometry after the new styles have been applied.
// Theme changes must NOT reset keyboard state — inset is recomputed from live
// VisualViewport values, so a switch while the keyboard is open keeps the inset.

function _invalidateGeometryCache() {
  _barHeightStale   = true;
  // Clear write-dedupe caches so the next commit re-validates from fresh reads.
  // Values are recomputed identically (not from cache), so no visible movement.
  _lastTransformStr = null;
  _lastSpacerH      = -1;
  _geometryGeneration++; // orphan any in-flight transition cleanup timer
}

if (window.matchMedia) {
  let themeMQ         = null;
  let reducedMotionMQ = null;
  try { themeMQ         = window.matchMedia('(prefers-color-scheme: dark)'); }       catch (_) {}
  try { reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)'); }  catch (_) {}

  const _onThemeChange = () => {
    _endBarTransition();
    _invalidateGeometryCache();
    _scheduleVP(_VPReason.THEME);

    // Second commit two frames later catches any late font/metric application.
    _raf(() => {
      _raf(() => {
        _barHeightStale = true;
        _scheduleVP(_VPReason.THEME);
      });
    });
  };

  const _onReducedMotionChange = (e) => {
    _prefersReducedMotion = !!(e && e.matches);
    _endBarTransition();

    if (_prefersReducedMotion && _plusOpen && plusMenu) {
      if (_plusMenuTimer) clearTimeout(_plusMenuTimer);
      _plusMenuTimer = null;
      plusMenu.style.transition = 'none';
      plusMenu.style.transform  = '';
      plusMenu.style.opacity    = '';
    }

    _invalidateGeometryCache();
    _scheduleVP(_VPReason.THEME);
  };

  if (themeMQ) {
    if (themeMQ.addEventListener)   themeMQ.addEventListener('change', _onThemeChange);
    else if (themeMQ.addListener)   themeMQ.addListener(_onThemeChange);
  }
  if (reducedMotionMQ) {
    if (reducedMotionMQ.addEventListener) reducedMotionMQ.addEventListener('change', _onReducedMotionChange);
    else if (reducedMotionMQ.addListener) reducedMotionMQ.addListener(_onReducedMotionChange);
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
// Deterministic: clear any stale inline styles → measure → commit → visible.
// The bar is never hidden while geometry is pending.

(function _init() {
  if (chatbarWrap) {
    // Drop any stale opacity/transition from a previous build iteration.
    if (chatbarWrap.style.opacity === '0') chatbarWrap.style.opacity = '';
    chatbarWrap.style.transition = '';
    _clearBarTransitionTimer();
  }

  // Two rAFs: first lets stylesheets/fonts settle, second is the paint frame.
  _raf(() => {
    _raf(() => {
      _scheduleVP(_VPReason.INIT);
    });
  });

  // Safety net: if rAF was throttled (background tab, power-save), the first
  // interaction forces a synchronous commit so the bar is never left uncommitted.
  const _recoverOnce = () => {
    window.removeEventListener('pointerdown', _recoverOnce, true);
    window.removeEventListener('keydown', _recoverOnce, true);
    if (_vpCommitCount > 0) return;
    if (_vpRafId !== null) { _caf(_vpRafId); _vpRafId = null; }
    _vpPending = false;
    _commitViewport(_now());
  };
  window.addEventListener('pointerdown', _recoverOnce, true);
  window.addEventListener('keydown', _recoverOnce, true);
})();

// ── Send button ───────────────────────────────────────────────────────────────

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

// ── Scroll to message ─────────────────────────────────────────────────────────

window._lastUserMsgEl = null;

function scrollToMsg(el) {
  if (!el || !scrollHost) return;

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
    resetScrollAccum();

    // Token-guarded cleanup — settles scroll bookkeeping, never chatbar geometry.
    window.setTimeout(() => {
      if (requestToken !== _programmaticScrollToken) return;
      _endProgrammaticScroll();
    }, 450);
  });
}

window.scrollToMsg = scrollToMsg;

// ── Header / tab scroll animation ────────────────────────────────────────────
// Lightweight: no layout reads beyond scrollTop, no geometry invalidation.

const HIDE_ACCUM  = 40;
const SHOW_ACCUM  = 55;
const LOGO_THRESH = 10;

function updateHeader(now) {
  _rafPending = false;
  if (!scrollHost || !logoHeader || !tabBar) return;

  now = now || _now();

  if (_programmaticActive(now)) {
    _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
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

if (scrollHost) {
  scrollHost.addEventListener('scroll', () => {
    if (_programmaticActive()) {
      _lastScrollY = scrollHost.scrollTop;
      return;
    }
    if (!_rafPending) {
      _rafPending = true;
      _raf(updateHeader);
    }
  }, { passive: true });
}

// ── Input & pill ──────────────────────────────────────────────────────────────

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
    // Textarea growth changes bar height → ResizeObserver handles invalidation.
  });
}

// ── Plus menu ─────────────────────────────────────────────────────────────────
// Fully independent from chatbar geometry. If the menu changes the bar's box,
// ResizeObserver reports the real size to the pipeline.

let _plusMenuTimer = null;

function openPlusMenu() {
  if (!plusBtn || !plusMenu || !plusBackdrop || _plusOpen) return;

  _plusOpen = true;
  if (_plusMenuTimer) { clearTimeout(_plusMenuTimer); _plusMenuTimer = null; }

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

  void plusMenu.offsetWidth; // force reflow to allow the transition to play

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
  if (_plusMenuTimer) { clearTimeout(_plusMenuTimer); _plusMenuTimer = null; }

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
    if (_plusOpen) closePlusMenu(); else openPlusMenu();
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

// ── Tab system ────────────────────────────────────────────────────────────────

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
  return ++_tabLoadRequestId;
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
      _moduleLoadPromises[key] = _loadScript('modules/' + key + '/' + key + '.js')
        .then(() => { _moduleCache[key] = true; return true; })
        .catch((err) => { delete _moduleLoadPromises[key]; throw err; });
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

// ── Content swap animation ────────────────────────────────────────────────────
// Animates #pageContent opacity/transform only — cannot affect chatbar geometry.

let _contentAnimTimer = null;

function _animateContentIn() {
  if (!pageContent) return;

  if (_contentAnimTimer) {
    clearTimeout(_contentAnimTimer);
    _contentAnimTimer = null;
  }

  if (_prefersReducedMotion) {
    pageContent.style.opacity    = '';
    pageContent.style.transform  = '';
    pageContent.style.transition = '';
    return;
  }

  pageContent.style.transition = 'none';
  pageContent.style.opacity    = '0';
  pageContent.style.transform  = 'translateY(8px)';

  void pageContent.offsetWidth;

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

// ── Tab-bar click handler ─────────────────────────────────────────────────────

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
      resetScrollAccum();

      _raf(() => {
        _programmaticScroll = false;
        if (requestId !== _tabLoadRequestId || !scrollHost) return;
        _lastScrollY = scrollHost.scrollTop;
      });
    }

    if (logoHeader && _isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
    if (tabBar && _isTabHidden)         { tabBar.classList.remove('hide');          _isTabHidden     = false; }
    if (tabBar && _isTabScrolled)       { tabBar.classList.remove('scrolled');      _isTabScrolled   = false; }

    // Invalidate before + after the tab swap so geometry always reflects
    // the visible tab and can never inherit the previous tab's compensation.
    _barHeightStale = true;
    _scheduleVP(_VPReason.WINDOW);

    await _loadTab(key, requestId);

    _barHeightStale = true;
    _scheduleVP(_VPReason.WINDOW);

    if (!_isCurrentTabRequest(key, requestId)) return;

    _animateContentIn();
  }, { passive: true });
}

// ── Public API ────────────────────────────────────────────────────────────────

window._atkynModuleCache = _moduleCache;
window._atkynPageContent = pageContent;
window._atkynAnimateIn   = _animateContentIn;
window._atkynLoadTab     = _loadTab;

// Read-only diagnostics (no geometry writes).
window._atkynViewportDebug = () => ({
  barHeight     : _barHeight,
  kbInset       : _lastKbInset,
  kbOpen        : _kbOpen,
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
