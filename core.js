/* ═══════════════════════════════════════════════════════════════════
   core.js — Atkyn shared UI logic [PRODUCTION — NATIVE LAYOUT ARCHITECTURE]
   scroll · header animation · native viewport · global theme · tab navigation
   ════════════════════════════════════════════════════════════════════

   ARCHITECTURE CHANGE SUMMARY
   ----------------------------
   Previous: VisualViewport → translateY(-kbInset) on chatbarWrap
   Current:  interactive-widget=resizes-content + position:sticky chatbar

   VisualViewport is now OBSERVATION ONLY (scroll anchor after keyboard opens).
   All keyboard layout is handled natively by the browser.
   Theme is a global controller with cross-tab sync. */

'use strict';

let _prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const EASE = {
  menuOpen    : 'cubic-bezier(0.32, 0.72, 0, 1)',
  menuClose   : 'cubic-bezier(0.4, 0, 1, 1)',
  contentSwap : 'cubic-bezier(0.16, 1, 0.3, 1)'
  // NOTE: keyboardMove removed — keyboard layout is now CSS/native, not JS-animated
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


/* ════════════════════════════════════════════════════════════════════
   GLOBAL THEME MANAGER
   ════════════════════════════════════════════════════════════════════

   Source of truth: localStorage('atkyn:theme') → 'system' | 'light' | 'dark'
   Effective theme: resolved against OS preference when mode === 'system'

   Applied to document.documentElement as:
     data-theme="light" | data-theme="dark"     (for [data-theme] CSS selectors)
     .dark / .light classes                     (for :root.dark / :root.light selectors)
     --atkyn-theme CSS variable                 (for component consumption)

   Events:
     'atkyn:themechange' CustomEvent on document — detail: { mode, effective }

   Cross-tab sync:
     BroadcastChannel 'atkyn-theme' (primary, when available)
     storage event on localStorage  (fallback, always active)

   OS preference:
     matchMedia('(prefers-color-scheme: dark)') is used ONLY when mode === 'system'.
     An explicit light/dark selection overrides OS preference permanently until changed.
   ════════════════════════════════════════════════════════════════════ */

const _THEME_KEY  = 'atkyn:theme';
const _THEME_CHAN  = 'atkyn-theme';
const _VALID_THEMES = new Set(['system', 'light', 'dark']);

const _osDarkMQ   = window.matchMedia('(prefers-color-scheme: dark)');
let _themeMode    = 'system';       // explicit user setting
let _themeSubscribers = [];         // subscribe() callbacks
let _bc           = null;           // BroadcastChannel (optional)
let _bcOwn        = false;          // suppress echo from our own BC post

/* ── Bootstrap: read persisted mode before first paint ── */
(function _themeBootstrap() {
  try {
    const stored = localStorage.getItem(_THEME_KEY);
    if (stored && _VALID_THEMES.has(stored)) _themeMode = stored;
  } catch (_) {}
})();

function _getEffectiveTheme() {
  if (_themeMode === 'dark')  return 'dark';
  if (_themeMode === 'light') return 'light';
  return _osDarkMQ.matches ? 'dark' : 'light';
}

function _applyTheme(fireEvent) {
  const effective = _getEffectiveTheme();
  const root      = document.documentElement;

  /* Apply to root — both attribute and classes for broad CSS compatibility */
  root.setAttribute('data-theme', effective);
  root.classList.toggle('dark',  effective === 'dark');
  root.classList.toggle('light', effective === 'light');
  root.style.setProperty('--atkyn-theme', effective);

  if (fireEvent !== false) {
    try {
      document.dispatchEvent(new CustomEvent('atkyn:themechange', {
        detail : { mode: _themeMode, effective },
        bubbles: false
      }));
    } catch (_) {}
  }

  /* Notify local subscribe() callbacks */
  const detail = { mode: _themeMode, effective };
  _themeSubscribers.forEach(fn => { try { fn(detail); } catch (_) {} });
}

function _setTheme(mode, fromRemote) {
  if (!_VALID_THEMES.has(mode)) return;
  _themeMode = mode;

  try { localStorage.setItem(_THEME_KEY, mode); } catch (_) {}

  /* Broadcast to other tabs (only when not already coming from remote) */
  if (!fromRemote && _bc) {
    _bcOwn = true;
    try { _bc.postMessage({ type: 'theme', mode }); } catch (_) {}
  }

  _applyTheme();
}

/* ── BroadcastChannel (optional enhancement) ── */
if (typeof BroadcastChannel !== 'undefined') {
  try {
    _bc = new BroadcastChannel(_THEME_CHAN);
    _bc.onmessage = (e) => {
      if (_bcOwn) { _bcOwn = false; return; }
      if (e.data && _VALID_THEMES.has(e.data.mode)) {
        _themeMode = e.data.mode;
        _applyTheme();
      }
    };
  } catch (_) { _bc = null; }
}

/* ── Cross-tab via storage event (always active, works when BC unavailable) ── */
window.addEventListener('storage', (e) => {
  if (e.key !== _THEME_KEY) return;
  const mode = e.newValue;
  if (mode && _VALID_THEMES.has(mode)) {
    _themeMode = mode;
    _applyTheme();
  }
}, { passive: true });

/* ── OS preference change — only relevant when mode === 'system' ── */
const _onOsThemeChange = () => { if (_themeMode === 'system') _applyTheme(); };
if (_osDarkMQ.addEventListener) _osDarkMQ.addEventListener('change', _onOsThemeChange);
else if (_osDarkMQ.addListener) _osDarkMQ.addListener(_onOsThemeChange);

/* ── Public API ── */
window._atkynTheme = {
  getTheme()          { return _themeMode; },
  getEffectiveTheme() { return _getEffectiveTheme(); },
  setTheme(mode)      { _setTheme(mode, false); },
  toggle() {
    /* Toggles between light and dark. If currently system, resolves and inverts. */
    _setTheme(_getEffectiveTheme() === 'dark' ? 'light' : 'dark', false);
  },
  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    _themeSubscribers.push(fn);
    return () => { _themeSubscribers = _themeSubscribers.filter(f => f !== fn); };
  }
};

/* ── Apply theme synchronously before first paint (no flash) ── */
_applyTheme(false);


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
   NATIVE LAYOUT / CHATBAR GEOMETRY PIPELINE

   With interactive-widget=resizes-content (set in HTML shell), the browser
   shrinks the layout viewport when the IME opens. A position:sticky chatbar
   at bottom:0 stays visible without any JavaScript transform.

   This pipeline's sole responsibilities:
   1. Measure chatbar height → publish as --atkyn-chatbar-height + chatSpacer
   2. Detect keyboard open for scroll anchor (VisualViewport observation only)

   REMOVED FROM THIS PIPELINE:
     ✗  chatbarWrap.style.transform  (was: translateY(-kbInset))
     ✗  Keyboard inset added to spacer height
     ✗  _lastKbInset / _lastTransformStr state
     ✗  Keyboard animation timers
     ✗  Theme-triggered transform resets
     ✗  Entrance opacity hide/show race
   ════════════════════════════════════════════════════════════════════ */

let _barHeight    = 0;     // measured .chatbar-wrap border-box height
let _vpPending    = false;
let _kbWasOpen    = false; // last known keyboard state (observation only)

const _VPReason = {
  BAR_SIZE  : 1 << 1,  // ResizeObserver fired — chatbar grew/shrank
  INIT      : 1 << 3,  // first-run initialisation
  KB_CHANGE : 1 << 4   // VisualViewport changed — keyboard open/close detection
};
let _vpReasonFlags = 0;

function _measureBar() {
  return chatbarWrap ? Math.round(chatbarWrap.offsetHeight) : 0;
}

function _readKbOpen() {
  if (!vvp) return false;
  const viewportBottom = vvp.offsetTop + vvp.height;
  const raw = Math.max(0, window.innerHeight - viewportBottom);
  return raw > 50; // 50px threshold filters out browser chrome micro-adjustments
}

function _scheduleVP(reason) {
  _vpReasonFlags |= reason;
  if (_vpPending) return;
  _vpPending = true;
  requestAnimationFrame(_commitLayout);
}

/*
 * _commitLayout — THE ONLY function that writes chatbar-related DOM state.
 *
 * DOES:
 *   - Measures chatbar height (when BAR_SIZE or INIT)
 *   - Writes --atkyn-chatbar-height CSS custom property
 *   - Writes chatSpacer height = chatbar height (no keyboard term)
 *   - Triggers scroll anchor when keyboard opens (KB_CHANGE)
 *
 * DOES NOT:
 *   - Write chatbarWrap.style.transform (CSS owns positioning)
 *   - Calculate keyboard inset for layout purposes
 *   - Animate chatbar position
 */
function _commitLayout() {
  _vpPending = false;
  const reasons = _vpReasonFlags;
  _vpReasonFlags = 0;

  if (!chatbarWrap) return;

  /* ── BATCH READ ── */
  if (reasons & (_VPReason.BAR_SIZE | _VPReason.INIT)) {
    _barHeight = _measureBar();
  }

  /* ── BATCH WRITE ── */

  /* Publish chatbar height as CSS variable (tabs/modules can consume this) */
  if (_barHeight > 0) {
    document.documentElement.style.setProperty('--atkyn-chatbar-height', _barHeight + 'px');
  }

  /*
   * Spacer height = chatbar height only.
   * With interactive-widget=resizes-content, the browser shrinks the layout
   * viewport to account for the keyboard. No extra keyboard term needed.
   * The spacer's only job is to prevent scroll content from hiding
   * underneath the sticky chatbar.
   */
  if (chatSpacer) {
    chatSpacer.style.height = _barHeight + 'px';
  }

  /* ── Scroll anchor: keyboard open detection (KB_CHANGE only) ── */
  if (reasons & _VPReason.KB_CHANGE) {
    const kbOpen = _readKbOpen();

    if (!_kbWasOpen && kbOpen && scrollHost) {
      const chatVisible = !chatArea || chatArea.style.display !== 'none';
      if (chatVisible) {
        /*
         * Wait one rAF: let the browser finish resizing the viewport first,
         * then scroll to anchor. Using getBoundingClientRect for accuracy —
         * offsetTop is unreliable when scroll containers are nested.
         */
        requestAnimationFrame(() => {
          if (!scrollHost) return;
          _programmaticScroll = true;
          const anchor = window._lastUserMsgEl;
          if (anchor) {
            const anchorRect = anchor.getBoundingClientRect();
            const hostRect   = scrollHost.getBoundingClientRect();
            const relTop     = anchorRect.top - hostRect.top + scrollHost.scrollTop;
            scrollHost.scrollTop = Math.max(0, relTop - 16);
          } else {
            scrollHost.scrollTop = scrollHost.scrollHeight;
          }
          requestAnimationFrame(() => {
            if (scrollHost) _lastScrollY = scrollHost.scrollTop;
            resetScrollAccum();
            _programmaticScroll = false;
          });
        });
      }
    }

    _kbWasOpen = kbOpen;
  }
}


/* ════════════════════════════════
   VISUALVIEWPORT — OBSERVATION ONLY
   Detects keyboard open/close transitions for scroll anchoring.
   Does NOT compute composer position. Does NOT own chatbarWrap geometry.
════════════════════════════════ */

if (vvp) {
  /*
   * VisualViewport fires continuously during keyboard animation.
   * We debounce with rAF: only the end-of-animation stable state matters
   * for scroll anchor. One rAF is enough because _scheduleVP is already
   * rAF-batched internally.
   */
  let _vvpRaf = null;
  const _onVVP = () => {
    if (_vvpRaf) return;
    _vvpRaf = requestAnimationFrame(() => {
      _vvpRaf = null;
      _scheduleVP(_VPReason.KB_CHANGE);
    });
  };
  vvp.addEventListener('resize', _onVVP, { passive: true });
  vvp.addEventListener('scroll', _onVVP, { passive: true });
} else {
  /* No VisualViewport API — fallback for very old browsers */
  window.addEventListener('resize', () => _scheduleVP(_VPReason.KB_CHANGE), { passive: true });
}


/* ════════════════════════════════
   RESIZE OBSERVER — chatbar height only
   Measures real content height of the composer.
   Does NOT compensate for keyboard (that's the browser's job now).
════════════════════════════════ */

if (chatbarWrap && typeof ResizeObserver === 'function') {
  const _barRO = new ResizeObserver((entries) => {
    /*
     * Skip during plus-menu animation: the menu can temporarily inflate
     * the chatbar layout while animating, producing a false measurement.
     * After the menu closes, the observer fires again with the real size.
     */
    if (_plusOpen) return;
    const entry = entries[entries.length - 1];
    if (!entry) return;

    const bs   = entry.borderBoxSize;
    const newH = bs
      ? (bs[0] ? bs[0].blockSize : bs.blockSize)
      : entry.contentRect.height;
    const rounded = Math.round(newH);
    if (rounded === _barHeight) return;
    _barHeight = rounded;

    _scheduleVP(_VPReason.BAR_SIZE);
  });
  _barRO.observe(chatbarWrap);
}


/* ════════════════════════════════
   REDUCED MOTION
════════════════════════════════ */

if (window.matchMedia) {
  const rMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const _onRM = (e) => {
    _prefersReducedMotion = e.matches;
    /* If reduced motion turns on while plus menu is animating, snap it */
    if (_prefersReducedMotion && _plusOpen && plusMenu) {
      if (_plusMenuTimer) clearTimeout(_plusMenuTimer);
      plusMenu.style.transition = 'none';
      plusMenu.style.transform  = '';
      plusMenu.style.opacity    = '';
    }
    /* No transform/geometry re-run needed — keyboard layout is CSS-native */
  };
  if (rMQ.addEventListener) rMQ.addEventListener('change', _onRM);
  else if (rMQ.addListener) rMQ.addListener(_onRM);
}


/* ════════════════════════════════
   INIT — first paint
   Publish initial layout metrics after CSS has settled.
════════════════════════════════ */

(function _init() {
  /*
   * CHANGED from previous implementation:
   *   Old: chatbarWrap.style.opacity = '0' → _commitViewport() made it '1'
   *   New: No JS opacity manipulation on init.
   *
   * Reason: With sticky CSS positioning, the chatbar is always in the correct
   * visual position from the first paint. There is no "pending geometry commit"
   * that could show a wrong position. The previous opacity:0 hide was guarding
   * against the chatbar appearing at the wrong translateY position before the
   * pipeline ran — that problem no longer exists.
   *
   * If a fade-in entrance is desired, use CSS @keyframes on the element
   * (e.g., animation: fadeIn 0.3s ease-out) — it cannot race with JS.
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

  const sy    = scrollHost.scrollTop;
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
    /*
     * CHANGED: was guarded by `_lastKbInset > 0` (old keyboard state).
     * Now uses VisualViewport observation state: _kbWasOpen.
     */
    if (document.activeElement === input || _kbWasOpen) return;

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

  void plusMenu.offsetWidth; // force layout before enabling transition

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
    /*
     * Re-measure chatbar now that the menu is gone.
     * Previously ResizeObserver would skip during _plusOpen.
     */
    _scheduleVP(_VPReason.BAR_SIZE);
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
    /* Re-measure after menu animation fully clears the layout */
    _scheduleVP(_VPReason.BAR_SIZE);
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
   ════════════════════════════════

   Theme ownership rule:
   - The SHELL owns the theme. _loadTab must never reset or re-establish it.
   - Lazy-loaded modules inherit the current root theme automatically because
     they read from document.documentElement (data-theme / .dark class).
   - Modules that need to react to theme changes should listen for:
       document.addEventListener('atkyn:themechange', callback)
   - window._atkynTheme is available before any module loads.
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
    /*
     * Module already loaded. Call its init. Theme is already applied to root —
     * no theme reset needed. The module reads document.documentElement.
     */
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

    /*
     * Theme: deliberately NOT reset or re-applied here.
     * The root already has the correct theme from the Theme Manager.
     * The newly loaded module will inherit it.
     */

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
        _lastScrollY        = scrollHost ? scrollHost.scrollTop : 0;
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
// window._atkynTheme is registered above in the Theme Manager section
