/* ═══════════════════════════════════════════════════════════════════
   core.js — Atkyn shared UI logic
   [PRODUCTION — UNIFIED VIEWPORT PIPELINE / MEASURED-GEOMETRY MODEL]

   scroll · header animation · unified viewport tracking · tab navigation

   ── GEOMETRY CONTRACT ─────────────────────────────────────────────
   ONE owner for chatbar geometry: _commitViewport().
   Every other subsystem (VisualViewport, ResizeObserver, matchMedia,
   window resize, orientationchange, visibilitychange, pageshow, init,
   tab switch) may ONLY invalidate + schedule. Nothing else may write:

       chatbarWrap.style.transform / height / bottom / top / opacity
       chatSpacer.style.height
       any keyboard or viewport compensation

   ── COORDINATE SYSTEM (single, consistent) ────────────────────────
   Every length used in the inset calculation is expressed in
   LAYOUT-VIEWPORT CSS PIXELS — the same space getBoundingClientRect()
   returns. Specifically:

       visualBottom = visualViewport.offsetTop + visualViewport.height

   Both terms are defined by the VisualViewport spec in CSS pixels
   relative to the layout viewport, so their sum is the bottom edge of
   the visible area in exactly the space rect.bottom lives in. Nothing
   is mixed: no innerHeight, no screen height, no device pixels, and no
   scale multiplication (scale is validated, not applied — with
   `maximum-scale=1, user-scalable=no` it is always 1, and offsetTop/
   height are already layout-space values).

   ── THE ONE EQUATION ──────────────────────────────────────────────
       baseBottom   = chatbar bottom edge with OUR transform removed
       requiredLift = baseBottom - visualBottom
       inset        = max(0, round(requiredLift))
       transform    = inset > 0 ? translateY(-inset px) : none

   After applying it, the rendered bottom edge sits exactly on
   visualBottom, so the WHOLE bar (full border-box height, never just its
   top edge) is inside the visible viewport.

   Because baseBottom is measured, this is correct under BOTH keyboard
   models with no branching and no mode detection:
     • Android Chromium with `interactive-widget=resizes-content` (set in
       index.html): the ICB shrinks, the body flex column shrinks with it,
       CSS has already lifted the bar ⇒ baseBottom == visualBottom ⇒
       inset 0 ⇒ JS writes nothing. (Compensating here would be the
       classic DOUBLE TRANSLATION.)
     • iOS Safari (ignores interactive-widget): the layout viewport does
       not shrink ⇒ baseBottom stays put while visualBottom rises ⇒
       inset == keyboard height ⇒ JS lifts it by exactly that.

   ── NO TRANSFORM TRANSITIONS ──────────────────────────────────────
   Keyboard correction is applied immediately on every committed frame.
   core.js never writes a CSS transition for `transform`, and pins
   `transition: none` on .chatbar-wrap once at init so that no stylesheet
   can animate our writes and make the bar lag the viewport. The pill's
   own decorative transitions (border-color / box-shadow on #pill) are
   untouched — they live on a child element.

   ── NO COMPOSITOR LAYER ───────────────────────────────────────────
   translateY only, never translate3d/translateZ. search.css/chatbar.css
   documents that a promoted layer on .chatbar-wrap clips #pill's
   :focus-within box-shadow at the layer paint boundary on some mobile
   WebKit builds — which presents to the user as a "cut" / half pill.
   At rest the transform is the literal string 'none', so the element
   has no transform, no layer and no containing-block side effects.
   ════════════════════════════════════════════════════════════════════ */

'use strict';

let _prefersReducedMotion = !!(window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const EASE = {
  keyboardMove : 'cubic-bezier(0.32, 0.72, 0, 1)',
  menuOpen     : 'cubic-bezier(0.32, 0.72, 0, 1)',
  menuClose    : 'cubic-bezier(0.4, 0, 1, 1)',
  contentSwap  : 'cubic-bezier(0.16, 1, 0.3, 1)'
};

/* ── Frame / clock primitives (defensive) ───────────────────────────
   requestAnimationFrame and performance.now() exist in every engine this
   app targets, but resolving them UNGUARDED at load time would make the
   whole controller throw if either is missing (old webviews, unusual
   embedders, sandboxed previews). Everything downstream routes through
   these aliases so a missing primitive degrades instead of being fatal.
   They add no delay to normal operation.                            */
const _now = (window.performance && typeof window.performance.now === 'function')
  ? () => window.performance.now()
  : () => Date.now();

const _raf = (typeof window.requestAnimationFrame === 'function')
  ? window.requestAnimationFrame.bind(window)
  : (cb) => window.setTimeout(() => cb(_now()), 16);

const _caf = (typeof window.cancelAnimationFrame === 'function')
  ? window.cancelAnimationFrame.bind(window)
  : (id) => window.clearTimeout(id);

/* ── DOM references (all optional — every consumer null-guards) ── */
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

/* Read once. Used only as a scroll offset for message anchoring — never for
   chatbar geometry, which is always measured live. */
const _tabBarHeight = tabBar ? tabBar.offsetHeight : 0;

const SVG_SEND  = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="5 11 12 4 19 11"/></svg>';
const SVG_CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/* ════════════════════════════════════════════════════════════════════
   RENDER STATE — the single authoritative record of what is on screen.

   Invariant H: the DOM, appliedInset, appliedTransform, keyboardInset and
   the measured rectangle must never disagree. Two mechanisms enforce it:

     1. Only _applyBarGeometry() writes the transform, and it updates
        appliedInset/appliedTransform in the same synchronous step as the
        DOM write — there is no window in which they can diverge.
     2. When the base position is re-derived, the CURRENTLY APPLIED offset
        is parsed back out of the element's own inline style rather than
        read from this object. So even a hypothetical divergence is
        self-correcting: measurement always trusts the DOM.
   ════════════════════════════════════════════════════════════════════ */
const _renderState = {
  appliedInset    : 0,     // px currently baked into the DOM transform
  appliedTransform: 'none',// exact string currently on the element
  keyboardInset   : 0,     // last committed required lift (=== appliedInset)
  barHeight       : 0,     // last measured border-box height (incl. safe-area)
  baseBottom      : 0,     // last measured untransformed bottom (layout coords)
  visualBottom    : 0,     // last valid visual-viewport bottom (layout coords)
  spacerHeight    : -1,    // last written spacer height (write dedupe)
  sampleValid     : false, // did the last viewport sample pass validation?
  lastValidSample : 0,     // timestamp of the last accepted sample
  commits         : 0,     // geometry writes performed
  generation      : 0,     // monotonic commit counter (stale-callback audit)
  invalidSamples  : 0      // transient samples rejected (diagnostics)
};

/* Derived, diagnostic only. NEVER gates rendering (invariant I2): the
   commit renders from the measured inset, not from a keyboard boolean. */
function _keyboardActive() { return _renderState.appliedInset > 0; }

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
let _programmaticUntil     = 0;   // post-anchor settle grace window
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

/* ════════════════════════════════════════════════════════════════════
   UNIFIED VIEWPORT / CHATBAR GEOMETRY PIPELINE
   ════════════════════════════════════════════════════════════════════ */

/* Pipeline gate — N invalidations in one frame collapse into ONE commit. */
let _vpPending = false;
let _vpRafId   = null;

/* Reason flags. Purely diagnostic now: geometry is re-measured on every
   commit and always applied immediately, so no path depends on the reason. */
const _VPReason = {
  VIEWPORT : 1,   // visualViewport resize / scroll
  BAR_SIZE : 2,   // ResizeObserver on .chatbar-wrap
  THEME    : 4,   // prefers-color-scheme / prefers-reduced-motion changed
  WINDOW   : 8,   // window resize / orientationchange / visibility / pageshow
  INIT     : 16   // first run
};
let _vpReasonFlags = 0;

/* ── READ helpers (read-only; safe to batch, no writes interleaved) ── */

function _layoutViewportHeight() {
  const de = document.documentElement;
  const h  = de ? de.clientHeight : 0;
  return (typeof h === 'number' && isFinite(h) && h > 0) ? h : window.innerHeight;
}

/*
 * Extract the translateY currently applied to the chatbar wrapper.
 *
 * We read the ELEMENT'S OWN INLINE STYLE, not _renderState, so the
 * base-position derivation can never be corrupted by a stale internal
 * value (invariant D / H). We are the only writer of this property, and
 * no transform transition is ever applied to it, so the inline value is
 * exactly what is rendered this frame — there is no interpolated state
 * to guess at.
 */
function _parseTranslateY(str) {
  if (!str || str === 'none') return 0;

  // Our own canonical form.
  let m = /translateY\(\s*(-?[\d.]+)px\s*\)/.exec(str);
  if (m) {
    const v = parseFloat(m[1]);
    return isFinite(v) ? v : 0;
  }

  // Defensive: a computed matrix(a,b,c,d,e,f) — f is the Y translation.
  m = /matrix\(([^)]+)\)/.exec(str);
  if (m) {
    const parts = m[1].split(',');
    if (parts.length >= 6) {
      const v = parseFloat(parts[5]);
      return isFinite(v) ? v : 0;
    }
  }

  return 0;
}

/*
 * Canonical form for the neutral transform. The DOM reports an unset inline
 * transform as '' while we write the literal 'none'; the two are semantically
 * identical (no transform, no layer) and MUST compare equal, otherwise the
 * write-dedupe sees a phantom change and the render state drifts away from the
 * DOM on the very first commit.
 */
function _normalizeTransform(str) {
  return (!str || str === 'none') ? 'none' : str;
}

/*
 * Measure the chatbar box and its UNTRANSFORMED bottom edge.
 * Returns null when the element is not measurable this frame — the caller
 * must then PRESERVE the last valid geometry rather than guess.
 */
function _measureBar() {
  if (!chatbarWrap) return null;

  // offsetHeight is the border-box height and is TRANSFORM-INDEPENDENT.
  // It already includes chatbar.css's
  //   padding-bottom: calc(12px + env(safe-area-inset-bottom))
  // so safe-area is counted exactly once here and JS never adds it again.
  const height = chatbarWrap.offsetHeight;
  if (!isFinite(height) || height <= 0) return null;

  // getBoundingClientRect() DOES include transforms, so our own applied
  // offset must be UNDONE to recover the base (untransformed) position.
  //
  //   renderedBottom = baseBottom + ty        (ty is negative when lifted)
  //   ⇒ baseBottom   = renderedBottom - ty
  //
  // Using `+ ty` here instead would DOUBLE the previous lift on every commit —
  // the recursive error
  //   previous transform → measurement → wrong new inset → bigger transform …
  // that makes the bar run away or stick at the wrong offset. Skipping the
  // correction entirely has the opposite failure: the previous inset is
  // re-measured as already-correct, so the bar settles at half the required
  // lift and stays clipped behind the keyboard.
  const rect = chatbarWrap.getBoundingClientRect();
  if (!isFinite(rect.bottom)) return null;

  const applied    = _parseTranslateY(chatbarWrap.style.transform); // ty, ≤ 0
  const baseBottom = rect.bottom - applied;
  if (!isFinite(baseBottom)) return null;

  return { height: Math.round(height), baseBottom: baseBottom, applied: applied };
}

/*
 * Validate the VisualViewport sample.
 * Returns { visualBottom } in layout CSS pixels, or null if the sample is
 * unusable (non-finite, non-positive, or mid-resize garbage). A null result
 * means "hold the last valid geometry" — never "assume the keyboard closed".
 */
function _readViewportSample() {
  const h = vvp.height;
  const t = vvp.offsetTop;
  const s = vvp.scale;

  if (typeof h !== 'number' || !isFinite(h) || h <= 0) return null;
  if (typeof t !== 'number' || !isFinite(t) || t <  0) return null;
  // scale is VALIDATED, not multiplied in: offsetTop/height are already
  // layout-viewport CSS pixels. A non-finite or non-positive scale means the
  // engine is mid-transition and the whole sample is untrustworthy.
  if (typeof s !== 'number' || !isFinite(s) || s <= 0) return null;

  const visualBottom = t + h;
  if (!isFinite(visualBottom) || visualBottom <= 0) return null;

  return { visualBottom: visualBottom, height: h, offsetTop: t, scale: s };
}

/* ── Schedule a pipeline run (coalesced: N invalidations → 1 commit) ── */
function _scheduleVP(reason) {
  _vpReasonFlags |= (reason || 0);
  if (_vpPending) return;       // already queued — reasons accumulate
  _vpPending = true;
  _vpRafId   = _raf(_commitViewport);
}

/* ── The ONLY writer of chatbar geometry ── */
function _applyBarGeometry(inset, transformStr) {
  _renderState.appliedInset     = inset;
  _renderState.appliedTransform = transformStr;
  _renderState.keyboardInset    = inset;
  chatbarWrap.style.transform   = transformStr;
}

/* ── THE COMMIT ── */
function _commitViewport(now) {
  /* rAF passes a timestamp; direct calls may not. */
  if (typeof now !== 'number') now = _now();

  _vpPending     = false;
  _vpRafId       = null;
  const reasons  = _vpReasonFlags;
  _vpReasonFlags = 0;

  if (!chatbarWrap) return;

  /* ══ READ PHASE — every layout read happens here, before any write, so the
        frame performs at most one forced layout. ══ */

  const bar = _measureBar();

  // Unmeasurable (display:none, detached, zero box): preserve the last valid
  // rendered geometry. Writing anything now would be a guess.
  if (!bar) return;

  // The DOM is the source of truth for what is currently rendered. Mirroring it
  // into _renderState on every commit makes "state says X but DOM has Y"
  // structurally impossible, and makes an external mutation self-correcting on
  // the next commit instead of being adopted silently.
  const domTransform = _normalizeTransform(chatbarWrap.style.transform);
  _renderState.appliedTransform = domTransform;
  _renderState.appliedInset     = -_parseTranslateY(chatbarWrap.style.transform);

  const layoutH = _layoutViewportHeight();

  let visualBottom;
  if (vvp) {
    const sample = _readViewportSample();
    if (!sample) {
      // Transient / invalid sample (Android mid-resize, theme repaint,
      // bfcache restore, orientation flip). HOLD the current geometry until a
      // valid sample arrives — do not fake a keyboard close.
      _renderState.sampleValid = false;
      _renderState.invalidSamples++;
      // Guarantee a re-evaluation even if the engine sends no further events.
      _scheduleVP(_VPReason.VIEWPORT);
      return;
    }
    visualBottom = sample.visualBottom;
  } else {
    // No VisualViewport API: the keyboard inset is unknowable, and on such
    // engines the layout viewport resizes with the keyboard anyway, so CSS
    // owns it. The layout bottom IS the visible bottom — consistent, not a
    // special case.
    visualBottom = layoutH;
  }

  if (!isFinite(visualBottom) || !isFinite(layoutH) || layoutH <= 0) {
    _renderState.sampleValid = false;
    return;
  }

  /* ══ CALCULATE PHASE — pure arithmetic in ONE coordinate space ══ */

  // How far the bar's bottom edge currently hangs below the visible bottom.
  const requiredLift = bar.baseBottom - visualBottom;

  // Derived bound (not an arbitrary clamp): a lift larger than the entire
  // layout viewport is definitionally impossible, so such a value means the
  // sample and the layout disagree this frame. Hold rather than teleport.
  if (requiredLift > layoutH) {
    _renderState.sampleValid = false;
    _renderState.invalidSamples++;
    _scheduleVP(_VPReason.VIEWPORT);
    return;
  }

  const inset = requiredLift > 0 ? Math.round(requiredLift) : 0;

  // Always derived from the clean base state. Never accumulated, never
  // expressed as "current transform + delta".
  const transformStr = inset > 0 ? ('translateY(' + (-inset) + 'px)') : 'none';

  // Spacer = the bar's real footprint + the lift. Both terms are needed and
  // neither double-counts:
  //   • barHeight reserves the space the bar visually occupies at the bottom
  //     of the scrollable content (it already contains safe-area, once).
  //   • inset restores the trailing scroll room that the keyboard took away
  //     on engines where the layout viewport did NOT shrink (iOS). On Android
  //     resizes-content inset is 0, so nothing extra is added — the layout
  //     resize already did it.
  const spacerH = bar.height + inset;

  const transformChanged = transformStr !== domTransform;
  const spacerChanged    = chatSpacer && spacerH !== _renderState.spacerHeight;

  /* ══ WRITE PHASE — transform and spacer land in the SAME frame, so the
        wrapper, the pill and the content compensation can never disagree,
        not even for one frame. ══ */

  if (transformChanged || spacerChanged) {
    _renderState.generation++;
    _renderState.commits++;

    // Geometry first (invariant I12): no scroll, header or tab bookkeeping can
    // delay or block the visual correction.
    if (transformChanged) _applyBarGeometry(inset, transformStr);

    if (spacerChanged) {
      _renderState.spacerHeight = spacerH;
      chatSpacer.style.height   = spacerH + 'px';
    }

    // Then the purely cosmetic scroll anchor. It runs AFTER the geometry
    // write, so no scroll bookkeeping can ever delay the visual correction.
    if (inset > 0) _maybeAnchorOnKeyboardOpen(now);
  }

  // The bar is back at its CSS baseline: re-arm the anchor for the next
  // keyboard-open episode. Kept here (not in a second event listener) so there
  // is exactly one owner of this state and no duplicate observers.
  if (inset === 0) _clearAnchorLatch();

  _renderState.barHeight    = bar.height;
  _renderState.baseBottom   = bar.baseBottom;
  _renderState.visualBottom = visualBottom;
  _renderState.sampleValid  = true;
  _renderState.lastValidSample = now;

  void reasons; // retained for debugging; no behaviour depends on it
}

/* ── Scroll anchoring when the keyboard first lifts the bar ──
   Scroll state ONLY. It never touches chatbar geometry, and it yields to a
   programmatic scroll that is still settling so the two cannot fight. */
let _anchorDoneForInset = 0;

function _maybeAnchorOnKeyboardOpen(now) {
  // Anchor once per keyboard-open episode, not on every frame of the ramp.
  if (_anchorDoneForInset > 0) return;
  _anchorDoneForInset = _renderState.appliedInset;

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

  // Synchronous hand-back plus a short settle grace window: deterministic
  // final scroll state, no header flicker while the browser settles, and no
  // rAF that could clear the flag either too early or too late.
  _programmaticScroll = false;
  _programmaticUntil  = now + 400;
}

/* Reset the episode latch whenever the bar returns to baseline. */
function _clearAnchorLatch() { _anchorDoneForInset = 0; }

/* ════════════════════════════════
   EVENT WIRING
   Handlers only mark the pipeline dirty. They never read or write geometry.
════════════════════════════════ */

function _onViewportEvent() { _scheduleVP(_VPReason.VIEWPORT); }

if (vvp) {
  vvp.addEventListener('resize', _onViewportEvent, { passive: true });
  vvp.addEventListener('scroll', _onViewportEvent, { passive: true });
}
/* No VisualViewport fallback: deliberately does nothing beyond the window
   resize listener below. An earlier revision pinned
   `document.body.style.height = innerHeight` here. That fought the CSS flex
   column that owns the chatbar's base position, in exactly the engines it was
   meant to help, and bought nothing — with no visualViewport there is no
   measurable inset, so the neutral state is already correct. */

window.addEventListener('resize', () => _scheduleVP(_VPReason.WINDOW), { passive: true });

window.addEventListener('orientationchange', () => _scheduleVP(_VPReason.WINDOW), { passive: true });

/* Returning to the foreground, or restoring from bfcache, can leave a stale
   keyboard state from before the page was hidden. Re-validate from real
   geometry instead of trusting whatever was last rendered. */
function _onResume() { _scheduleVP(_VPReason.WINDOW); }

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _onResume();
});
window.addEventListener('pageshow', _onResume);
window.addEventListener('focus', _onResume);

/* ════════════════════════════════
   RESIZE OBSERVER — bar box only.
   It reads, compares and invalidates. It NEVER writes styles, so it cannot
   feed itself (invariant I7).
════════════════════════════════ */

if (chatbarWrap && typeof ResizeObserver === 'function') {
  const _barRO = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;

    const bs   = entry.borderBoxSize;
    const raw  = bs ? (bs[0] ? bs[0].blockSize : bs.blockSize) : entry.contentRect.height;
    const rounded = Math.round(raw);
    if (!isFinite(rounded) || rounded <= 0) return;

    // Dedupe: absorb sub-pixel noise and repeated identical notifications.
    if (rounded === _renderState.barHeight) return;

    _scheduleVP(_VPReason.BAR_SIZE);
  });
  _barRO.observe(chatbarWrap);
}

/* NOTE — no global "ResizeObserver loop" error suppression here (deliberate).

   1. It cannot originate from this file: the observer callback above performs
      ZERO synchronous style writes, and the commit it schedules writes only
      `transform` (which never changes a border box) and `#chatSpacer`'s
      height. #chatSpacer lives inside #scrollHost — a scroll container and a
      SIBLING of .chatbar-wrap — so its content height cannot resize the
      observed element either.
   2. index.html loads lightweight-charts, KaTeX and highlight.js, and every
      lazily loaded module script may create its own observers. A global
      handler calling stopImmediatePropagation()/preventDefault() on any
      "ResizeObserver loop" message would silently mask a genuine layout loop
      from those, hiding real bugs to keep the console quiet.

   The loop is prevented by architecture, not by suppression. */

/* ════════════════════════════════
   THEME / PREFERENCE CHANGE
   The system preference is the ONLY theme source. There is no toggle, no
   persisted theme and no JS-written theme class: CSS media queries own the
   visuals, JS only re-validates geometry after they re-apply.
════════════════════════════════ */

/*
 * A theme change can alter border, radius, shadow, font rendering and CSS
 * variables, so the measured box must be taken again. It must NOT reset the
 * keyboard state — and with this architecture it structurally cannot, because
 * there is no keyboard boolean to reset. The inset is re-derived from live
 * geometry, and a theme change does not move the layout viewport, so the same
 * inset is recomputed and the write is deduped away: zero visible movement.
 *
 * Equally important: index.html swaps the highlight.js stylesheet via
 * media="(prefers-color-scheme: …)", so a theme flip triggers a real style
 * recalc. Frame 1 of the commit already runs after that recalc; one extra
 * re-validation frame catches late font/metric application. Both frames
 * dedupe, so the user sees exactly one stable geometry and never an
 * intermediate state. No timeouts are involved.
 */
if (window.matchMedia) {
  let themeMQ         = null;
  let reducedMotionMQ = null;
  try { themeMQ         = window.matchMedia('(prefers-color-scheme: dark)'); }      catch (_) {}
  try { reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (_) {}

  const _onThemeChange = () => {
    _scheduleVP(_VPReason.THEME);
    _raf(() => { _raf(() => _scheduleVP(_VPReason.THEME)); });
  };

  const _onReducedMotionChange = (e) => {
    _prefersReducedMotion = !!(e && e.matches);

    // Reduced motion changes ANIMATION POLICY ONLY. Chatbar geometry is never
    // transitioned in this implementation, so there is nothing to unwind and
    // nothing to disable — correction stays exactly as immediate as before.
    if (_prefersReducedMotion && _plusOpen && plusMenu) {
      if (_plusMenuTimer) { clearTimeout(_plusMenuTimer); _plusMenuTimer = null; }
      plusMenu.style.transition = 'none';
      plusMenu.style.transform  = '';
      plusMenu.style.opacity    = '';
    }

    _scheduleVP(_VPReason.THEME);
  };

  if (themeMQ) {
    if (themeMQ.addEventListener)      themeMQ.addEventListener('change', _onThemeChange);
    else if (themeMQ.addListener)      themeMQ.addListener(_onThemeChange);
  }
  if (reducedMotionMQ) {
    if (reducedMotionMQ.addEventListener) reducedMotionMQ.addEventListener('change', _onReducedMotionChange);
    else if (reducedMotionMQ.addListener) reducedMotionMQ.addListener(_onReducedMotionChange);
  }
}

/* ════════════════════════════════
   INIT — first paint
   Deterministic: measure → read viewport → commit → visible. The chatbar is
   NEVER hidden while geometry is pending; opacity is not used to mask layout
   state, so no event sequence can leave it invisible.
════════════════════════════════ */

(function _init() {
  if (chatbarWrap) {
    // Recovery, not a visual trick: clear any inline style an earlier build
    // may have left behind, so the first committed geometry is the first thing
    // the user sees.
    if (chatbarWrap.style.opacity === '0') chatbarWrap.style.opacity = '';

    // Pin the transform as non-transitional ONCE. Requirement: keyboard
    // correction must be immediate per committed frame, and no stylesheet we
    // do not control may animate it. .chatbar-wrap has no decorative
    // transition of its own (background is transparent), so nothing is lost.
    chatbarWrap.style.transition = 'none';

    // Seed state from the DOM so appliedTransform can never start out lying.
    _renderState.appliedTransform = _normalizeTransform(chatbarWrap.style.transform);
    _renderState.appliedInset     = -_parseTranslateY(_renderState.appliedTransform);
    _renderState.keyboardInset    = _renderState.appliedInset;
  }

  /* Two rAF: the first lets stylesheets and webfonts settle into the box
     model, the second is the paint frame in which geometry is committed.
     Both run before any user interaction, so no movement is ever visible. */
  _raf(() => { _raf(() => { _scheduleVP(_VPReason.INIT); }); });

  /* Safety net: if rAF was throttled or stalled (background tab, aggressive
     power saving), the first interaction forces one synchronous commit. The
     bar can therefore never be left in an uncommitted state. */
  const _recoverOnce = () => {
    window.removeEventListener('pointerdown', _recoverOnce, true);
    window.removeEventListener('keydown', _recoverOnce, true);
    if (_renderState.commits > 0) return;
    if (_vpRafId !== null) { _caf(_vpRafId); _vpRafId = null; }
    _vpPending = false;
    _commitViewport(_now());
  };
  window.addEventListener('pointerdown', _recoverOnce, true);
  window.addEventListener('keydown', _recoverOnce, true);
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

    /* Animation bookkeeping only — it settles scroll state, never chatbar
       geometry, and is token-guarded against stale runs. */
    window.setTimeout(() => {
      if (requestToken !== _programmaticScrollToken) return;
      _endProgrammaticScroll();
    }, 450);
  });
}

window.scrollToMsg = scrollToMsg;

/* ════════════════════════════════
   HEADER / TAB SCROLL ANIMATION
   Lightweight: no layout reads beyond scrollTop, and normal scrolling never
   triggers a chatbar geometry commit.
════════════════════════════════ */

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

  const sy = scrollHost.scrollTop;
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

const _scheduleHeaderUpdate = _raf;

if (scrollHost) {
  scrollHost.addEventListener('scroll', () => {
    if (_programmaticActive()) {
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
    if (document.activeElement === input || _keyboardActive()) return;

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
    /* If the bar's box ever changes, ResizeObserver invalidates the pipeline.
       Nothing is written here: input/pill handlers never own geometry. */
  });
}

/* ════════════════════════════════
   PLUS MENU
   Fully independent from chatbar geometry. #plusMenu and #plusBackdrop are
   SIBLINGS of .chatbar-wrap (position: fixed), so translating the bar never
   moves or clips them, and they can never change the bar's measured box.
════════════════════════════════ */

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

/* ── Content swap animation ──
   Purely decorative and fully independent from chatbar geometry: it animates
   only #pageContent opacity/transform, so it cannot move the bar, corrupt
   viewport state, or feed the ResizeObserver. */
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

    /*
     * Toggling #chatArea / #pageContent display, injecting a module
     * stylesheet and swapping content can all change the document metrics or
     * the chatbar's box. Invalidate before and after the swap so the committed
     * geometry always reflects the tab now visible — returning to AI can never
     * inherit the previous tab's compensation. The commit re-measures and
     * dedupes, so this costs nothing when nothing actually changed.
     */
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

/* Read-only diagnostics (verification / QA; performs no geometry writes). */
window._atkynViewportDebug = () => ({
  barHeight       : _renderState.barHeight,
  kbInset         : _renderState.keyboardInset,
  appliedInset    : _renderState.appliedInset,
  appliedTransform: _renderState.appliedTransform,
  domTransform    : chatbarWrap ? chatbarWrap.style.transform : null,
  stateMatchesDom : chatbarWrap
    ? (_normalizeTransform(chatbarWrap.style.transform) === _renderState.appliedTransform)
    : null,
  kbOpen          : _keyboardActive(),
  baseBottom      : _renderState.baseBottom,
  visualBottom    : _renderState.visualBottom,
  spacer          : _renderState.spacerHeight,
  sampleValid     : _renderState.sampleValid,
  invalidSamples  : _renderState.invalidSamples,
  commits         : _renderState.commits,
  generation      : _renderState.generation,
  pending         : _vpPending,
  reasons         : _vpReasonFlags,
  reducedMotion   : _prefersReducedMotion
});
