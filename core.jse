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
   rAF and _now() exist in every target browser, but resolving
   them unguarded at load time would make the WHOLE controller throw if any
   one of them is missing (old webviews, unusual embedders, tests). The
   pipeline is frame-driven by design, so these shims keep it deterministic
   instead of fatal. They never add delay to normal operation.            */
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

   Model (no double translation):
       BASE POSITION  = CSS (.chatbar-wrap is laid out by CSS, incl. any
                        env(safe-area-inset-bottom) — JS never duplicates it)
       + ONE KEYBOARD COMPENSATION = translate3d(0, -keyboardInset, 0)
       spacer         = measured chatbar border-box height + keyboardInset
                        (content-flow compensation only, never a second
                        visual translation of the bar)
   ════════════════════════════════════════════════════════════════════ */

/*
 * Measured / committed state — written ONLY by _measureBar(), _readKeyboard()
 * and _commitViewport(). Never assumed, never hardcoded.
 */
let _barHeight        = -1;   // measured .chatbar-wrap border-box height
let _barHeightStale   = true; // cached height may not reflect current CSS
let _lastKbInset      = 0;    // last committed keyboard inset
let _lastSpacerH      = -1;   // last written spacer height (write dedupe)
let _lastTransformStr = null; // last written transform string (write dedupe)
let _kbOpen           = false;// committed keyboard state (hysteresis memory)
let _lastLayoutH      = 0;    // last layout viewport height (chrome/rotation gate)
let _lastViewportEventTs = 0; // timestamp of previous viewport event
let _viewportEventGap    = Infinity; // interval between consecutive viewport events
let _vpCommitCount    = 0;    // has the pipeline ever committed? (recovery gate)
let _geometryGeneration = 0;  // invalidates stale transition cleanup timers

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
   VisualViewport changes for BOTH browser chrome (address bar) and the
   software keyboard, so the inset is measured RELATIVE TO THE LAYOUT
   VIEWPORT rather than against a cached or assumed height:

     raw = layoutViewportHeight - (vvp.offsetTop + vvp.height)

   Why this discriminates correctly on real devices:
     • Android `interactive-widget=resizes-content` — the keyboard shrinks
       the LAYOUT viewport, so CSS bottom-anchoring already moves the bar.
       layoutH and vvp.height fall together ⇒ raw ≈ 0 ⇒ no JS compensation
       (compensating here would be the "double translation" bug).
     • iOS Safari / Android `resizes-visual` — the layout viewport is fixed
       and only the visual viewport shrinks ⇒ raw = keyboard height ⇒ JS
       compensates by exactly that amount.
     • Address-bar collapse/expand — layoutH and vvp.height change together
       ⇒ raw ≈ 0 ⇒ never mistaken for a keyboard.

   On top of that, one-directional hysteresis absorbs rounding/chrome noise:
     closed → open : displacement must exceed KB_OPEN_THRESH
     open   → close: displacement must fall below KB_CLOSE_THRESH
   Once open, every intermediate value is tracked frame-exactly so the bar
   follows the native keyboard animation with no lag and no residual offset.

   Finally, the closed → open transition is gated on layout-viewport
   stability: a software keyboard never resizes the layout viewport, so if
   layoutH moved this frame the delta is untrusted and the decision is held
   for that one frame (rotation / chrome animation). This is frame-driven —
   no timers, no guessed delays — and it cannot strand the bar, because an
   already-open state always keeps tracking and self-corrects.            */
const KB_OPEN_THRESH  = 40;
const KB_CLOSE_THRESH = 20;
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

function _measureBar() {
  if (!chatbarWrap) return 0;
  // offsetHeight = border-box height, which is exactly the footprint the
  // spacer must reserve. Never hardcoded: text wrapping, textarea growth,
  // theme CSS, font rendering, accessibility text size and safe-area can all
  // change it at any time.
  return Math.round(chatbarWrap.offsetHeight);
}

function _readKeyboard() {
  const layoutH = _layoutViewportHeight();

  // Did the layout viewport itself move this frame? (rotation, address bar,
  // Android resizes-content keyboard). State only — no DOM write.
  const layoutShifted = _lastLayoutH > 0 && layoutH !== _lastLayoutH;
  _lastLayoutH = layoutH;

  if (!vvp || !(vvp.height > 0)) {
    // No VisualViewport API (or not yet populated): keyboard compensation is
    // impossible, so resolve to the neutral state instead of guessing.
    return { kbInset: 0, kbOpen: false, stream: false, layoutH };
  }

  // Displacement of the visual viewport's bottom edge from the layout
  // viewport's bottom edge — exactly how far a bottom-anchored element must
  // be lifted to stay fully visible. The FULL bar height stays above the
  // keyboard because the bar's own box is never part of this calculation;
  // it is simply translated as a whole.
  const visualBottom = vvp.offsetTop + vvp.height;
  const raw          = Math.round(layoutH - visualBottom);

  // Event cadence: a dense burst of VIEWPORT events means the browser is
  // animating the keyboard right now → follow it frame-by-frame and never add
  // a competing CSS transition. The interval is measured between consecutive
  // events (in _onViewportEvent), NOT between an event and its commit frame —
  // the latter is always ≈ one frame and would make every event look like a
  // stream, disabling the discrete-jump animation path entirely.
  const stream = _viewportEventGap <= KB_STREAM_GAP;

  let kbOpen;
  if (_kbOpen) {
    // Already open: always track the real value. Hysteresis only decides when
    // it has genuinely closed, so a theme change or a mid-animation frame can
    // never zero a valid inset (INVARIANT 4).
    kbOpen = raw >= KB_CLOSE_THRESH;
  } else if (raw >= KB_OPEN_THRESH) {
    // Closed → open. Require a stable layout viewport for this one decision.
    kbOpen = !layoutShifted;
  } else {
    kbOpen = false;
  }

  let kbInset = kbOpen ? raw : 0;

  // Safety clamps — a runaway value must never push the bar off screen.
  const maxInset = Math.max(0, Math.min(layoutH * KB_CLAMP_RATIO, layoutH - KB_MIN_VISIBLE));
  if (kbInset > maxInset) {
    kbInset = Math.round(maxInset);
    if (kbInset < KB_CLOSE_THRESH) kbOpen = false;
  }
  if (kbInset < 0) kbInset = 0;

  return { kbInset, kbOpen, stream, layoutH };
}

/* ── Transition hygiene (animation only — never geometry) ── */

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
    // Stale-callback protection: if geometry was re-committed since this
    // animation started, the newer commit owns the transition state.
    if (gen !== _geometryGeneration) return;
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

  /* ══ READ PHASE (batched — all layout reads happen here) ══ */

  // A theme change, first run, or any window-level resize can alter border,
  // padding, font metrics or safe-area contribution → the cached height is
  // not trustworthy, so re-measure the real border box.
  const sizeDirty =
    _barHeightStale ||
    (reasons & (_VPReason.BAR_SIZE | _VPReason.THEME | _VPReason.INIT | _VPReason.WINDOW)) !== 0;

  if (sizeDirty) {
    _barHeight      = _measureBar();
    _barHeightStale = false;
  }

  const kb = _readKeyboard();

  /* ══ CALCULATE PHASE (pure — no DOM access) ══ */

  // Always derived from the clean base state. No accumulation, ever:
  // inset 0 → 0px (neutral), inset N → -Npx (exactly the viewport displacement).
  const targetTransformStr = 'translate3d(0,' + (-kb.kbInset) + 'px,0)';

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

  const gen = ++_geometryGeneration;
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
      _armBarTransitionCleanup(gen, durMs);
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
} else {
  /* Fallback for no VisualViewport API (rare old browsers).
     Keep the layout viewport pinned to the visible height so CSS anchoring
     still resolves correctly, then let the pipeline re-validate geometry. */
  const _legacyFix = () => {
    const h = window.innerHeight + 'px';
    if (document.body && document.body.style.height !== h) {
      document.body.style.height = h;
    }
    _onViewportEvent(); // same cadence bookkeeping as the real VVP path
  };
  window.addEventListener('resize', _legacyFix, { passive: true });
  _legacyFix();
}

/* Window-level / lifecycle invalidation.
   These cover cases the observers can miss (layout viewport change without a
   VisualViewport event, orientation change, keyboard dismissed while the tab
   was backgrounded). Each one is a pure invalidation: the commit dedupes, so
   a no-op frame costs nothing and cannot produce a visible jump. */
window.addEventListener('resize', () => _scheduleVP(_VPReason.WINDOW), { passive: true });

window.addEventListener('orientationchange', () => {
  _barHeightStale = true;
  _scheduleVP(_VPReason.WINDOW);
}, { passive: true });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    _barHeightStale      = true;
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

    // Loop safety: compare against the cached value and only invalidate on a
    // real change. This observer never writes styles, so it cannot feed itself.
    if (rounded === _barHeight && !_barHeightStale) return;

    _scheduleVP(_VPReason.BAR_SIZE);
  });
  _barRO.observe(chatbarWrap);
}

/* Benign browser warning: a height write landing in the same frame as a
   resize observation is reported as a loop limit even when the values are
   deduped. It carries no error state, so it must not spam the console. */
window.addEventListener('error', (e) => {
  const msg = e && e.message ? String(e.message) : '';
  if (msg.indexOf('ResizeObserver loop') === 0) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

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
  _barHeightStale   = true;
  // Clearing the write-dedupe caches forces the next commit to re-validate
  // against freshly measured geometry. It rewrites the SAME derived values
  // (they are recomputed from live reads, never from the cache), so this
  // causes re-validation without any visible movement.
  _lastTransformStr = null;
  _lastSpacerH      = -1;
  _geometryGeneration++;   // orphan any in-flight transition cleanup timer
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
      _raf(() => {
        _barHeightStale = true;
        _scheduleVP(_VPReason.THEME);
      });
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
    _barHeightStale = true;
    _scheduleVP(_VPReason.WINDOW);

    await _loadTab(key, requestId);

    _barHeightStale = true;
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
