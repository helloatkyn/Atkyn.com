/* ═══════════════════════════════════════════════════════════════════
   core-part1.js — ATKYN Keyboard · Viewport · Chatbar  [PRODUCTION]
   ═══════════════════════════════════════════════════════════════════
   Single authority for all chatbar geometry.
   Part 2 must NEVER write chatbarWrap transform / bottom / position.
   ══════════════════════════════════════════════════════════════════ */

'use strict';

/* ────────────────────────────────────────────────────────────────────
   CONSTANTS
   ──────────────────────────────────────────────────────────────────── */

const KB_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/*
 * Minimum keyboard inset to treat as a real keyboard, not browser-chrome
 * movement or tiny VisualViewport fluctuations.
 * 80 px comfortably exceeds typical mobile browser-chrome height (~60 px)
 * while sitting well below any realistic keyboard (usually ≥ 200 px).
 */
const KB_THRESHOLD = 80;

/*
 * Dead-zone: changes smaller than this (in px) between successive viewport
 * measurements are ignored to prevent flickering on tiny VVP jitter.
 */
const KB_DEAD_ZONE = 4;

const KB_DUR_OPEN  = '0.35s';
const KB_DUR_CLOSE = '0.28s';

/* ────────────────────────────────────────────────────────────────────
   DOM REFERENCES
   ──────────────────────────────────────────────────────────────────── */

const chatbarWrap = document.querySelector('.chatbar-wrap');
const chatSpacer  = document.getElementById('chatSpacer');
const cbInput     = document.getElementById('cbInput');
const pill        = document.getElementById('pill');
const scrollHost  = document.getElementById('scrollHost');
const chatArea    = document.getElementById('chatArea');

const vvp = window.visualViewport ?? null;

/* ────────────────────────────────────────────────────────────────────
   SHARED PREFERENCE (read-only in Part 1; Part 2 owns the listener)
   ──────────────────────────────────────────────────────────────────── */

/*
 * Exposed on window so Part 2 can update it and Part 1 reads it live.
 * Part 2 sets window._atkynReducedMotion when the preference changes.
 */
function _prefersReducedMotion() {
  return window._atkynReducedMotion === true ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ────────────────────────────────────────────────────────────────────
   STATE  — all private; never scattered across unrelated functions
   ──────────────────────────────────────────────────────────────────── */

/*
 * Public read: Part 2 tab-bar pointerdown handler checks _keyboardOpen
 * before deciding whether to call e.preventDefault() on input focus.
 * Exposed via window._atkynKeyboardOpen (set below after each commit).
 */
let _keyboardOpen   = false;
let _keyboardInset  = 0;   // last committed inset in px
let _barHeight      = 0;   // chatbar height from ResizeObserver
let _barDirty       = false;

/* Skip-identical guards */
let _lastTransform  = '';
let _lastSpacerH    = -1;

/* VisualViewport RAF gate (mark-dirty → single RAF) */
let _vvpDirty  = false;
let _vvpRafId  = 0;

/*
 * Animation lifecycle token.
 * Incremented on every new geometry target; stale callbacks check token.
 */
let _kbToken     = 0;
let _kbAnimating = false;
let _kbDirection = null;   // 'open' | 'close' | null

/* Active transitionend/cancel handler on chatbarWrap (keyboard leg) */
let _kbSettleHandler = null;

/* Entrance animation (opacity only; never touches transform) */
let _entranceActive        = false;
let _entranceSettleHandler = null;

/* ────────────────────────────────────────────────────────────────────
   HELPERS
   ──────────────────────────────────────────────────────────────────── */

function _setSpacerHeight(h) {
  const safe = Math.max(0, Math.round(h));
  if (!chatSpacer || safe === _lastSpacerH) return;
  _lastSpacerH = safe;
  chatSpacer.style.height = safe + 'px';
}

function _setWillChange(on) {
  if (!chatbarWrap) return;
  chatbarWrap.style.willChange = on ? 'transform' : '';
}

/*
 * Measure the current real keyboard inset from VisualViewport.
 * Returns { inset, open }.
 *
 * Logic:
 *   visibleBottom = vvp.offsetTop + vvp.height
 *   rawInset      = window.innerHeight - visibleBottom
 *
 * rawInset > KB_THRESHOLD  →  real software keyboard
 * rawInset ≤ KB_THRESHOLD  →  browser-chrome movement; treat as 0
 */
function _measureViewport() {
  if (!vvp) return { inset: 0, open: false };
  const visibleBottom = vvp.offsetTop + vvp.height;
  const raw = Math.max(0, window.innerHeight - visibleBottom);
  const inset = raw > KB_THRESHOLD ? Math.round(raw) : 0;
  return { inset, open: inset > 0 };
}

/* ────────────────────────────────────────────────────────────────────
   TRANSITION LISTENER CLEANUP
   ──────────────────────────────────────────────────────────────────── */

function _removeKbSettle() {
  if (!chatbarWrap || !_kbSettleHandler) return;
  chatbarWrap.removeEventListener('transitionend',    _kbSettleHandler);
  chatbarWrap.removeEventListener('transitioncancel', _kbSettleHandler);
  _kbSettleHandler = null;
}

function _removeEntranceSettle() {
  if (!chatbarWrap || !_entranceSettleHandler) return;
  chatbarWrap.removeEventListener('transitionend',    _entranceSettleHandler);
  chatbarWrap.removeEventListener('transitioncancel', _entranceSettleHandler);
  _entranceSettleHandler = null;
}

/* Build the CSS transition string for chatbarWrap. */
function _buildTransition(withKb, inset) {
  const legs = [];
  if (withKb) {
    const dur = inset > 0 ? KB_DUR_OPEN : KB_DUR_CLOSE;
    legs.push(`transform ${dur} ${KB_EASE}`);
  }
  if (_entranceActive) legs.push('opacity 0.35s ease-out');
  return legs.join(', ');
}

/* ────────────────────────────────────────────────────────────────────
   ENTRANCE ANIMATION  (opacity fade-in; never touches transform)
   ──────────────────────────────────────────────────────────────────── */

function _startEntranceAnimation() {
  if (!chatbarWrap || !_entranceActive) return;

  chatbarWrap.style.opacity = '1';

  const onEnd = (e) => {
    if (e.target !== chatbarWrap || e.propertyName !== 'opacity') return;
    if (_entranceSettleHandler !== onEnd) return;   // stale guard

    _removeEntranceSettle();
    _entranceActive = false;
    chatbarWrap.style.opacity = '';

    /* After entrance, keep only the active keyboard leg (if any). */
    chatbarWrap.style.transition = _buildTransition(_kbAnimating, _keyboardInset);
  };

  _entranceSettleHandler = onEnd;
  chatbarWrap.addEventListener('transitionend',    onEnd);
  chatbarWrap.addEventListener('transitioncancel', onEnd);
}

/* ────────────────────────────────────────────────────────────────────
   GEOMETRY COMMIT  — sole writer of chatbarWrap positioning
   ──────────────────────────────────────────────────────────────────── */

/*
 * _commitGeometry(opts?)
 *
 * opts.force   — re-apply even if transform string is unchanged
 * opts.instant — skip animation (snap); honours _prefersReducedMotion
 *
 * Design: we use a CSS translateY(-inset) approach because the existing
 * CSS roots the chatbar at bottom:0 of the layout viewport. The VVP inset
 * is the gap between the layout viewport bottom and the visible viewport
 * bottom (i.e. the keyboard height). Lifting by exactly that amount keeps
 * the chatbar anchored to the visible viewport bottom.
 *
 * One function reads; one function writes. Never interleaved.
 */
function _commitGeometry(opts) {
  if (!chatbarWrap) return;

  /* ── READ ── */
  const { inset, open } = _measureViewport();

  /* Detect meaningful change (dead-zone avoids jitter). */
  const insetChanged = Math.abs(inset - _keyboardInset) > KB_DEAD_ZONE || open !== _keyboardOpen;

  const wasOpen = _keyboardOpen;

  /* Always update state so it matches reality. */
  _keyboardOpen  = open;
  _keyboardInset = inset;

  /* Publish for Part 2 and pointerdown handler. */
  window._atkynKeyboardOpen = open;

  const target = inset > 0
    ? `translateY(-${inset}px) translateZ(0)`
    : 'translateZ(0)';

  const force   = opts?.force   ?? false;
  const instant = opts?.instant ?? _prefersReducedMotion();

  /* ── SPACER always tracks real inset ── */
  if (_barDirty || insetChanged || force) {
    _barDirty = false;
    _setSpacerHeight(_barHeight + inset);
  }

  const transformChanged = target !== _lastTransform;

  if (!transformChanged && !force) {
    /* No geometry change. Kick entrance if pending. */
    if (_entranceActive && !_entranceSettleHandler && !_kbAnimating && inset === 0) {
      chatbarWrap.style.transition = _buildTransition(false, 0);
      _startEntranceAnimation();
    }
    return;
  }

  /* ── SCROLL ANCHOR on keyboard first open ── */
  if (!wasOpen && open && scrollHost) {
    const chatVisible = !chatArea || chatArea.style.display !== 'none';
    if (chatVisible) {
      const anchor = window._lastUserMsgEl;
      scrollHost.scrollTop = anchor
        ? Math.max(0, anchor.offsetTop - 16)
        : scrollHost.scrollHeight;
    }
  }

  _lastTransform = target;

  /* ── INSTANT SNAP ── */
  if (instant) {
    /* Invalidate any in-flight animation. */
    _kbToken += 1;
    _kbAnimating = false;
    _kbDirection = null;
    _removeKbSettle();

    if (_entranceActive) {
      _entranceActive = false;
      _removeEntranceSettle();
      chatbarWrap.style.opacity = '';
    }

    _setWillChange(false);
    chatbarWrap.style.transition = '';
    chatbarWrap.style.transform  = target;
    return;
  }

  /* ── ANIMATED UPDATE ── */

  /*
   * Entrance-only path: no keyboard movement, just fade in.
   * Happens when page loads with keyboard already closed.
   */
  if (inset === 0 && !_kbAnimating && _entranceActive) {
    chatbarWrap.style.transition = _buildTransition(false, 0);
    chatbarWrap.style.transform  = target;
    if (!_entranceSettleHandler) _startEntranceAnimation();
    return;
  }

  const newDir       = inset > 0 ? 'open' : 'close';
  const dirChanged   = newDir !== _kbDirection;

  if (_kbAnimating && !dirChanged) {
    /* Same direction: just update the target; existing lifecycle stays. */
    chatbarWrap.style.transform = target;
    if (_entranceActive && !_entranceSettleHandler) {
      chatbarWrap.style.transition = _buildTransition(true, inset);
      _startEntranceAnimation();
    }
    return;
  }

  /* ── NEW DIRECTION: replace previous lifecycle ── */
  const token = ++_kbToken;

  _kbDirection = newDir;
  _kbAnimating = true;
  _removeKbSettle();

  chatbarWrap.style.transition = _buildTransition(true, inset);
  _setWillChange(true);
  chatbarWrap.style.transform  = target;

  const settle = (e) => {
    if (e.target !== chatbarWrap || e.propertyName !== 'transform') return;
    if (token !== _kbToken) return;   // stale; a newer animation took over

    _removeKbSettle();
    _kbAnimating = false;
    _kbDirection = null;
    _setWillChange(false);
    chatbarWrap.style.transition = _buildTransition(false, inset);
  };

  _kbSettleHandler = settle;
  chatbarWrap.addEventListener('transitionend',    settle);
  chatbarWrap.addEventListener('transitioncancel', settle);

  if (_entranceActive && !_entranceSettleHandler) {
    _startEntranceAnimation();
  }
}

/* ────────────────────────────────────────────────────────────────────
   RAF GATE  — mark-dirty → single RAF → read → calculate → write
   ──────────────────────────────────────────────────────────────────── */

function _scheduleViewportUpdate() {
  if (_vvpDirty) return;
  _vvpDirty = true;
  _vvpRafId = requestAnimationFrame(() => {
    _vvpDirty = false;
    _vvpRafId = 0;
    _commitGeometry();
  });
}

/* ────────────────────────────────────────────────────────────────────
   VISUAL VIEWPORT WIRING
   ──────────────────────────────────────────────────────────────────── */

if (vvp) {
  vvp.addEventListener('resize', _scheduleViewportUpdate, { passive: true });
  vvp.addEventListener('scroll', _scheduleViewportUpdate, { passive: true });

  /* Initial geometry (snap, no animation yet). */
  _setSpacerHeight(_barHeight);
  _commitGeometry({ force: true, instant: true });
} else {
  /*
   * VisualViewport unavailable (rare modern browser situation).
   * Keep body height in sync with window.innerHeight so fixed-position
   * elements don't clip. Keyboard handling is best-effort.
   */
  const _legacyResize = () => {
    const h = window.innerHeight + 'px';
    if (document.body.style.height !== h) document.body.style.height = h;
  };
  window.addEventListener('resize', _legacyResize, { passive: true });
  _legacyResize();
  _setSpacerHeight(_barHeight);
}

/* ────────────────────────────────────────────────────────────────────
   RESIZE OBSERVER  — chatbar height tracking
   ──────────────────────────────────────────────────────────────────── */

if (chatbarWrap && typeof ResizeObserver === 'function') {
  /*
   * Single observer; never recreated.
   * _plusOpen guard removed: plus-menu is Part 2 concern. Instead we skip
   * if the measured height is unreasonably large (menu popping chatbar).
   * In practice, the plus menu renders above the chatbar, so chatbarWrap
   * height should stay stable while it's open.
   */
  const _barObserver = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;

    const bs   = entry.borderBoxSize;
    const newH = bs
      ? (bs[0]?.blockSize ?? bs.blockSize)
      : entry.contentRect.height;
    const rounded = Math.round(newH);

    if (rounded === _barHeight) return;
    _barHeight = rounded;
    _barDirty  = true;

    /* Recalculate spacer immediately without animating chatbar. */
    _setSpacerHeight(_barHeight + _keyboardInset);
  });

  _barObserver.observe(chatbarWrap);
  /* Seed initial height. */
  _barHeight = Math.round(chatbarWrap.offsetHeight);
}

/* ────────────────────────────────────────────────────────────────────
   CHATBAR ENTRANCE ANIMATION
   ──────────────────────────────────────────────────────────────────── */

(function _initEntrance() {
  if (!chatbarWrap || _prefersReducedMotion()) return;
  _entranceActive = true;
  chatbarWrap.style.opacity = '0';
  requestAnimationFrame(() => {
    if (!chatbarWrap || !_entranceActive) return;
    _commitGeometry({ force: true });
  });
})();

/* ────────────────────────────────────────────────────────────────────
   INPUT FOCUS  — prevent unwanted scroll jumps
   ──────────────────────────────────────────────────────────────────── */

if (pill && cbInput) {
  pill.addEventListener('pointerdown', (e) => {
    const t = e.target instanceof Element ? e.target : null;

    /* Ignore plus-button area (Part 2 owns plus menu). */
    const plusBtn = document.getElementById('plusBtn');
    if (plusBtn && t && (t === plusBtn || plusBtn.contains(t))) return;

    /* Only intercept taps on the pill or input itself. */
    if (
      t &&
      t !== pill &&
      t !== cbInput &&
      !t.closest('button, .overlay-input-wrap')
    ) return;

    /* Already focused or keyboard open: no action needed. */
    if (document.activeElement === cbInput || _keyboardOpen) return;

    e.preventDefault();   // prevent browser's auto-scroll on focus
    requestAnimationFrame(() => {
      if (cbInput && document.activeElement !== cbInput) {
        cbInput.focus({ preventScroll: true });
      }
    });
  }, { passive: false });
}

/* ────────────────────────────────────────────────────────────────────
   THEME CHANGE HOOK
   Called by Part 2's theme-change handler so Part 1 can re-measure
   after the browser has applied new styles (two RAFs required for
   Android Chrome to update VVP after a color-scheme repaint).
   ──────────────────────────────────────────────────────────────────── */

function _onThemeChange() {
  /* Cancel any pending viewport RAF; we own the next measurement. */
  if (_vvpDirty) {
    cancelAnimationFrame(_vvpRafId);
    _vvpRafId = 0;
    _vvpDirty = false;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      /* Re-read chatbar height in case theme changed it. */
      if (chatbarWrap) {
        const h = Math.round(chatbarWrap.offsetHeight);
        if (h !== _barHeight) { _barHeight = h; _barDirty = true; }
      }
      _lastTransform = '';   // force full re-evaluation
      _commitGeometry({ force: true, instant: true });
    });
  });
}

/* ────────────────────────────────────────────────────────────────────
   ORIENTATION / APP-VISIBILITY  — minimal lifecycle hooks
   ──────────────────────────────────────────────────────────────────── */

window.addEventListener('orientationchange', () => {
  /* Orientation changes invalidate VVP geometry; remeasure after settle. */
  setTimeout(() => {
    _lastTransform = '';
    _commitGeometry({ force: true, instant: true });
  }, 100);
}, { passive: true });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    _lastTransform = '';
    _scheduleViewportUpdate();
  }
}, { passive: true });

/* ────────────────────────────────────────────────────────────────────
   PUBLIC API  (Part 2 and modules may call these)
   ──────────────────────────────────────────────────────────────────── */

/*
 * Part 2 calls this after theme change so Part 1 can re-measure cleanly.
 */
window._atkynOnThemeChange = _onThemeChange;

/*
 * Part 2 reads this to know current keyboard state (e.g. pointerdown guard).
 * Updated after every _commitGeometry call.
 */
window._atkynKeyboardOpen = false;

/*
 * Exposed for chat modules that need to trigger a scroll anchor after
 * rendering new messages while the keyboard is open.
 */
window._lastUserMsgEl = null;
