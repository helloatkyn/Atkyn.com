/* ═══════════════════════════════════════════════════════════════════
   core.js — Atkyn shared UI logic [PRODUCTION — UNIFIED VIEWPORT PIPELINE v2]
   scroll · header animation · unified viewport tracking · tab navigation

   ── GEOMETRY CONTRACT ─────────────────────────────────────────────
   ONE owner for chatbar geometry: _commitViewport().
   Every other subsystem (VisualViewport, ResizeObserver, matchMedia,
   window resize, orientation, visibility, init, tab switch) may ONLY
   invalidate + schedule. Nothing else may write:

       chatbarWrap.style.transform / height / bottom / top / opacity
       chatSpacer.style.height
       any keyboard or viewport compensation

   Every commit is:  READ PHASE → CALCULATE PHASE → WRITE PHASE
   (no interleaved read/write, no forced layout inside a write, no
   magic timeouts affecting geometry, no transform accumulation —
   the transform is always derived from a clean base state).
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
   requestAnimationFrame and performance.now() exist in every target browser,
   but resolving them UNGUARDED at load time would make the WHOLE controller
   throw if any one of them is missing (old webviews, unusual embedders,
   sandboxed previews). Everything downstream — the geometry pipeline, the
   header rAF, scrollToMsg — routes through these three aliases, so a missing
   primitive degrades to a timer instead of being fatal. They add no delay to
   normal operation.                                                     */
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

/* Read once: only used as a scroll offset for message anchoring, never for
   chatbar geometry (chatbar height is always measured live). */
const _tabBarHeight = tabBar ? tabBar.offsetHeight : 0;

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
let _programmaticUntil     = 0;   // timestamp — post-anchor settle grace window
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

   ONE source of truth. ALL geometry changes go through _scheduleVP().
   Only _commitViewport() may write chatbar transform or spacer height.

   Geometry model (verified against index.html + search.css/chatbar.css):

     • .chatbar-wrap is `position: relative; flex-shrink: 0` and a DIRECT
       CHILD OF <body> — a flex sibling of #scrollHost, not a fixed overlay.
       So it occupies real space at the bottom of the body flex column.
     • #pill (.overlay-pill) is a fixed 60px box inside it; #cbInput is a
       single-line <input type="search"> that CANNOT grow. The wrapper height
       is therefore 60px + padding (incl. env(safe-area-inset-bottom)) and is
       theme-invariant (dark mode changes only colours/shadows, never box
       metrics). It is still measured live, never assumed.
     • #chatSpacer sits inside #chatArea inside #scrollHost, i.e. inside the
       scroll content — the correct place to reserve room.
     • #plusMenu / #plusBackdrop are SIBLINGS of .chatbar-wrap (position:
       fixed), so translating the bar never moves or clips them, and they can
       never change the bar's measured box.

   Ownership (exactly one owner per responsibility):
       BASE POSITION     = CSS only (flex column + safe-area padding).
                           JS never sets top/bottom/height/padding.
       KEYBOARD LIFT     = JS only: transform: translateY(-inset) on
                           .chatbar-wrap. translateY, never translate3d — see
                           the compositor-layer note at the write site.
       CONTENT SPACING   = JS only: #chatSpacer height =
                           measured wrapper border-box + inset.
       SAFE AREA         = CSS only. It is already inside the measured
                           border-box, so JS counts it exactly once.

   The inset is MEASURED, not modelled:
       inset = barBaseBottom - (vvp.offsetTop + vvp.height)
   where barBaseBottom comes from offsetTop/offsetHeight (transform- and
   transition-independent). This automatically yields 0 when CSS already
   placed the bar correctly (Android `interactive-widget=resizes-content`,
   declared in index.html) and the keyboard height when it could not (iOS
   Safari, which ignores that hint) — so double translation is impossible.
   ════════════════════════════════════════════════════════════════════ */

/*
 * Measured / committed state — written ONLY by _measureBarBox(),
 * _readKeyboard() and _commitViewport(). Never assumed, never hardcoded.
 */
let _barHeight        = -1;   // measured .chatbar-wrap border-box height
let _lastKbInset      = 0;    // last committed keyboard inset
let _lastSpacerH      = -1;   // last written spacer height (write dedupe)
let _lastTransformStr = null; // last written transform string (write dedupe)
let _kbOpen           = false;// committed keyboard state (hysteresis memory)
let _kbArmed          = false;// closed→open seen once, awaiting confirmation
let _lastViewportEventTs = 0; // timestamp of previous viewport event
let _viewportEventGap    = Infinity; // interval between consecutive viewport events
let _vpCommitCount    = 0;    // has the pipeline ever committed? (recovery gate)
let _geometryGeneration = 0;  // monotonic commit counter (diagnostics only)

/* Pipeline gate — one RAF per batch of invalidations */
let _vpPending   = false;
let _vpRafId     = null;

/* Animation cleanup timer — may only clear `transition`, never geometry */
let _cbTransitionTimer = null;

/* Reason flags — tells _commitViewport what changed this frame */
const _VPReason = {
  VIEWPORT  : 1,  // VisualViewport resize/scroll (or legacy resize fallback)
  BAR_SIZE  : 2,  // ResizeObserver — chatbar border-box height changed
  THEME     : 4,  // prefers-color-scheme / prefers-reduced-motion changed
  WINDOW    : 8,  // window resize / orientationchange / tab returned to front
  INIT      : 16  // first-run initialisation
};
let _vpReasonFlags = 0;

/* ── Keyboard-inset detection tuning ────────────────────────────────
   The inset is MEASURED, not modelled (see _measureBarBox):

       raw = barBaseBottom - (vvp.offsetTop + vvp.height)

   `raw` is simply "how many px of the chatbar's bottom edge currently hang
   below the bottom of the visible viewport", using the bar's UNTRANSFORMED
   position. That single quantity is correct on every engine:

     • Android Chrome with `interactive-widget=resizes-content` (declared in
       index.html) — the ICB shrinks, the body flex column shrinks with it and
       CSS has already lifted the bar ⇒ raw = 0 ⇒ JS writes nothing. Adding
       compensation here would be the classic DOUBLE TRANSLATION bug.
     • iOS Safari (ignores interactive-widget) — the layout viewport does not
       shrink, so the bar stays behind the keyboard ⇒ raw = keyboard height ⇒
       JS lifts it by exactly that.
     • Address-bar collapse/expand, and a stylesheet that pins the body to a
       non-tracking height — both fall out of the same measurement.

   Two guards sit on top of the measurement:

   1. HYSTERESIS absorbs sub-pixel rounding so a 1px residue can never become
      a permanent 1px lift:
        closed → open : raw must reach KB_OPEN_THRESH
        open   → close: raw must fall below KB_CLOSE_THRESH
      Because `raw` is exact, these can be tiny — the bar starts following the
      keyboard within a couple of pixels instead of after a 50px dead zone.

   2. TWO-FRAME CONFIRMATION of the closed → open transition. A single frame
      where the layout viewport and the visual viewport disagree (rotation,
      browser chrome, an engine updating one before the other) can produce a
      large transient `raw`. Requiring the next frame to agree removes that
      class of false positive entirely, and costs exactly one frame (~16ms) of
      onset latency on a real keyboard — imperceptible.

      Crucially the confirmation is SELF-HEALING: whenever it defers, the
      pipeline schedules one more commit, so a genuine keyboard reported by a
      single discrete event can never be stranded in the "armed" state.
      (INVARIANT 10 — the system always recovers.)                            */
const KB_OPEN_THRESH  = 12;
const KB_CLOSE_THRESH = 4;
const KB_STREAM_GAP   = 140; // ms between viewport events that still count as one stream
const KB_CLAMP_RATIO  = 0.9; // inset may never exceed 90% of the layout viewport
const KB_MIN_VISIBLE  = 120; // px of layout viewport that must stay usable
const ANIM_OPEN_MS    = 350;
const ANIM_CLOSE_MS   = 280;

/* ── READ helpers (read-only DOM / viewport access) ── */

function _layoutViewportHeight() {
  // The layout viewport (ICB) is the fixed reference a CSS bottom-anchored
  // chatbar is resolved against. documentElement.clientHeight tracks it
  // without the innerHeight quirks some mobile browsers show mid-animation.
  const de = document.documentElement;
  const h  = de ? de.clientHeight : 0;
  return (h > 0) ? h : window.innerHeight;
}

function _measureBarBox() {
  if (!chatbarWrap) return { height: 0, baseBottom: 0 };

  // offsetHeight = border-box height, which is exactly the footprint the
  // spacer must reserve. It already INCLUDES the CSS
  // `padding-bottom: calc(12px + env(safe-area-inset-bottom))`, so safe-area
  // is counted exactly once and JS must never add it again.
  const height = chatbarWrap.offsetHeight;

  // Where the bar's bottom edge actually sits in LAYOUT-viewport coordinates,
  // ignoring any transform we applied. offsetTop/offsetHeight are layout
  // values and are NOT affected by CSS transforms or by an in-flight
  // transition, so this stays correct while the bar is translated — which is
  // what makes the measurement non-self-referential (no feedback loop).
  //
  // This is measured rather than assumed because the correct keyboard inset
  // depends on whether CSS already moved the bar:
  //   • Android `interactive-widget=resizes-content` (set in index.html): the
  //     ICB shrinks, the body/flex column shrinks, the bar is already above
  //     the keyboard ⇒ baseBottom ≈ visual bottom ⇒ inset 0 ⇒ no JS
  //     compensation (compensating would be a double translation).
  //   • iOS Safari (ignores interactive-widget): the layout viewport does NOT
  //     shrink ⇒ baseBottom stays put while the visual bottom rises ⇒
  //     inset = keyboard height ⇒ JS compensates by exactly that.
  // Deriving it from the measured box answers that question empirically for
  // whatever anchoring model the stylesheet actually uses, instead of
  // assuming the bar is pinned to the ICB bottom.
  const body    = document.body;
  const bodyTop = body ? body.getBoundingClientRect().top : 0; // body is never transformed
  const baseBottom = bodyTop + chatbarWrap.offsetTop + height;

  return { height: Math.round(height), baseBottom: Math.round(baseBottom) };
}

function _readKeyboard(box) {
  const layoutH = _layoutViewportHeight();

  if (!vvp || !(vvp.height > 0)) {
    // No VisualViewport API (or not yet populated): keyboard compensation is
    // impossible, so resolve to the neutral state instead of guessing.
    _kbArmed = false;
    return { kbInset: 0, kbOpen: false, stream: false, deferred: false, layoutH };
  }

  // MEASURED displacement of the bar's real bottom edge below the visible
  // viewport's bottom edge. Lifting the bar by exactly this amount brings the
  // WHOLE bar (full border-box height, not just its top edge) back inside the
  // visible area, which is what makes a half-clipped pill impossible.
  const visualBottom = vvp.offsetTop + vvp.height;
  const raw          = Math.round(box.baseBottom - visualBottom);

  // Event cadence: a dense burst of VIEWPORT events means the browser is
  // animating the keyboard right now → follow it frame-by-frame and never add
  // a competing CSS transition. Measured between consecutive EVENTS (in
  // _onViewportEvent), not between an event and its commit frame — the latter
  // is always ≈ one frame and would make every event look like a stream.
  const stream = _viewportEventGap <= KB_STREAM_GAP;

  let kbOpen   = false;
  let deferred = false;

  if (_kbOpen) {
    // Already open: always track the measured value. Hysteresis only decides
    // when it has genuinely closed, so a theme change or a mid-animation frame
    // can never zero a valid inset (INVARIANT 8).
    kbOpen   = raw >= KB_CLOSE_THRESH;
    _kbArmed = false;
  } else if (raw >= KB_OPEN_THRESH) {
    if (_kbArmed) {
      kbOpen   = true;    // second agreeing frame → confirmed
      _kbArmed = false;
    } else {
      _kbArmed = true;    // first sighting → confirm on the next frame
      deferred = true;
    }
  } else {
    _kbArmed = false;     // below threshold → transient, disarm
  }

  let kbInset = kbOpen ? raw : 0;

  // Safety clamps — a runaway value must never push the bar off screen.
  const maxInset = Math.max(0, Math.min(layoutH * KB_CLAMP_RATIO, layoutH - KB_MIN_VISIBLE));
  if (kbInset > maxInset) {
    kbInset = Math.round(maxInset);
    if (kbInset < KB_CLOSE_THRESH) kbOpen = false;
  }
  if (kbInset < 0) kbInset = 0;

  return { kbInset, kbOpen, stream, deferred, layoutH };
}

/*
 * Transition cleanup.
 *
 * There is only ever ONE cleanup timer: every arm cancels the previous one and
 * every instant commit cancels it too. So a stale timer that could clear a
 * newer animation cannot exist — the invariant holds by construction, which is
 * strictly stronger than a token check.
 *
 * (An earlier revision guarded this with the geometry generation counter. That
 * was wrong: any spacer-only write bumps the generation, so the guard made the
 * timer bail out and left `transition` inline on .chatbar-wrap permanently.
 * That in turn made the "animation in flight" check stick true and silently
 * disabled the discrete-keyboard animation path for the rest of the session.)
 *
 * This timer only ever clears `transition`. It never touches transform, spacer
 * or keyboard state, so it cannot affect geometry correctness.
 */
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

function _armBarTransitionCleanup(ms) {
  _clearBarTransitionTimer();
  _cbTransitionTimer = setTimeout(() => {
    _cbTransitionTimer = null;
    if (chatbarWrap) chatbarWrap.style.transition = '';
  }, ms + 60);
}

/* ── Schedule a pipeline run (coalesced: N invalidations → 1 commit) ── */
function _scheduleVP(reason) {
  _vpReasonFlags |= (reason || 0);
  if (_vpPending) return;       // already queued — reasons accumulate
  _vpPending = true;
  _vpRafId   = _raf(_commitViewport);
}

/* ── THE ONLY FUNCTION that may commit chatbar geometry ── */
function _commitViewport(now) {
  /* rAF callbacks receive a timestamp; direct calls may not. */
  if (typeof now !== 'number') now = _now();

  _vpPending = false;
  _vpRafId   = null;

  const reasons = _vpReasonFlags;
  _vpReasonFlags = 0;

  if (!chatbarWrap) return;

  /* ══ READ PHASE (batched — every layout read happens here, before any
        write, so the frame performs at most one forced layout) ══ */

  // Always re-measure. The bar's box AND its base position can both change
  // for reasons no single observer reports: theme CSS, safe-area, orientation,
  // a tab swapping #chatArea/#pageContent, the layout viewport resizing under
  // `interactive-widget=resizes-content`, or the browser moving the bar on our
  // behalf. Measuring is three batched reads; guessing is a layout shift.
  // (Requirement: correctness beats micro-optimisation.)
  const box = _measureBarBox();
  _barHeight = box.height;

  const kb = _readKeyboard(box);

  // Self-healing confirmation: if the open decision was deferred to a second
  // frame, guarantee that frame happens even when the browser sends no further
  // viewport events (a single discrete keyboard jump). One extra rAF, bounded.
  if (kb.deferred) _scheduleVP(_VPReason.VIEWPORT);

  /* ══ CALCULATE PHASE (pure — no DOM access) ══ */

  // Always derived from a clean base state — never accumulated.
  // translateY only, NO translateZ/translate3d: chatbar.css deliberately omits
  // `will-change: transform` because a promoted compositor layer on
  // .chatbar-wrap clips #pill's :focus-within box-shadow at the layer paint
  // boundary on some mobile WebKit builds (a visibly "cut" pill edge).
  // Neutral state is the literal string 'none' so that at rest the element
  // has no transform, no layer and no containing-block side effects at all.
  const targetTransformStr = kb.kbInset > 0
    ? 'translateY(' + (-kb.kbInset) + 'px)'
    : 'none';

  const transformChanged = targetTransformStr !== _lastTransformStr;
  const kbEdge           = kb.kbOpen !== _kbOpen;

  // Spacer = actual current chatbar footprint + current keyboard inset.
  // A bar-height change always lands here, so no separate bar-diff is needed.
  const spacerH = _barHeight + kb.kbInset;
  const spacerChanged = spacerH !== _lastSpacerH;

  if (!transformChanged && !spacerChanged) {
    // Nothing to write (INVARIANT 7). Keep committed state coherent.
    _kbOpen      = kb.kbOpen;
    _lastKbInset = kb.kbInset;
    return;
  }

  /* ══ WRITE PHASE (batched — transform + spacer land in the SAME frame,
        so the wrapper, the pill and the content compensation can never
        disagree, not even for one frame) ══ */

  _geometryGeneration++;   // monotonic commit counter (diagnostics / telemetry)
  _vpCommitCount++;

  /* ── Keyboard just opened: anchor the conversation (scroll only) ── */
  if (kbEdge && kb.kbOpen) {
    _anchorChatOnKeyboardOpen(now);
  }

  if (spacerChanged && chatSpacer) {
    _lastSpacerH = spacerH;
    chatSpacer.style.height = spacerH + 'px';
  }

  if (transformChanged) {
    _lastTransformStr = targetTransformStr;

    /*
     * Motion policy. The browser's own keyboard animation is the source of
     * motion; JS only adds a transition when the browser reported a single
     * discrete jump and no native animation is in progress.
     *
     * Instant (frame-following) when:
     *  1. reduced-motion preference is active
     *  2. theme / init — geometry re-validation, not user-perceived motion
     *  3. the invalidation is not viewport-driven (orientation, visibility,
     *     tab switch, bar size) — nothing native to follow, so snap
     *  4. continuous viewport stream — the browser is animating the keyboard
     *     right now, so a CSS transition would only add lag
     *  5. a transition is already in flight — the real viewport wins and the
     *     stale transition is cancelled rather than fought
     */
    const geometryReset = (reasons & (_VPReason.THEME | _VPReason.INIT)) !== 0;
    const viewportEvent = (reasons & _VPReason.VIEWPORT) !== 0;
    const animInFlight  = chatbarWrap.style.transition !== '' &&
                          chatbarWrap.style.transition !== 'none';

    const discreteKeyboardJump = viewportEvent && !kb.stream && !geometryReset;

    const instant = _prefersReducedMotion || !discreteKeyboardJump || animInFlight;

    if (instant) {
      _clearBarTransitionTimer();
      if (chatbarWrap.style.transition !== 'none') chatbarWrap.style.transition = 'none';
      chatbarWrap.style.transform = targetTransformStr;
    } else {
      /*
       * Animated path — a genuinely discrete keyboard open/close (typical
       * Android: one resize jump, no stream). A transition can only change how
       * the bar TRAVELS to the correct place; the committed target is already
       * the exact final geometry, so no state can get stuck mid-animation.
       */
      const durMs = kb.kbOpen ? ANIM_OPEN_MS : ANIM_CLOSE_MS;
      const durS  = (durMs / 1000).toFixed(2);

      chatbarWrap.style.transition = 'transform ' + durS + 's ' + EASE.keyboardMove;
      chatbarWrap.style.transform  = targetTransformStr;
      _armBarTransitionCleanup(durMs);
    }
  }
  /*
   * Note: when only the spacer/bar box moved (transformChanged === false) we
   * deliberately touch nothing on the bar. Any transition still in flight is
   * already targeting THIS exact transform, so clearing it would snap an
   * otherwise smooth, already-correct animation. Its inline value is
   * reclaimed by the armed cleanup timer and by the theme / reduced-motion
   * handlers, so it can never be left behind permanently (and it can never
   * strand the geometry, because the committed target is already final).
   */

  _kbOpen      = kb.kbOpen;
  _lastKbInset = kb.kbInset;
}

/* ── Scroll anchoring when the keyboard first opens ──
   Scroll state only. It never touches chatbar geometry, and it yields to a
   programmatic scroll that is still settling so the two can't fight. */
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

  // Synchronous hand-back + short settle grace window: deterministic final
  // scroll state, no header flicker from the browser's own scroll settling,
  // and no rAF that could clear the flag before/after the wrong events.
  _programmaticScroll = false;
  _programmaticUntil  = now + 400;
}

/* ════════════════════════════════
   VISUALVIEWPORT WIRING
   Events only mark the pipeline dirty — they never read or write geometry.
════════════════════════════════ */

function _onViewportEvent() {
  const t = _now();
  // Interval since the PREVIOUS viewport event: a small gap means the browser
  // is mid-animation (stream); a large gap means an isolated discrete jump.
  _viewportEventGap    = _lastViewportEventTs ? (t - _lastViewportEventTs) : Infinity;
  _lastViewportEventTs = t;
  _scheduleVP(_VPReason.VIEWPORT);
}

if (vvp) {
  vvp.addEventListener('resize', _onViewportEvent, { passive: true });
  vvp.addEventListener('scroll', _onViewportEvent, { passive: true });
}
/*
 * No-VisualViewport fallback (very old browsers; every engine this app targets
 * — Android Chrome, iOS Safari, Chromium webviews — has had visualViewport for
 * years, so this path is effectively dormant).
 *
 * Deliberately does NOTHING beyond the window-resize invalidation below.
 * An earlier revision pinned `document.body.style.height = innerHeight` here.
 * That was wrong for this app: index.html's body is a flex column that owns the
 * chatbar's base position, so an inline px height overrides the stylesheet's
 * own height model and can break the layout in exactly the browsers it was
 * meant to help — while providing no benefit, because without visualViewport
 * there is no keyboard inset to measure and the neutral state IS the correct
 * state. CSS owns the base position; JS only compensates a measured inset.
 *
 * Re-measurement on resize is still covered by the WINDOW listener below, so
 * the bar height / spacer stay correct after an orientation or window change.
 */

/* Window-level / lifecycle invalidation.
   These cover cases the observers can miss (layout viewport change without a
   VisualViewport event, orientation change, keyboard dismissed while the tab
   was backgrounded). Each one is a pure invalidation: the commit dedupes, so
   a no-op frame costs nothing and cannot produce a visible jump. */
window.addEventListener('resize', () => _scheduleVP(_VPReason.WINDOW), { passive: true });

window.addEventListener('orientationchange', () => {
  _scheduleVP(_VPReason.WINDOW);
}, { passive: true });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Reset cadence so the first event after returning to the foreground is
    // never mistaken for part of an ongoing keyboard stream.
    _lastViewportEventTs = 0;
    _viewportEventGap    = Infinity;
    _scheduleVP(_VPReason.WINDOW);
  }
});

/* ════════════════════════════════
   RESIZE OBSERVER — bar height only
   Does NOT touch transforms, spacer or keyboard geometry.
   It only invalidates the unified pipeline.
════════════════════════════════ */

if (chatbarWrap && typeof ResizeObserver === 'function') {
  const _barRO = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;

    // Read the new height from the RO entry itself (no forced layout).
    const bs   = entry.borderBoxSize;
    const newH = bs
      ? (bs[0] ? bs[0].blockSize : bs.blockSize)
      : entry.contentRect.height;
    const rounded = Math.round(newH);

    // Loop safety (INVARIANT 13): this callback performs NO style writes at
    // all — it only compares and invalidates — so it cannot feed itself. The
    // commit it schedules writes only `transform` (which never changes a
    // border box) and the height of #chatSpacer, which lives inside
    // #scrollHost (a scroll container), so it cannot resize .chatbar-wrap.
    // Comparing against the last measured value absorbs sub-pixel noise.
    if (rounded === _barHeight) return;

    _scheduleVP(_VPReason.BAR_SIZE);
  });
  _barRO.observe(chatbarWrap);
}

/* NOTE — no global "ResizeObserver loop" error suppression here (deliberate).

   A previous revision swallowed that error on `window`. It is not needed and
   it was actively harmful:

   1. It cannot originate from this file. The observer callback above performs
      ZERO synchronous style writes — it only compares a number and schedules a
      rAF. The browser only reports a loop when an observer callback changes
      observed layout during delivery, which is structurally impossible here.
   2. The commit it schedules writes only `transform` (a transform never
      changes a border box, so it can never re-trigger this observer) and
      `#chatSpacer.style.height`. #chatSpacer lives inside #scrollHost — a
      scroll container and a *sibling* of .chatbar-wrap — so its content height
      cannot resize the observed element either.
   3. index.html loads lightweight-charts, KaTeX and highlight.js, and every
      lazily loaded module script may create its own observers. A global
      handler that calls stopImmediatePropagation()/preventDefault() on any
      "ResizeObserver loop" message would silently mask a genuine layout loop
      coming from those, hiding real bugs to keep the console quiet.

   The loop is prevented by architecture (observer reads → compares →
   invalidates; only _commitViewport writes), not by suppression. */

/* ════════════════════════════════
   THEME / PREFERENCE CHANGE
   System preference is the ONLY theme source — there is no manual toggle,
   no persisted theme and no theme class written from JS. CSS media queries
   own the visuals; JS only re-validates geometry after they re-apply.
════════════════════════════════ */

/*
 * A theme change can alter border width, radius, shadow, font rendering,
 * padding, CSS variables and safe-area interaction — so the measured bar
 * height and every cached geometry string are stale.
 *
 * It must NOT reset keyboard state: the current VisualViewport geometry is
 * re-read during the commit and the inset is recomputed from real values, so
 * a theme switch while the keyboard is open keeps the exact same inset.
 */
function _invalidateGeometryCache() {
  // Clearing the write-dedupe caches forces the next commit to re-validate
  // against freshly measured geometry. It rewrites the SAME derived values
  // (they are recomputed from live reads, never from the cache), so this
  // causes re-validation without any visible movement.
  _lastTransformStr = null;
  _lastSpacerH      = -1;
  _geometryGeneration++;   // record the invalidation (diagnostics)
}

if (window.matchMedia) {
  let themeMQ         = null;
  let reducedMotionMQ = null;
  try { themeMQ         = window.matchMedia('(prefers-color-scheme: dark)'); }        catch (_) {}
  try { reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)'); }   catch (_) {}

  const _onThemeChange = () => {
    /*
     * No direct style mutation here — only invalidation + ONE scheduled
     * commit. Frame 1 of the commit runs after the new theme's style recalc,
     * so the measurement is already correct; a second, cheap re-validation
     * frame catches late font/metric application. Both frames dedupe, so the
     * user sees exactly one stable geometry and never an intermediate state.
     * No timeouts are involved.
     */
    _endBarTransition();
    _invalidateGeometryCache();
    _scheduleVP(_VPReason.THEME);

    _raf(() => {
      _raf(() => _scheduleVP(_VPReason.THEME));
    });
  };

  const _onReducedMotionChange = (e) => {
    _prefersReducedMotion = !!(e && e.matches);

    // Recompute the animation policy immediately: no stale transition may
    // survive the preference flip, and no inline transition may be left
    // behind permanently.
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
   Deterministic: measure → read viewport → commit → visible.
   The chatbar is NEVER hidden while geometry is pending (opacity is not used
   to mask layout state), so no event sequence can leave it invisible.
════════════════════════════════ */

(function _init() {
  if (chatbarWrap) {
    /* Recovery, not a visual trick: if any inline style from an earlier
       build is still hiding or transitioning the bar, drop it so the first
       committed geometry is the first thing the user sees. */
    if (chatbarWrap.style.opacity === '0') chatbarWrap.style.opacity = '';
    chatbarWrap.style.transition = '';
    _clearBarTransitionTimer();
  }

  /*
   * Two rAF: the first lets stylesheets/fonts settle into the box model,
   * the second is the actual paint frame in which geometry is committed.
   * Both are pre-interaction, so no movement is ever visible.
   */
  _raf(() => {
    _raf(() => {
      _scheduleVP(_VPReason.INIT);
    });
  });

  /* Safety net: if rAF was throttled or stalled (background tab, aggressive
     power saving), the first user interaction forces one synchronous commit.
     This guarantees the bar can never be left in an uncommitted state. */
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

    /* Animation cleanup only — it settles scroll bookkeeping, never
       chatbar geometry, and is token-guarded against stale runs. */
    window.setTimeout(() => {
      if (requestToken !== _programmaticScrollToken) return;
      _endProgrammaticScroll();
    }, 450);
  });
}

window.scrollToMsg = scrollToMsg;

/* ════════════════════════════════
   HEADER / TAB SCROLL ANIMATION
   Lightweight: no layout reads beyond scrollTop, no geometry invalidation.
   Normal scrolling never triggers a chatbar commit.
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
    /* Textarea growth changes the bar height → ResizeObserver invalidates the
       pipeline. Nothing is written here: the pill/input handlers never own
       chatbar geometry. */
  });
}

/* ════════════════════════════════
   PLUS MENU
   Menu animation is fully independent from chatbar geometry. If opening the
   menu legitimately changes the bar's box, ResizeObserver reports the real
   size and the pipeline processes it — no size change is ever ignored.
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
   Purely decorative and fully independent from chatbar geometry: it only
   animates #pageContent opacity/transform, so it cannot move the bar,
   corrupt viewport state or feed the ResizeObserver. */
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
     * stylesheet and swapping content can all change the chatbar's box or the
     * document metrics. Invalidate once up front and once after the swap so
     * the committed geometry always reflects the tab that is now visible —
     * and returning to AI can never inherit the previous tab's compensation.
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

/* Read-only diagnostics (verification / QA; no geometry writes). */
window._atkynViewportDebug = () => ({
  barHeight      : _barHeight,
  kbInset        : _lastKbInset,
  kbOpen         : _kbOpen,
  transform      : _lastTransformStr,
  spacer         : _lastSpacerH,
  commits        : _vpCommitCount,
  pending        : _vpPending,
  reasons        : _vpReasonFlags,
  generation     : _geometryGeneration,
  eventGap       : _viewportEventGap,
  transition     : chatbarWrap ? chatbarWrap.style.transition : null,
  reducedMotion  : _prefersReducedMotion
});
