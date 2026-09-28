'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
 * ATKYN MOBILE PWA  ·  core.js  ·  Production-hardened geometry pipeline
 *
 * Architecture invariants (enforced throughout):
 *  I1  Latest physical viewport state always wins.
 *  I2  Rendering never waits for keyboard boolean confirmation.
 *  I3  Theme changes never fake a keyboard close/open.
 *  I4  A stale callback cannot overwrite newer geometry.
 *  I5  Only the current applied transform is used when deriving base geometry.
 *  I6  Spacer and transform cannot accidentally double-compensate.
 *  I7  ResizeObserver cannot create an endless geometry loop.
 *  I8  Pill and chatbar wrapper move as a single visual unit.
 *  I9  Keyboard closing eventually returns chatbar to the exact baseline.
 *  I10 Repeated theme changes do not accumulate geometry error.
 *  I11 Repeated keyboard open/close cycles do not accumulate geometry error.
 *  I12 Unrelated scroll/header state cannot block keyboard correction.
 * ───────────────────────────────────────────────────────────────────────────── */

/* ── PRIMITIVE HELPERS ───────────────────────────────────────────────────── */

let _prefersReducedMotion = !!(window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const EASE = {
  menuOpen    : 'cubic-bezier(0.32, 0.72, 0, 1)',
  menuClose   : 'cubic-bezier(0.4, 0, 1, 1)',
  contentSwap : 'cubic-bezier(0.16, 1, 0.3, 1)'
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

/* ── DOM ─────────────────────────────────────────────────────────────────── */

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

/* Static tab-bar height for message anchoring. Measured once at parse time,
 * before any layout mutations. */
const _tabBarHeight = tabBar ? tabBar.offsetHeight : 0;

const SVG_SEND  = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="5 11 12 4 19 11"/></svg>';
const SVG_CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/* ── SCROLL / HEADER STATE ───────────────────────────────────────────────── */

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
let _programmaticOwner   = 'none';
let _programmaticSettleTimer = null;
let _plusOpen            = false;
let _velocityEMA         = 0;
let _lastScrollTime      = 0;

const VELOCITY_ALPHA = 0.3;

function _programmaticActive(now) {
  const t = now !== undefined ? now : _now();
  return _programmaticScroll || (_programmaticUntil > 0 && t < _programmaticUntil);
}

/*
 * Every programmatic scroll operation owns the shared suppression state with a
 * monotonic token. An asynchronous callback may release/end state only when its
 * token still owns the operation.
 */
function _cancelProgrammaticSettleTimer() {
  if (_programmaticSettleTimer !== null) {
    window.clearTimeout(_programmaticSettleTimer);
    _programmaticSettleTimer = null;
  }
}

function _beginProgrammaticScroll(owner, until) {
  _cancelProgrammaticSettleTimer();

  const token = ++_programmaticScrollToken;
  _programmaticOwner  = owner || 'unknown';
  _programmaticScroll = true;
  _programmaticUntil  = Number.isFinite(until) && until > 0 ? until : 0;

  return token;
}

function _releaseProgrammaticScroll(token) {
  if (token !== _programmaticScrollToken) return false;
  _programmaticScroll = false;
  return true;
}

function _endProgrammaticScroll(token) {
  /*
   * The token is mandatory for asynchronous ownership. A callback from an
   * older operation therefore becomes a harmless no-op instead of clearing
   * state belonging to a newer operation.
   */
  if (token !== _programmaticScrollToken) return false;

  _cancelProgrammaticSettleTimer();
  _programmaticScroll = false;
  _programmaticUntil  = 0;
  _programmaticOwner  = 'none';

  if (scrollHost) _lastScrollY = scrollHost.scrollTop;
  _resetScrollAccum();
  return true;
}

function _resetScrollAccum() {
  _accumDown      = 0;
  _accumUp        = 0;
  _velocityEMA    = 0;
  _lastScrollTime = 0;
}

/* ── VIEWPORT / CHATBAR GEOMETRY ─────────────────────────────────────────── */
/*
 * GEOMETRY CONTRACT
 * ─────────────────
 * The chatbar sits at a natural (untransformed) bottom position.  When the
 * software keyboard raises the visual viewport, the bar's untransformed rect
 * extends below the visible area by exactly `kbInset` pixels.  We correct
 * that with translateY(-kbInset) on the wrapper and add kbInset to the
 * chatSpacer so scroll content does not go under the bar.
 *
 *   spacer  = barHeight + kbInset     ← pushes content up
 *   transform = translateY(-kbInset)  ← lifts the bar above the keyboard
 *
 * These two mechanisms do NOT double-compensate: the spacer moves content,
 * the transform moves the bar only.  They are complementary, not redundant.
 *
 * BASE-BOTTOM DERIVATION  (Invariant I5)
 * Every geometry frame reads getBoundingClientRect() on the bar.  Because we
 * own the only translateY on this element, we recover the untransformed bottom
 * by adding back the currently-applied inset:
 *
 *   baseBottom = rect.bottom + _renderState.appliedInset
 *
 * This is NOT self-referential because _renderState.appliedInset is always
 * the value written in the previous (already-committed) frame.  We never read
 * a value we are in the process of writing.
 *
 * THEME SAFETY  (Invariant I3)
 * A theme event only resets the cached bar height and spacer so they are
 * re-measured from DOM.  It never touches _renderState.appliedInset,
 * _lastTransformStr, or _kbOpen.  The next geometry commit re-derives
 * targetInset from the live VisualViewport, which always wins.
 *
 * STALE-CALLBACK PROTECTION  (Invariant I4)
 * A single monotonically-increasing _geometryGeneration counter is incremented
 * on every geometry write.  The ResizeObserver and MutationObserver only
 * schedule; they never write geometry directly.  The single pending RAF is
 * always the latest physical state, so no per-callback generation token is
 * needed for the main geometry path.
 *
 * All programmatic scroll operations share _programmaticScrollToken ownership.
 * An asynchronous callback must prove it still owns the current token before
 * changing or ending shared scroll-suppression state.
 */

/* ── GEOMETRY STATE ─────────────────────────────────────────────────────── */

/*
 * _barHeight         Cached offsetHeight of chatbarWrap. -1 = dirty/unmeasured.
 * _lastKbInset       Last committed keyboard inset (mirrors _renderState.appliedInset).
 * _lastSpacerH       Last committed chatSpacer height. -1 = dirty.
 * _lastTransformStr  Last committed transform string written to DOM.
 * _kbOpen            Hysteresis boolean: keyboard open for behavioural logic only.
 *
 * Invariant: after every _commitViewport write:
 *   _lastKbInset === _renderState.appliedInset
 *   _lastTransformStr === _renderState.appliedTransform
 *   _lastSpacerH === _renderState.appliedSpacerHeight  (when spacer exists)
 */
let _barHeight           = -1;
let _lastKbInset         = 0;
let _lastSpacerH         = -1;
let _lastTransformStr    = 'none';   /* initialised to match DOM (no transform) */
let _kbOpen              = false;
let _lastViewportEventTs = 0;
let _viewportEventGap    = Infinity;
let _vpCommitCount       = 0;
let _geometryGeneration  = 0;
let _vpPending           = false;
let _vpRafId             = null;
let _vpReasonFlags       = 0;

/* Live snapshot of viewport geometry — written every commit, read by debug. */
const _viewportState = {
  layoutHeight      : 0,
  visualHeight      : 0,
  visualOffsetTop   : 0,
  visualBottom      : 0,
  hasVisualViewport : false,
  geometryValid     : false
};

/* Live snapshot of chatbar layout — written every commit, read by debug. */
const _layoutState = {
  chatbarHeight : 0,
  baseBottom    : 0
};

/* Keyboard metadata — behavioural / debug only; rendering does NOT gate on
 * keyboardState.open. */
const _keyboardState = {
  inset     : 0,
  open      : false,
  animating : false
};

/*
 * _renderState is the single source of truth for what is currently rendered.
 *
 * appliedInset:        the translateY magnitude last written to the DOM.
 * appliedTransform:    the full transform string last written to the DOM.
 * appliedSpacerHeight: the chatSpacer height last written to the DOM.
 *
 * After every geometry commit these agree with the corresponding _lastXxx vars.
 */
const _renderState = {
  appliedInset        : 0,
  appliedTransform    : 'none',
  appliedSpacerHeight : -1
};

/* Bitmask reasons for scheduling a geometry commit. */
const _VPReason = {
  VIEWPORT   : 1,   /* VisualViewport resize/scroll */
  BAR_SIZE   : 2,   /* chatbarWrap ResizeObserver */
  THEME      : 4,   /* CSS theme mutation */
  WINDOW     : 8,   /* window resize / orientation / tab switch */
  INIT       : 16,  /* first-frame initialisation */
  PREFERENCE : 32   /* reduced-motion change */
};

/* Hysteresis thresholds for keyboard open/closed boolean.
 * Rendering uses the raw continuous inset; these only gate behavioural code. */
const KB_OPEN_THRESH  = 12;  /* px — minimum inset to declare keyboard open */
const KB_CLOSE_THRESH = 4;   /* px — maximum inset to declare keyboard closed */
const KB_STREAM_GAP   = 140; /* ms — viewport events closer than this = animating */

/* ── READ HELPERS ────────────────────────────────────────────────────────── */

function _layoutViewportHeight() {
  /* document.documentElement.clientHeight excludes the browser chrome and is
   * the correct layout viewport reference on mobile.  Fallback to innerHeight
   * which may include the chrome on some older engines. */
  const h = document.documentElement ? document.documentElement.clientHeight : 0;
  return h > 0 ? h : (window.innerHeight || 0);
}

/* Refresh the cached bar height.  Only reads from DOM when forced or when the
 * cache is dirty (-1).  ResizeObserver keeps the cache warm between commits.
 *
 * We use offsetHeight (border-box + CSS safe-area padding) rather than
 * getBoundingClientRect().height so that the spacer reflects the physical
 * occupied area, not the transformed position. */
function _refreshBarHeight(force) {
  if (!chatbarWrap) return 0;
  if (!force && _barHeight >= 0) return _barHeight;
  _barHeight = Math.max(0, Math.round(chatbarWrap.offsetHeight));
  return _barHeight;
}

/*
 * READ phase: measure chatbar position and height.
 *
 * Returns:
 *   height        — border-box height of the chatbar
 *   renderedBottom— rect.bottom with current transform applied
 *   baseBottom    — rect.bottom with our transform removed (untransformed bottom)
 *   rect          — raw DOMRect (for debug)
 *
 * baseBottom = renderedBottom + appliedInset
 *
 * This is convergent because appliedInset is the inset FROM THE LAST FRAME,
 * not the inset we are computing now.  The value is always one frame behind
 * by definition, but since we re-derive targetInset from the live viewport
 * every frame, any error is bounded to one frame and does not accumulate.
 */
function _measureBarBox(reasons) {
  if (!chatbarWrap) {
    return { height: 0, renderedBottom: 0, baseBottom: 0, rect: null };
  }

  /* Force re-read of height on any structural/styling reason. */
  const forceHeight = (reasons & (_VPReason.BAR_SIZE |
                                  _VPReason.THEME      |
                                  _VPReason.WINDOW     |
                                  _VPReason.INIT       |
                                  _VPReason.PREFERENCE)) !== 0;

  const height = _refreshBarHeight(forceHeight);

  /* getBoundingClientRect() accounts for scroll, ancestors, and our own
   * transform.  We need the untransformed bottom so we add back only the
   * inset we ourselves applied last frame. */
  const rect          = chatbarWrap.getBoundingClientRect();
  const appliedInset  = _renderState.appliedInset; /* always finite; initialised to 0 */
  const renderedBottom = Number.isFinite(rect.bottom) ? rect.bottom : 0;
  const baseBottom     = renderedBottom + appliedInset;

  return { height, renderedBottom, baseBottom, rect };
}

/*
 * READ phase: derive keyboard inset from VisualViewport.
 *
 * kbInset is the continuous physical overlap between the chatbar's natural
 * (untransformed) bottom and the current visual viewport bottom.  It is ≥ 0.
 *
 * Design: we read the live VisualViewport every frame.  No caching of viewport
 * dimensions between commits.  This ensures Invariant I1.
 *
 * The no-vvp branch handles environments that do not expose VisualViewport.
 * If VisualViewport exists but height is temporarily <= 0, that sample is
 * unavailable geometry, not authoritative keyboard-close geometry. The last
 * committed physical inset is preserved until a later valid VVP frame.
 */
function _readKeyboard(box) {
  const layoutH = _layoutViewportHeight();

  /* ── No VisualViewport API ── */
  if (!vvp) {
    _viewportState.layoutHeight      = layoutH;
    _viewportState.visualHeight      = layoutH;
    _viewportState.visualOffsetTop   = 0;
    _viewportState.visualBottom      = layoutH;
    _viewportState.hasVisualViewport = false;
    _viewportState.geometryValid     = false;

    /* No physical visual-viewport source exists; preserve the historical
     * fallback without inventing a keyboard-open/close edge. */
    const kbInset = 0;
    _keyboardState.inset     = kbInset;
    _keyboardState.animating = false;

    return {
      kbInset,
      kbOpen        : _kbOpen,
      kbEdge        : false,
      stream        : false,
      geometryValid : false,
      visualBottom  : layoutH
    };
  }

  /*
   * VisualViewport exists but this sample is temporarily unusable. It is not
   * authoritative keyboard-close geometry. Preserve the last committed
   * physical inset/render state until a later valid VVP sample arrives.
   */
  const rawHeight = Number(vvp.height);
  const heightValid = Number.isFinite(rawHeight) && rawHeight > 0;

  if (!heightValid) {
    const visualOffsetTop = Number.isFinite(vvp.offsetTop) ? vvp.offsetTop : 0;
    const preservedInset  = Number.isFinite(_renderState.appliedInset)
      ? Math.max(0, _renderState.appliedInset)
      : 0;

    _viewportState.layoutHeight      = layoutH;
    _viewportState.visualHeight      = 0;
    _viewportState.visualOffsetTop   = visualOffsetTop;
    _viewportState.visualBottom      = visualOffsetTop;
    _viewportState.hasVisualViewport = true;
    _viewportState.geometryValid     = false;

    /* No fake close edge and no physical zeroing during an invalid sample. */
    _keyboardState.inset     = preservedInset;
    _keyboardState.open      = _kbOpen;
    _keyboardState.animating = false;

    return {
      kbInset       : preservedInset,
      kbOpen        : _kbOpen,
      kbEdge        : false,
      stream        : false,
      geometryValid : false,
      visualBottom  : visualOffsetTop
    };
  }

  /* ── VisualViewport available and authoritative ── */
  const visualOffsetTop = Number.isFinite(vvp.offsetTop) ? vvp.offsetTop : 0;
  const visualHeight    = rawHeight;
  const visualBottom    = visualOffsetTop + visualHeight;

  _viewportState.layoutHeight      = layoutH;
  _viewportState.visualHeight      = visualHeight;
  _viewportState.visualOffsetTop   = visualOffsetTop;
  _viewportState.visualBottom      = visualBottom;
  _viewportState.hasVisualViewport = true;
  _viewportState.geometryValid     = true;

  /*
   * Physical inset: how far the untransformed bar bottom extends below the
   * visible viewport bottom. Clamped to [0, baseBottom].
   */
  const rawOverlap = box.baseBottom - visualBottom;
  const kbInset    = Math.max(0, Math.min(rawOverlap, Math.max(0, box.baseBottom)));

  /* Behavioural hysteresis only; rendering never gates on this boolean. */
  const previousOpen = _kbOpen;
  if (_kbOpen) _kbOpen = kbInset >= KB_CLOSE_THRESH;
  else         _kbOpen = kbInset >= KB_OPEN_THRESH;

  const stream = (_viewportEventGap <= KB_STREAM_GAP);

  _keyboardState.inset     = kbInset;
  _keyboardState.open      = _kbOpen;
  _keyboardState.animating = stream;

  return {
    kbInset,
    kbOpen        : _kbOpen,
    kbEdge        : _kbOpen !== previousOpen,
    stream,
    geometryValid : true,
    visualBottom
  };
}

/* ── VIEWPORT SCHEDULER ─────────────────────────────────────────────────── */
/*
 * _scheduleVP is the single entry point for every event that may change
 * chatbar geometry.  Multiple events arriving before the RAF fires are
 * coalesced: reason flags accumulate, but only one RAF is scheduled.
 *
 * This enforces Invariant I1: the RAF always reads the latest physical state,
 * not the state at the time of the triggering event.
 */
function _scheduleVP(reason) {
  _vpReasonFlags |= (reason | 0);
  if (_vpPending) return;
  _vpPending = true;
  _vpRafId   = _raf(_commitViewport);
}

/* ── VIEWPORT COMMIT ────────────────────────────────────────────────────── */
/*
 * _commitViewport runs inside a single RAF callback.
 * It follows a strict READ → CALCULATE → WRITE pipeline to avoid forced-layout
 * interleaving.
 *
 * READ:       getBoundingClientRect, VisualViewport dimensions.
 * CALCULATE:  targetInset, targetTransformStr, spacerH — pure arithmetic.
 * WRITE:      chatSpacer.height, chatbarWrap.transform — DOM mutations happen
 *             only after all reads are complete.
 *
 * No DOM reads occur after the first write (no forced-layout thrashing).
 */
function _commitViewport(ts) {
  /* Accept both a DOMHighResTimeStamp from rAF and a manual call with _now(). */
  const now = (typeof ts === 'number' && ts > 0) ? ts : _now();

  _vpPending = false;
  _vpRafId   = null;

  if (!chatbarWrap) return;

  /* ── READ ── */
  const reasons = _vpReasonFlags;
  _vpReasonFlags = 0;

  const box = _measureBarBox(reasons);
  const kb  = _readKeyboard(box);

  /* Update layout snapshot (debug / consumers). */
  _layoutState.chatbarHeight = box.height;
  _layoutState.baseBottom    = box.baseBottom;

  /* ── CALCULATE ── */
  const targetInset = kb.kbInset;

  const targetTransformStr = targetInset > 0
    ? 'translateY(' + (-targetInset) + 'px)'
    : 'none';

  /*
   * spacerH = barHeight + kbInset
   *
   * Responsibility split (Invariant I6):
   *   chatSpacer (spacerH)    — ensures scroll content does not pass under
   *                             the chatbar when the keyboard is closed, and
   *                             provides extra clearance equal to kbInset when
   *                             the keyboard is open.
   *   translateY(-targetInset) — lifts the bar itself above the keyboard edge.
   *
   * These are complementary.  The spacer moves content; the transform moves
   * the bar.  They are not redundant because the spacer acts on the scroll
   * container (layout) and the transform acts on the bar (visual position).
   */
  const spacerH = Math.max(0, box.height + targetInset);

  /* ── SKIP if nothing changed ── */
  const transformChanged = targetTransformStr !== _lastTransformStr;
  const spacerChanged    = spacerH            !== _lastSpacerH;

  if (!transformChanged && !spacerChanged) {
    /*
     * No DOM write is needed, but all duplicate state representations are
     * reconciled to the single calculated/rendered values.
     */
    _renderState.appliedInset        = targetInset;
    _renderState.appliedTransform    = _lastTransformStr;
    _renderState.appliedSpacerHeight = _lastSpacerH;
    _keyboardState.inset              = targetInset;
    _keyboardState.open               = kb.kbOpen;
    _lastKbInset                      = targetInset;
    return;
  }

  /* ── WRITE ── */
  _geometryGeneration++;
  _vpCommitCount++;

  /*
   * Write spacer first.  The spacer height change alters layout but does NOT
   * affect the measured position of chatbarWrap (it sits below the scroll
   * container).  Writing it before the transform means both changes land in
   * the same paint tick, preventing a one-frame flicker.
   */
  if (spacerChanged && chatSpacer) {
    chatSpacer.style.height      = spacerH + 'px';
    _lastSpacerH                 = spacerH;
    _renderState.appliedSpacerHeight = spacerH;
  }

  /*
   * Write transform. Keyboard-following interpolation is already disabled
   * during initialization. Do not rewrite `transition` on every viewport frame,
   * because that would also rewrite unrelated wrapper transitions.
   */
  if (transformChanged) {
    chatbarWrap.style.transform   = targetTransformStr;
    _lastTransformStr             = targetTransformStr;
    _renderState.appliedTransform = targetTransformStr;
  }

  /* Keep appliedInset in sync regardless of which branch ran. */
  _renderState.appliedInset = targetInset;
  _keyboardState.inset      = targetInset;
  _keyboardState.open       = kb.kbOpen;
  _lastKbInset              = targetInset;

  /* Scroll anchor: only on a genuine keyboard-open edge, never on theme/resize.
   * Any scrollHost movement it causes produces a scroll event which may trigger
   * the header RAF — that is fine and converges immediately. */
  if (kb.kbEdge && kb.kbOpen) {
    _anchorChatOnKeyboardOpen(now);
  }
}

/* ── SCROLL ANCHOR ───────────────────────────────────────────────────────── */
/*
 * Scroll the chat content so the last user message is visible above the
 * keyboard.  This fires only once per keyboard-open edge (kbEdge && kbOpen).
 *
 * We set _programmaticUntil so that the scroll event this produces does not
 * trigger accumulation in _updateHeader.  We do NOT hold _programmaticScroll
 * across asynchronous time, preventing Invariant I12 violations where unrelated
 * scroll guards would block keyboard geometry.
 *
 * The anchor scroll is synchronous; _programmaticScroll is cleared immediately
 * so it never leaks into the geometry pipeline.
 */
function _anchorChatOnKeyboardOpen(now) {
  if (!scrollHost) return;
  if (chatArea && chatArea.style.display === 'none') return;
  if (_programmaticActive(now)) return;

  const operationToken = _beginProgrammaticScroll('keyboard-anchor', now + 400);

  /*
   * The anchor itself is synchronous. Keep ownership of the header-suppression
   * window with the token; geometry never consults this as a render gate.
   */
  const anchor = window._lastUserMsgEl;
  scrollHost.scrollTop = anchor
    ? Math.max(0, anchor.offsetTop - 16)
    : scrollHost.scrollHeight;

  _lastScrollY = scrollHost.scrollTop;
  _resetScrollAccum();

  /* Release only the synchronous flag; retain the token-bound time window. */
  _releaseProgrammaticScroll(operationToken);

  _programmaticSettleTimer = window.setTimeout(() => {
    if (operationToken !== _programmaticScrollToken) return;
    _endProgrammaticScroll(operationToken);
  }, 400);
}

/* ── VISUAL VIEWPORT EVENTS ─────────────────────────────────────────────── */

function _onViewportEvent() {
  const t             = _now();
  _viewportEventGap   = _lastViewportEventTs > 0 ? (t - _lastViewportEventTs) : Infinity;
  _lastViewportEventTs = t;
  _scheduleVP(_VPReason.VIEWPORT);
}

if (vvp) {
  vvp.addEventListener('resize', _onViewportEvent, { passive: true });
  vvp.addEventListener('scroll', _onViewportEvent, { passive: true });
}

window.addEventListener('resize',            () => _scheduleVP(_VPReason.WINDOW), { passive: true });
window.addEventListener('orientationchange', () => {
  /* After orientation change the layout viewport reflows before the visual
   * viewport stabilises.  Reset the event-gap timer so the first post-change
   * vvp event is not treated as a streaming frame. */
  _lastViewportEventTs = 0;
  _viewportEventGap    = Infinity;
  _scheduleVP(_VPReason.WINDOW);
}, { passive: true });

function _restoreViewportLifecycle() {
  _lastViewportEventTs = 0;
  _viewportEventGap    = Infinity;

  /* Preserve physical render state; invalidate only layout measurements. */
  _barHeight   = -1;
  _lastSpacerH = -1;
  _scheduleVP(_VPReason.WINDOW);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    _restoreViewportLifecycle();
  }
});

window.addEventListener('pageshow', _restoreViewportLifecycle, { passive: true });

/* ── RESIZE OBSERVER ─────────────────────────────────────────────────────── */
/*
 * Watches the chatbar for height changes (e.g. textarea growing as user types).
 *
 * ResizeObserver invariants (Invariant I7):
 *  - We update _barHeight in the observer callback, then schedule a VP commit.
 *  - The VP commit re-reads offsetHeight with forceHeight=true because the
 *    reason includes BAR_SIZE.
 *  - Writing the spacer in the commit does NOT change chatbarWrap's height
 *    (the spacer is a sibling in the scroll container, not an ancestor).
 *  - Therefore no feedback loop is possible.
 *
 * We compare against the freshly-read value before scheduling to avoid
 * spurious commits when rounding differs between borderBoxSize and offsetHeight.
 */
if (chatbarWrap && typeof ResizeObserver === 'function') {
  const _barRO = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;

    const bs   = entry.borderBoxSize;
    const rawH = bs
      ? (Array.isArray(bs) && bs[0]
          ? bs[0].blockSize
          : (typeof bs.blockSize === 'number' ? bs.blockSize : 0))
      : entry.contentRect.height;
    const rounded = Math.max(0, Math.round(rawH));

    /* Update the cache immediately so _measureBarBox does not re-read from
     * DOM on the next BAR_SIZE commit (it will be forced to, but having the
     * value early prevents a second layout read). */
    if (rounded === _barHeight) return;
    _barHeight = rounded;
    _scheduleVP(_VPReason.BAR_SIZE);
  });
  _barRO.observe(chatbarWrap);
}

/* ── THEME / PREFERENCES ─────────────────────────────────────────────────── */
/*
 * _invalidateGeometryCache marks the measured layout as stale so that the
 * next commit re-reads from DOM.  It NEVER:
 *   - clears _renderState.appliedInset
 *   - clears _lastTransformStr
 *   - clears _lastKbInset
 *   - touches _kbOpen
 *
 * This guarantees Invariants I3 and I10: theme changes cannot inject a fake
 * keyboard-close/open into the geometry pipeline.
 */
function _invalidateGeometryCache(reason) {
  _barHeight   = -1;  /* force offsetHeight re-read */
  _lastSpacerH = -1;  /* force spacer re-write (theme may change safe-area) */
  /* Do NOT reset transform/inset/keyboard render state. */
  _scheduleVP(reason);
}

/*
 * Theme geometry schedule.
 *
 * MutationObserver coalescing: the observer may fire once for a class change
 * and once for a data-theme change in the same microtask batch.  Both calls
 * hit _scheduleVP which is guarded by _vpPending — only one RAF is queued.
 * If the first RAF runs between the two mutations, two commits happen in
 * consecutive frames.  Both converge to the same geometry because they read
 * the same physical viewport, so no error accumulates (Invariant I10).
 */
function _scheduleThemeGeometry() {
  _invalidateGeometryCache(_VPReason.THEME);
}

if (window.matchMedia) {
  let _themeMQ         = null;
  let _reducedMotionMQ = null;
  try { _themeMQ         = window.matchMedia('(prefers-color-scheme: dark)');      } catch (_e) {}
  try { _reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (_e) {}

  /* System colour-scheme change → re-measure layout, keep keyboard geometry. */
  const _onThemeChange = () => _scheduleThemeGeometry();

  const _onReducedMotionChange = (e) => {
    _prefersReducedMotion = !!(e && e.matches);
    _invalidateGeometryCache(_VPReason.PREFERENCE);

    /* If the plus menu is open and reduced-motion changed, snap it immediately
     * to avoid a broken mid-animation state. */
    if (_plusOpen && plusMenu) {
      if (_plusMenuTimer !== null) { clearTimeout(_plusMenuTimer); _plusMenuTimer = null; }
      plusMenu.style.transition = 'none';
      plusMenu.style.transform  = '';
      plusMenu.style.opacity    = '';
    }
  };

  if (_themeMQ) {
    if (_themeMQ.addEventListener) _themeMQ.addEventListener('change', _onThemeChange);
    else if (_themeMQ.addListener) _themeMQ.addListener(_onThemeChange);
  }
  if (_reducedMotionMQ) {
    if (_reducedMotionMQ.addEventListener) _reducedMotionMQ.addEventListener('change', _onReducedMotionChange);
    else if (_reducedMotionMQ.addListener) _reducedMotionMQ.addListener(_onReducedMotionChange);
  }
}

/* Catch manual class/data-theme mutations (e.g. in-app dark-mode toggle). */
if (typeof MutationObserver === 'function' && document.documentElement) {
  let _themeScheduled = false; /* coalesce within the same microtask */

  const _themeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' &&
          (mutation.attributeName === 'class' || mutation.attributeName === 'data-theme')) {
        if (!_themeScheduled) {
          _themeScheduled = true;
          /* Use a microtask to batch multiple attribute changes (class AND
           * data-theme) before scheduling the geometry commit. */
          Promise.resolve().then(() => {
            _themeScheduled = false;
            _scheduleThemeGeometry();
          });
        }
        break;
      }
    }
  });

  _themeObserver.observe(document.documentElement, {
    attributes     : true,
    attributeFilter: ['class', 'data-theme']
  });
}

/* ── INITIALISATION ──────────────────────────────────────────────────────── */
/*
 * First-frame setup.
 *
 * We remove the CSS transition immediately so the first geometry commit does
 * not animate from the initial HTML position to the correct position.
 *
 * We schedule via RAF so the browser has had one layout pass: offsetHeight
 * and getBoundingClientRect() return stable values inside the callback.
 *
 * Interaction fallback: if the RAF is throttled (background tab, low-power
 * mode), the first pointer or key event triggers a synchronous commit.
 */
(function _init() {
  if (chatbarWrap) {
    if (chatbarWrap.style.opacity === '0') chatbarWrap.style.opacity = '';
    /*
     * Disable wrapper transitions once so keyboard-following transform writes
     * remain frame-authoritative. We deliberately do not rewrite transition
     * inside the geometry RAF.
     */
    chatbarWrap.style.transition = 'none';
  }

  /* Initialise _lastTransformStr to match the DOM (no transform applied yet). */
  _lastTransformStr = 'none';

  _raf(() => _scheduleVP(_VPReason.INIT));

  /* Interaction fallback when rAF is throttled (background tab). */
  const _recoverOnce = () => {
    window.removeEventListener('pointerdown', _recoverOnce, true);
    window.removeEventListener('keydown',     _recoverOnce, true);
    if (_vpCommitCount > 0) return;

    /* Cancel any pending RAF to avoid a race between it and this synchronous
     * commit. */
    if (_vpRafId !== null) { _caf(_vpRafId); _vpRafId = null; }
    _vpPending     = false;
    _vpReasonFlags = _VPReason.INIT;
    _commitViewport(_now());
  };
  window.addEventListener('pointerdown', _recoverOnce, true);
  window.addEventListener('keydown',     _recoverOnce, true);
})();

/* ── SEND BUTTON ─────────────────────────────────────────────────────────── */

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
    if (_sendMode === 'cross' && pill && pill.classList.contains('non-ai-tab')) {
      if (input) input.value = '';
      pill.classList.remove('has-text');
      _setSendMode('send');
    }
  });
}

/* ── SCROLL TO MESSAGE ───────────────────────────────────────────────────── */

window._lastUserMsgEl = null;

function scrollToMsg(el) {
  if (!el || !scrollHost) return;

  /*
   * Cancel the pending RAF before starting a new logical operation. A previous
   * native smooth-scroll cannot be synchronously cancelled, so its settle
   * callback is token-guarded.
   */
  if (_scrollRafId !== null) {
    _caf(_scrollRafId);
    _scrollRafId = null;
  }

  const requestToken = _beginProgrammaticScroll('scroll-to-message', 0);

  _scrollRafId = _raf(() => {
    _scrollRafId = null;

    /* Ownership is validated before any shared-state mutation. */
    if (requestToken !== _programmaticScrollToken) return;

    const target = Math.max(0, el.offsetTop - _tabBarHeight - 8);

    if (_prefersReducedMotion) {
      scrollHost.scrollTop = target;
      _endProgrammaticScroll(requestToken);
      return;
    }

    /* This owner remains active until its own settle callback or supersession. */
    _programmaticUntil = 0;
    scrollHost.scrollTo({ top: target, behavior: 'smooth' });
    _lastScrollY = target;
    _resetScrollAccum();

    _programmaticSettleTimer = window.setTimeout(() => {
      if (requestToken !== _programmaticScrollToken) return;
      _endProgrammaticScroll(requestToken);
    }, 450);
  });
}

window.scrollToMsg = scrollToMsg;

/* ── HEADER / TAB SCROLL ─────────────────────────────────────────────────── */

const HIDE_ACCUM  = 40;
const SHOW_ACCUM  = 55;
const LOGO_THRESH = 10;

function _updateHeader(ts) {
  _rafPending = false;
  if (!scrollHost || !logoHeader || !tabBar) return;

  const now = (typeof ts === 'number' && ts > 0) ? ts : _now();

  /* Suppress header changes during programmatic scrolls. */
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
    _accumDown += Math.max(0, delta);
    if (_accumUp > 0) _accumUp = 0;
    if (!_isTabHidden && _accumDown >= HIDE_ACCUM) {
      tabBar.classList.add('hide');
      _isTabHidden = true;
      _accumDown   = 0;
    }
  } else if (_velocityEMA < -0.05) {
    _accumUp += Math.max(0, -delta);
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

/* ── INPUT / PILL ────────────────────────────────────────────────────────── */

if (pill && input) {
  /* Focus the input when the user taps the pill background area. */
  pill.addEventListener('pointerdown', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    /* Let plus button handle its own events. */
    if (plusBtn && target && (target === plusBtn || plusBtn.contains(target))) return;
    /* Only intercept taps on the pill itself or the input area. */
    if (
      target &&
      target !== pill &&
      target !== input &&
      !target.closest('button, .overlay-input-wrap')
    ) return;
    /* Already focused or keyboard already open — let the browser handle it. */
    if (document.activeElement === input || _kbOpen || _lastKbInset > 0) return;

    e.preventDefault();
    _raf(() => {
      if (input && document.activeElement !== input) {
        input.focus({ preventScroll: true });
      }
    });
  }, { passive: false });

  /* Focus event: schedule a geometry re-read in case the virtual keyboard is
   * already visible when the element receives focus (e.g. focus via keyboard
   * navigation while the keyboard is already open on a prior field). */
  input.addEventListener('focus', () => {
    _scheduleVP(_VPReason.VIEWPORT);
  });

  /* Input event: pill visual state.  Bar height changes are handled by
   * ResizeObserver; no manual geometry schedule needed here. */
  input.addEventListener('input', () => {
    const hasText = input.value.trim().length > 0;
    pill.classList.toggle('has-text', hasText);
    if (pill.classList.contains('non-ai-tab')) {
      _setSendMode(hasText ? 'cross' : 'send');
    }
  });
}

/* ── PLUS MENU ───────────────────────────────────────────────────────────── */

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

  /* Force style flush before animating to ensure the "from" state is applied. */
  void plusMenu.offsetWidth;

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

if (plusMenu && plusBtn) {
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

/* ── TAB BAR ─────────────────────────────────────────────────────────────── */

let _currentTabKey = (() => {
  if (!tabBar) return 'ai';
  const a = tabBar.querySelector('.tab.active');
  return a ? (a.getAttribute('data-tab') || 'ai') : 'ai';
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
    if (!isActiveRequest()) return;

  } catch (err) {
    if (isActiveRequest()) {
      pageContent.innerHTML = '<div class="tab-empty"><p>Coming soon</p></div>';
    }
    console.warn('[atkyn] Tab module load failed:', key, err);
  }
}

function _loadModuleCSS(key) {
  const id = '_atkyn_css_' + key;
  if (document.getElementById(id)) return;
  const link   = document.createElement('link');
  link.id      = id;
  link.rel     = 'stylesheet';
  link.href    = 'modules/' + key + '/' + key + '.css';
  document.head.appendChild(link);
}

function _loadScript(src) {
  if (_scriptLoadPromises[src]) return _scriptLoadPromises[src];
  _scriptLoadPromises[src] = new Promise((resolve, reject) => {
    const s      = document.createElement('script');
    s.src        = src;
    s.async      = true;
    const cleanup = () => { s.onload = null; s.onerror = null; };
    s.onload     = () => { cleanup(); resolve(); };
    s.onerror    = (err) => { cleanup(); delete _scriptLoadPromises[src]; reject(err); };
    document.head.appendChild(s);
  });
  return _scriptLoadPromises[src];
}

/* ── CONTENT SWAP ANIMATION ─────────────────────────────────────────────── */

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

  /* Force style flush so the "from" state is committed before animating. */
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

/* ── TAB CLICK ───────────────────────────────────────────────────────────── */

let _activeTabEl = tabBar ? tabBar.querySelector('.tab.active') : null;

if (tabBar) {
  tabBar.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const tab    = target ? target.closest('.tab') : null;
    if (!tab || tab.classList.contains('active')) return;

    const key = tab.getAttribute('data-tab');
    if (!key) return;

    const requestId = _nextTabLoadRequestId();

    /* Persist AI chat state before leaving. */
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
      /*
       * Start a new shared operation. This deterministically supersedes any
       * older scrollToMsg or keyboard-anchor operation.
       */
      const tabScrollToken = _beginProgrammaticScroll('tab-switch', 0);

      scrollHost.scrollTop = 0;
      _lastScrollY         = 0;
      _resetScrollAccum();

      _raf(() => {
        /*
         * Validate ownership FIRST. A stale tab RAF must never clear state
         * belonging to a newer tab or programmatic scroll operation.
         */
        if (requestId !== _tabLoadRequestId ||
            tabScrollToken !== _programmaticScrollToken ||
            !scrollHost) {
          return;
        }

        _endProgrammaticScroll(tabScrollToken);
        _lastScrollY = scrollHost.scrollTop;
      });
    }

    /* Content changes may affect layout; they never erase physical keyboard
     * state.  _invalidateGeometryCache preserves _lastTransformStr and
     * _renderState.appliedInset (Invariant I3). */
    _invalidateGeometryCache(_VPReason.WINDOW);

    /* Reset header visibility state on tab switch. */
    if (logoHeader && _isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
    if (tabBar && _isTabHidden)         { tabBar.classList.remove('hide');          _isTabHidden     = false; }
    if (tabBar && _isTabScrolled)       { tabBar.classList.remove('scrolled');      _isTabScrolled   = false; }

    /* Geometry commit before module load (layout may change). */
    _scheduleVP(_VPReason.WINDOW);

    await _loadTab(key, requestId);

    /* Geometry commit after module load (content height may change). */
    _scheduleVP(_VPReason.WINDOW);

    if (!_isCurrentTabRequest(key, requestId)) return;
    _animateContentIn();
  }, { passive: true });
}

/* ── PUBLIC API ──────────────────────────────────────────────────────────── */

window._atkynModuleCache = _moduleCache;
window._atkynPageContent = pageContent;
window._atkynAnimateIn   = _animateContentIn;
window._atkynLoadTab     = _loadTab;

/*
 * _atkynViewportDebug()
 *
 * Returns a complete snapshot of every geometry variable.  Useful for
 * diagnosing any of the 19 critical areas documented in the spec.
 *
 * physicalOverlap > 0  means the bar is still overlapping the keyboard.
 * physicalOverlap <= 0 means the bar is fully above (or at) the keyboard edge.
 */
window._atkynViewportDebug = () => {
  const rect = chatbarWrap ? chatbarWrap.getBoundingClientRect() : null;

  const layoutHeight = _layoutViewportHeight();
  const visibleBottom = _viewportState.geometryValid
    ? _viewportState.visualBottom
    : (vvp ? null : layoutHeight);

  const renderedBottom = rect && Number.isFinite(rect.bottom) ? rect.bottom : null;
  const baseBottom     = renderedBottom !== null
    ? renderedBottom + _renderState.appliedInset
    : null;
  const expectedBottom = baseBottom !== null
    ? baseBottom - _lastKbInset
    : null;

  let computedTransform = null;
  if (chatbarWrap) {
    try { computedTransform = getComputedStyle(chatbarWrap).transform; } catch (_e) {}
  }

  return {
    /* ── Viewport ── */
    viewportState: {
      layoutViewportHeight    : _viewportState.layoutHeight,
      visualViewportHeight    : _viewportState.visualHeight,
      visualViewportOffsetTop : _viewportState.visualOffsetTop,
      visualViewportBottom    : _viewportState.visualBottom,
      hasVisualViewport       : _viewportState.hasVisualViewport,
      geometryValid           : _viewportState.geometryValid
    },
    /* ── Layout ── */
    layoutState: {
      chatbarHeight : _layoutState.chatbarHeight,
      baseBottom    : _layoutState.baseBottom
    },
    /* ── Keyboard (behavioural) ── */
    keyboardState: {
      inset     : _keyboardState.inset,
      open      : _keyboardState.open,
      animating : _keyboardState.animating
    },
    /* ── Render (authoritative written state) ── */
    renderState: {
      appliedInset        : _renderState.appliedInset,
      appliedTransform    : _renderState.appliedTransform,
      appliedSpacerHeight : _renderState.appliedSpacerHeight
    },
    /* ── Bar rect ── */
    barRect: rect ? {
      top    : rect.top,
      bottom : rect.bottom,
      height : rect.height
    } : null,
    renderedBottom,
    expectedBottom,
    visibleBottom,
    physicalOverlap : renderedBottom !== null && visibleBottom !== null
      ? renderedBottom - visibleBottom
      : null,
    /* ── Scroll ── */
    scrollHost: scrollHost ? {
      scrollTop    : scrollHost.scrollTop,
      clientHeight : scrollHost.clientHeight,
      scrollHeight : scrollHost.scrollHeight
    } : null,
    /* ── Internals ── */
    barHeightCache  : _barHeight,
    kbInset         : _lastKbInset,
    kbOpen          : _kbOpen,
    lastTransform   : _lastTransformStr,
    lastSpacer      : _lastSpacerH,
    commits         : _vpCommitCount,
    pending         : _vpPending,
    reasonFlags     : _vpReasonFlags,
    generation      : _geometryGeneration,
    eventGap        : _viewportEventGap,
    programmaticScrollOwner: _programmaticOwner,
    programmaticScrollToken: _programmaticScrollToken,
    /* ── DOM inspection ── */
    domTransition   : chatbarWrap ? chatbarWrap.style.transition : null,
    computedTransform,
    /* ── Preferences ── */
    reducedMotion   : _prefersReducedMotion,
    /* ── Theme ── */
    themeClass      : document.documentElement ? document.documentElement.className           : null,
    themeData       : document.documentElement ? document.documentElement.getAttribute('data-theme') : null
  };
};
