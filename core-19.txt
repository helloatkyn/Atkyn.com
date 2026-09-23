/* ═══════════════════════════════════════════════════════════════════
   core.js — Atkyn shared UI logic [PRODUCTION — UNIFIED VIEWPORT PIPELINE]
   scroll · header animation · unified viewport tracking · tab navigation
   ════════════════════════════════════════════════════════════════════ */

'use strict';

let _prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const EASE = {
  keyboardMove : 'cubic-bezier(0.32, 0.72, 0, 1)',
  menuOpen     : 'cubic-bezier(0.32, 0.72, 0, 1)',
  menuClose    : 'cubic-bezier(0.4, 0, 1, 1)',
  contentSwap  : 'cubic-bezier(0.16, 1, 0.3, 1)'
};

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
let _programmaticScrollToken = 0;
let _plusOpen              = false;
let _velocityEMA           = 0;
let _lastScrollTime        = 0;

const VELOCITY_ALPHA = 0.3;

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
   ════════════════════════════════════════════════════════════════════ */

/*
 * Measured state — set only by _measureBar() and _commitViewport().
 * Never assumed or hardcoded.
 */
let _barHeight    = 0;    // measured .chatbar-wrap border-box height
let _lastKbInset  = 0;    // last committed keyboard inset
let _lastSpacerH  = -1;   // last written spacer height (guards redundant DOM write)
let _lastTransformStr = null; // last written transform string

/* Pipeline gate — one RAF per batch of invalidations */
let _vpPending   = false;
let _vpRafId     = 0;   // id returned by rAF; lets us detect a stale pending

/* Entrance opacity flag — managed here, committed in _commitViewport */
let _entranceOpacity    = false;
let _cbTransitionTimer  = null;

/*
 * Theme geometry dirty flag.
 *
 * Theme changes can alter font metrics, computed padding, border-radius, and
 * other properties that affect chatbar height. The ResizeObserver fires
 * asynchronously — it may not have run yet when _commitViewport first executes
 * in the same RAF as the theme class change. We set this flag on theme change
 * and schedule a second "confirm" commit one RAF later to re-measure after the
 * browser has fully committed the new styles to layout.
 *
 * This is deterministic (no arbitrary timeout) and is the root-cause fix for:
 *   BUG B — pill partially clipped after theme switch + immediate Search tap.
 */
let _themeGeometryDirty = false;

/* Reason flags — tells _commitViewport what changed this frame */
const _VPReason = {
  VIEWPORT  : 1,  // VisualViewport resize/scroll
  BAR_SIZE  : 2,  // ResizeObserver — chatbar height changed
  THEME     : 4,  // theme or reduced-motion changed
  INIT      : 8   // first-run initialisation
};
let _vpReasonFlags = 0;

/* ── Measure chatbar height (read-only DOM access) ── */
function _measureBar() {
  if (!chatbarWrap) return 0;
  // borderBoxSize is the correct measurement; fall back to offsetHeight.
  return Math.round(chatbarWrap.offsetHeight);
}

/* ── Read VisualViewport geometry (read-only) ── */
function _readVVP() {
  if (!vvp) return { kbInset: 0, kbOpen: false };
  const viewportBottom = vvp.offsetTop + vvp.height;
  const raw = Math.max(0, window.innerHeight - viewportBottom);
  // Threshold: ignore sub-50px noise (browser chrome micro-adjustments)
  const kbInset = raw > 50 ? Math.round(raw) : 0;
  return { kbInset, kbOpen: kbInset > 0 };
}

/* ── Schedule a pipeline run ── */
function _scheduleVP(reason) {
  _vpReasonFlags |= reason;
  if (_vpPending) return;   // already queued — accumulate reasons
  _vpPending = true;
  _vpRafId   = requestAnimationFrame(_commitViewport);
}

/* ── THE ONLY FUNCTION that may commit chatbar geometry ── */
function _commitViewport() {
  _vpPending = false;
  const reasons = _vpReasonFlags;
  _vpReasonFlags = 0;

  if (!chatbarWrap) return;

  /* ── BATCH READ ── */
  // Always re-measure bar if size may have changed
  if (reasons & (_VPReason.BAR_SIZE | _VPReason.THEME | _VPReason.INIT)) {
    _barHeight = _measureBar();

    /*
     * If this commit was triggered by a theme change, the browser has just
     * applied the new CSS in this frame — but the ResizeObserver callback that
     * would update _barHeight for any dimension change has NOT fired yet (RO
     * fires asynchronously, after layout). Schedule one more commit next RAF to
     * pick up the post-theme layout. This is the deterministic fix for the race
     * between theme-CSS application and the first post-theme focus → keyboard
     * open sequence.
     */
    if (reasons & _VPReason.THEME) {
      _themeGeometryDirty = true;
      // Schedule the confirm commit — accumulate only BAR_SIZE so it re-measures
      // but does NOT flip any keyboard animation flags.
      _vpReasonFlags |= _VPReason.BAR_SIZE;
      if (!_vpPending) {
        _vpPending = true;
        _vpRafId   = requestAnimationFrame(_commitViewport);
      }
    }
  }

  // If we are in the confirm-commit frame triggered by a theme, clear the dirty flag.
  if (_themeGeometryDirty && !(reasons & _VPReason.THEME)) {
    _themeGeometryDirty = false;
  }

  const { kbInset, kbOpen } = _readVVP();
  const targetTransformStr  = kbInset > 0
    ? `translateY(-${kbInset}px)`   // no translateZ — see CSS note
    : 'none';

  /* ── Decide if we need to write anything ── */
  const barChanged       = (reasons & (_VPReason.BAR_SIZE | _VPReason.THEME | _VPReason.INIT)) !== 0;
  const transformChanged = targetTransformStr !== _lastTransformStr;

  if (!transformChanged && !barChanged) return;

  /* ── Spacer height (keeps scroll content clear of chatbar) ── */
  const spacerH = _barHeight + kbInset;
  if (chatSpacer && spacerH !== _lastSpacerH) {
    _lastSpacerH = spacerH;
    chatSpacer.style.height = spacerH + 'px';
  }

  /* ── Scroll anchor when keyboard first opens ── */
  const wasOpen = _lastKbInset > 0;
  if (!wasOpen && kbOpen && scrollHost) {
    const chatVisible = !chatArea || chatArea.style.display !== 'none';
    if (chatVisible) {
      _programmaticScroll = true;
      const anchor = window._lastUserMsgEl;
      scrollHost.scrollTop = anchor
        ? Math.max(0, anchor.offsetTop - 16)
        : scrollHost.scrollHeight;
      requestAnimationFrame(() => {
        if (scrollHost) _lastScrollY = scrollHost.scrollTop;
        resetScrollAccum();
        _programmaticScroll = false;
      });
    }
  }

  _lastKbInset = kbInset;

  /* ── Apply transform if it changed ── */
  if (transformChanged) {
    _lastTransformStr = targetTransformStr;

    // Cancel any in-flight transition timer
    if (_cbTransitionTimer) {
      clearTimeout(_cbTransitionTimer);
      _cbTransitionTimer = null;
    }

    /*
     * Instant snap conditions:
     * 1. Reduced motion preference
     * 2. Viewport stream (VisualViewport fires many times during keyboard animation) —
     *    always snap frame-by-frame; no transition lag
     * 3. Theme change — geometry reset, no animation
     * 4. Init
     */
    const isStream = (reasons & _VPReason.VIEWPORT) !== 0;
    const isTheme  = (reasons & (_VPReason.THEME | _VPReason.INIT)) !== 0;
    const instant  = _prefersReducedMotion || isStream || isTheme;

    /* ── BATCH WRITE ── */
    if (instant) {
      chatbarWrap.style.transition = 'none';
      chatbarWrap.style.transform  = targetTransformStr;
      if (_entranceOpacity) {
        _entranceOpacity = false;
        chatbarWrap.style.opacity = '';
      }
    } else {
      /*
       * Animated path: only for large discrete keyboard events on Android
       * (keyboard open/close reported as a single jump, not a stream).
       * iOS always reports as a stream, so it always takes the instant path.
       */
      const durMs = kbOpen ? 350 : 280;
      const durS  = (durMs / 1000).toFixed(2);
      let trans   = `transform ${durS}s ${EASE.keyboardMove}`;

      if (_entranceOpacity) {
        trans += ', opacity 0.35s ease-out';
        chatbarWrap.style.opacity = '1';
        _entranceOpacity = false;
      }

      chatbarWrap.style.transition = trans;
      chatbarWrap.style.transform  = targetTransformStr;

      _cbTransitionTimer = setTimeout(() => {
        if (chatbarWrap) chatbarWrap.style.transition = 'none';
        _cbTransitionTimer = null;
      }, durMs + 50);
    }
  }
}

/* ════════════════════════════════
   VISUALVIEWPORT WIRING
════════════════════════════════ */

if (vvp) {
  vvp.addEventListener('resize', () => _scheduleVP(_VPReason.VIEWPORT), { passive: true });
  vvp.addEventListener('scroll', () => _scheduleVP(_VPReason.VIEWPORT), { passive: true });
}

/*
 * BUG A FIX — Tab switch / page visibility.
 *
 * When the page is backgrounded, any pending RAF is paused. When the user
 * returns to the tab, _vpPending may still be true while the RAF callback
 * has never actually run — the pipeline is permanently stalled.
 *
 * On visibility restore we cancel the stale RAF (safe even if it already ran,
 * since cancelAnimationFrame is idempotent), reset _vpPending, and reschedule
 * a fresh commit that re-measures bar height and revalidates the full geometry.
 * We also re-apply _lastTransformStr = null so the transform is always
 * re-written unconditionally on the first post-return frame.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;

  // Cancel any stale RAF that was queued before backgrounding
  if (_vpPending && _vpRafId) {
    cancelAnimationFrame(_vpRafId);
    _vpRafId = 0;
  }
  // Reset gate so _scheduleVP will queue a new RAF
  _vpPending = false;

  // Force a full geometry revalidation: re-measure bar, re-read VVP, re-write transform
  _lastTransformStr = null;
  _scheduleVP(_VPReason.VIEWPORT | _VPReason.BAR_SIZE);
}, { passive: true });

if (!vvp) {
  /* Fallback for no VisualViewport API (rare old browsers) */
  const _legacyFix = () => {
    const h = window.innerHeight + 'px';
    if (document.body.style.height !== h) document.body.style.height = h;
    _scheduleVP(_VPReason.VIEWPORT);
  };
  window.addEventListener('resize', _legacyFix, { passive: true });
  _legacyFix();
}

/* ════════════════════════════════
   RESIZE OBSERVER — bar height only
   Does NOT touch transforms or keyboard geometry.
   Feeds into the unified pipeline.
════════════════════════════════ */

if (chatbarWrap && typeof ResizeObserver === 'function') {
  const _barRO = new ResizeObserver((entries) => {
    if (_plusOpen) return; // plus menu can inflate layout; skip
    const entry = entries[entries.length - 1];
    if (!entry) return;

    // Read new height from RO entry (avoids forced layout)
    const bs   = entry.borderBoxSize;
    const newH = bs
      ? (bs[0] ? bs[0].blockSize : bs.blockSize)
      : entry.contentRect.height;
    const rounded = Math.round(newH);
    if (rounded === _barHeight) return; // no real change
    _barHeight = rounded;

    // Feed only BAR_SIZE into pipeline — do not touch _lastKbInset
    _scheduleVP(_VPReason.BAR_SIZE);
  });
  _barRO.observe(chatbarWrap);
}

/* ════════════════════════════════
   THEME / PREFERENCE CHANGE
════════════════════════════════ */

if (window.matchMedia) {
  const themeMQ        = window.matchMedia('(prefers-color-scheme: dark)');
  const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  const _onThemeChange = () => {
    /*
     * Theme change can alter safe-area, font metrics, and computed styles.
     * Invalidate _lastTransformStr so _commitViewport always rewrites,
     * even if keyboard state hasn't changed.
     * Do NOT reset _lastKbInset — that would corrupt the active keyboard position.
     */
    _lastTransformStr = null;
    _scheduleVP(_VPReason.THEME);
  };

  const _onReducedMotionChange = (e) => {
    _prefersReducedMotion = e.matches;
    if (_prefersReducedMotion && _plusOpen && plusMenu) {
      if (_plusMenuTimer) clearTimeout(_plusMenuTimer);
      plusMenu.style.transition = 'none';
      plusMenu.style.transform  = '';
      plusMenu.style.opacity    = '';
    }
    _lastTransformStr = null;
    _scheduleVP(_VPReason.THEME);
  };

  if (themeMQ.addEventListener) themeMQ.addEventListener('change', _onThemeChange);
  else if (themeMQ.addListener) themeMQ.addListener(_onThemeChange);

  if (reducedMotionMQ.addEventListener) reducedMotionMQ.addEventListener('change', _onReducedMotionChange);
  else if (reducedMotionMQ.addListener) reducedMotionMQ.addListener(_onReducedMotionChange);
}

/* ════════════════════════════════
   INIT — first paint
   Measure and commit after first paint so layout is stable.
════════════════════════════════ */

(function _init() {
  /* Entrance: hide chatbar until first geometry commit */
  if (chatbarWrap && !_prefersReducedMotion) {
    _entranceOpacity = true;
    chatbarWrap.style.opacity = '0';
  }

  /*
   * Two rAF: first ensures CSS is applied and box is laid out,
   * second is the actual paint frame.
   */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      _scheduleVP(_VPReason.INIT);
    });
  });
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

  const sy = scrollHost.scrollTop;
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

const _scheduleHeaderUpdate = requestAnimationFrame;

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
    if (document.activeElement === input || _lastKbInset > 0) return;

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

  plusMenu.style.transition = `transform 0.3s ${EASE.menuOpen}, opacity 0.2s ease-out`;
  plusMenu.style.transform  = 'scale(1) translateY(0)';
  plusMenu.style.opacity    = '1';

  _plusMenuTimer = setTimeout(() => {
    if (!_plusOpen) return;
    plusMenu.style.transition = '';
    plusMenu.style.transform  = '';
    plusMenu.style.opacity    = '';
    _plusMenuTimer = null;
  }, 350);
}

function closePlusMenu() {
  if (!_plusOpen || !plusMenu || !plusBackdrop) return;

  _plusOpen = false;
  if (_plusMenuTimer) { clearTimeout(_plusMenuTimer); _plusMenuTimer = null; }

  plusBackdrop.classList.remove('open');

  if (_prefersReducedMotion) {
    plusMenu.classList.remove('open');
    return;
  }

  plusMenu.style.transition = `transform 0.22s ${EASE.menuClose}, opacity 0.18s ease-in`;
  plusMenu.style.transform  = 'scale(0.88) translateY(10px)';
  plusMenu.style.opacity    = '0';

  _plusMenuTimer = setTimeout(() => {
    if (_plusOpen) return;
    plusMenu.classList.remove('open');
    plusMenu.style.transition = '';
    plusMenu.style.transform  = '';
    plusMenu.style.opacity    = '';
    _plusMenuTimer = null;
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
      _moduleLoadPromises[key] = _loadScript(`modules/${key}/${key}.js`)
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
  const id = `_atkyn_css_${key}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id   = id;
  link.rel  = 'stylesheet';
  link.href = `modules/${key}/${key}.css`;
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

  pageContent.style.transition = `opacity 0.22s ease-out, transform 0.28s ${EASE.contentSwap}`;
  pageContent.style.opacity    = '1';
  pageContent.style.transform  = 'translateY(0)';

  _contentAnimTimer = setTimeout(() => {
    pageContent.style.transition = '';
    pageContent.style.opacity    = '';
    pageContent.style.transform  = '';
    _contentAnimTimer = null;
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
