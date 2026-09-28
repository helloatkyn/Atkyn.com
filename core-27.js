'use strict';

/* ── HELPERS & MOTION ────────────────────────────────────────────────────── */

let _prefersReducedMotion = !!(window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const EASE = {
  menuOpen    : 'cubic-bezier(0.32, 0.72, 0, 1)',
  menuClose   : 'cubic-bezier(0.4, 0, 1, 1)',
  contentSwap : 'cubic-bezier(0.16, 1, 0.3, 1)'
};

const _raf = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame.bind(window)
  : (cb) => setTimeout(cb, 16);

/* ── DOM ELEMENTS ────────────────────────────────────────────────────────── */

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

const SVG_SEND  = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="5 11 12 4 19 11"/></svg>';
const SVG_CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/* ── GEOMETRY PIPELINE ──────────────────────────────────────────────────── */

let _appliedInset    = 0;
let _appliedSpacerH  = -1;
let _barHeight       = -1;
let _kbOpen          = false;
let _vpPending       = false;
let _vpNeedsRecommit = false;

/*
 * Keyboard open/close hysteresis thresholds.
 * OPEN  when inset >= KB_OPEN_THRESH
 * CLOSE when inset <= KB_CLOSE_THRESH
 * Between the two thresholds, preserve current _kbOpen state.
 * This prevents theme-reflow jitter from bouncing the keyboard state.
 */
const KB_OPEN_THRESH  = 12;
const KB_CLOSE_THRESH = 4;

function _scheduleVP() {
  if (_vpPending) {
    _vpNeedsRecommit = true;
    return;
  }
  _vpPending = true;
  _raf(_runViewportCommit);
}

function _runViewportCommit() {
  _vpPending = false;
  _commitViewport();
  if (_vpNeedsRecommit) {
    _vpNeedsRecommit = false;
    _scheduleVP();
  }
}

/*
 * VisualViewport validation.
 *
 * During Android Chrome keyboard/theme/reflow transitions the VVP may briefly
 * report transitional values (height = 0, non-finite, etc.).  When that
 * happens we MUST NOT compute a bogus inset.  Instead we preserve the last
 * valid geometry and wait for the next valid measurement.
 *
 * Returns true when the geometry is usable, false when it should be ignored.
 */
function _isVVPValid(height, offsetTop, visualBottom) {
  if (!isFinite(height)      || height      <= 0) return false;
  if (!isFinite(offsetTop))                        return false;
  if (!isFinite(visualBottom) || visualBottom <= 0) return false;
  return true;
}

function _commitViewport() {
  if (!chatbarWrap) return;

  /* ── READ PHASE ─────────────────────────────────────────────────────── */

  const rect   = chatbarWrap.getBoundingClientRect();
  const height = Math.max(0, Math.round(rect.height || chatbarWrap.offsetHeight || 0));
  _barHeight   = height;

  /*
   * Recover untransformed bottom:
   *   rect.bottom reflects the VISUAL (post-transform) position.
   *   Adding _appliedInset gives back the untransformed bottom, because
   *   the element was shifted up by _appliedInset px via translateY(-_appliedInset).
   *   Invariant: _appliedInset always equals the magnitude of the last
   *   translateY we actually wrote, so no accumulation can occur.
   */
  const baseBottom = rect.bottom + _appliedInset;

  const layoutH = document.documentElement
    ? document.documentElement.clientHeight
    : (window.innerHeight || 0);

  /* ── VALIDATE VISUALVIEWPORT ─────────────────────────────────────────── */

  let visualBottom;
  if (vvp) {
    const vvpHeight    = vvp.height;
    const vvpOffsetTop = vvp.offsetTop;
    const candidate    = vvpOffsetTop + vvpHeight;

    if (!_isVVPValid(vvpHeight, vvpOffsetTop, candidate)) {
      /*
       * VisualViewport is in a transitional/invalid state.
       * Preserve the last-known valid transform/spacer entirely.
       * Do NOT touch _kbOpen, _appliedInset, or _appliedSpacerH.
       * The scheduler will re-run on the next VVP resize event.
       */
      return;
    }

    visualBottom = candidate;
  } else {
    visualBottom = layoutH;
  }

  /* ── CALCULATE PHASE ─────────────────────────────────────────────────── */

  const rawOverlap      = baseBottom - visualBottom;
  const targetInset     = Math.max(0, Math.min(rawOverlap, Math.max(0, baseBottom)));
  const targetTransform = targetInset > 0
    ? 'translateY(' + (-targetInset) + 'px)'
    : 'none';
  const targetSpacerH   = Math.max(0, height + targetInset);

  /*
   * Keyboard state with hysteresis.
   * Between KB_CLOSE_THRESH and KB_OPEN_THRESH we keep the previous state.
   * This prevents a noisy theme-reflow frame from bouncing _kbOpen.
   */
  const wasOpen = _kbOpen;
  if (targetInset >= KB_OPEN_THRESH) {
    _kbOpen = true;
  } else if (targetInset <= KB_CLOSE_THRESH) {
    _kbOpen = false;
  }
  /* else: preserve _kbOpen unchanged (hysteresis zone) */

  /* ── WRITE PHASE ─────────────────────────────────────────────────────── */

  if (targetInset !== _appliedInset) {
    /*
     * Always enforce transition:'none' before writing the keyboard-following
     * transform.  This guards against any CSS that might have re-introduced
     * a transition (e.g. theme stylesheet changes).
     */
    chatbarWrap.style.transition = 'none';
    chatbarWrap.style.transform  = targetTransform;
    _appliedInset = targetInset;
  }

  if (chatSpacer && targetSpacerH !== _appliedSpacerH) {
    chatSpacer.style.height = targetSpacerH + 'px';
    _appliedSpacerH = targetSpacerH;
  }

  /*
   * Fire the keyboard-open anchor ONLY on a genuine CLOSED → OPEN transition.
   * A theme change cannot trigger this because:
   *   (a) VVP invalid frames are bailed out above without touching _kbOpen.
   *   (b) Hysteresis prevents small inset noise from toggling _kbOpen.
   *   (c) wasOpen was already true if the keyboard was open before the theme
   *       change, so !wasOpen is false and the anchor never fires.
   */
  if (_kbOpen && !wasOpen) {
    _anchorChatOnKeyboardOpen();
  }
}

/* Theme-change invalidation.  Preserves _appliedInset (_kbOpen state kept).
   Only resets the cached spacer height so it will be recalculated from
   fresh geometry on the next valid VVP frame. */
function _onThemeChange() {
  _barHeight      = -1;
  _appliedSpacerH = -1;
  _scheduleVP();
}

/* ── LISTENERS & OBSERVERS ──────────────────────────────────────────────── */

if (window.matchMedia) {
  try {
    const tmq = window.matchMedia('(prefers-color-scheme: dark)');
    if (tmq.addEventListener) tmq.addEventListener('change', _onThemeChange);
    else if (tmq.addListener) tmq.addListener(_onThemeChange);
  } catch (_e) {}

  try {
    const rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onRM = (e) => {
      _prefersReducedMotion = !!(e && e.matches);
      _barHeight = -1;
      _scheduleVP();
    };
    if (rmq.addEventListener) rmq.addEventListener('change', onRM);
    else if (rmq.addListener) rmq.addListener(onRM);
  } catch (_e) {}
}

if (typeof MutationObserver === 'function' && document.documentElement) {
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' &&
          (m.attributeName === 'class' || m.attributeName === 'data-theme')) {
        _onThemeChange();
        break;
      }
    }
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme']
  });
}

if (vvp) {
  vvp.addEventListener('resize', _scheduleVP, { passive: true });
  vvp.addEventListener('scroll', _scheduleVP, { passive: true });
}

window.addEventListener('resize', () => {
  _barHeight = -1;
  _scheduleVP();
}, { passive: true });

window.addEventListener('orientationchange', () => {
  _barHeight = -1;
  _scheduleVP();
}, { passive: true });

function _restoreLifecycle() {
  _barHeight      = -1;
  _appliedSpacerH = -1;
  _scheduleVP();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _restoreLifecycle();
});
window.addEventListener('pageshow', _restoreLifecycle, { passive: true });

if (chatbarWrap && typeof ResizeObserver === 'function') {
  new ResizeObserver(() => {
    _barHeight = -1;
    _scheduleVP();
  }).observe(chatbarWrap);
}

(function _init() {
  if (chatbarWrap) {
    if (chatbarWrap.style.opacity === '0') chatbarWrap.style.opacity = '';
    chatbarWrap.style.transition = 'none';
  }
  _scheduleVP();
})();

/* ── HEADER / SCROLL BEHAVIOR ───────────────────────────────────────────── */

let _lastScrollY         = 0;
let _accumDown           = 0;
let _accumUp             = 0;
let _isLogoCollapsed     = false;
let _isTabHidden         = false;
let _isTabScrolled       = false;
let _rafPending          = false;
let _suppressHeaderUntil = 0;

const HIDE_ACCUM  = 40;
const SHOW_ACCUM  = 55;
const LOGO_THRESH = 10;

function _updateHeader() {
  _rafPending = false;
  if (!scrollHost || !logoHeader || !tabBar) return;

  const now = Date.now();
  if (now < _suppressHeaderUntil) {
    _lastScrollY = scrollHost.scrollTop;
    _accumDown   = 0;
    _accumUp     = 0;
    return;
  }

  const sy    = scrollHost.scrollTop;
  const delta = sy - _lastScrollY;
  _lastScrollY = sy;

  if (delta === 0) return;

  if (sy <= LOGO_THRESH) {
    _accumDown = 0;
    _accumUp   = 0;
    if (_isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
    if (_isTabHidden)     { tabBar.classList.remove('hide');          _isTabHidden     = false; }
    if (_isTabScrolled)   { tabBar.classList.remove('scrolled');      _isTabScrolled   = false; }
    return;
  }

  if (!_isLogoCollapsed) { logoHeader.classList.add('collapsed'); _isLogoCollapsed = true; }
  if (!_isTabScrolled)   { tabBar.classList.add('scrolled');      _isTabScrolled   = true; }

  if (delta > 0) {
    _accumDown += delta;
    _accumUp    = 0;
    if (!_isTabHidden && _accumDown >= HIDE_ACCUM) {
      tabBar.classList.add('hide');
      _isTabHidden = true;
      _accumDown   = 0;
    }
  } else {
    _accumUp   += -delta;
    _accumDown  = 0;
    if (_isTabHidden && _accumUp >= SHOW_ACCUM) {
      tabBar.classList.remove('hide');
      _isTabHidden = false;
      _accumUp     = 0;
    }
  }
}

if (scrollHost) {
  scrollHost.addEventListener('scroll', () => {
    if (!_rafPending) {
      _rafPending = true;
      _raf(_updateHeader);
    }
  }, { passive: true });
}

function _anchorChatOnKeyboardOpen() {
  if (!scrollHost || (chatArea && chatArea.style.display === 'none')) return;
  _suppressHeaderUntil = Date.now() + 400;
  const anchor = window._lastUserMsgEl;
  scrollHost.scrollTop = anchor
    ? Math.max(0, anchor.offsetTop - 16)
    : scrollHost.scrollHeight;
  _lastScrollY = scrollHost.scrollTop;
}

window._lastUserMsgEl = null;

function scrollToMsg(el) {
  if (!el || !scrollHost) return;
  _suppressHeaderUntil = Date.now() + 500;
  const tabBarH = tabBar ? tabBar.offsetHeight : 0;
  const target  = Math.max(0, el.offsetTop - tabBarH - 8);

  if (_prefersReducedMotion) {
    scrollHost.scrollTop = target;
  } else {
    scrollHost.scrollTo({ top: target, behavior: 'smooth' });
  }
  _lastScrollY = target;
}

window.scrollToMsg = scrollToMsg;

/* ── INPUT & PILL ───────────────────────────────────────────────────────── */

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

if (pill && input) {
  /*
   * pointerdown handler does NOT call preventDefault(), so passive:true is
   * correct here and causes no regression.  (Confirmed by source audit.)
   */
  pill.addEventListener('pointerdown', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (plusBtn && target && (target === plusBtn || plusBtn.contains(target))) return;
    if (target && target !== pill && target !== input &&
        !target.closest('button, .overlay-input-wrap')) return;
    if (document.activeElement === input || _kbOpen || _appliedInset > 0) return;

    _raf(() => {
      if (input && document.activeElement !== input) {
        input.focus({ preventScroll: true });
      }
    });
  }, { passive: true });

  input.addEventListener('focus', () => {
    _scheduleVP();
  });

  input.addEventListener('input', () => {
    const hasText = input.value.trim().length > 0;
    pill.classList.toggle('has-text', hasText);
    if (pill.classList.contains('non-ai-tab')) {
      _setSendMode(hasText ? 'cross' : 'send');
    }
  });
}

/* ── PLUS MENU ───────────────────────────────────────────────────────────── */

let _plusOpen      = false;
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
    if (plusMenu.contains(target) || plusBtn.contains(target)) return;
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

/* ── TAB & MODULE SYSTEM ────────────────────────────────────────────────── */

let _currentTabKey = (() => {
  if (!tabBar) return 'ai';
  const a = tabBar.querySelector('.tab.active');
  return a ? (a.getAttribute('data-tab') || 'ai') : 'ai';
})();

const _moduleCache        = {};
const _moduleLoadPromises = {};
const _scriptLoadPromises = {};
let   _tabLoadRequestId   = 0;

function _isCurrentTabRequest(key, requestId) {
  return requestId === _tabLoadRequestId && _currentTabKey === key;
}

async function _loadTab(key, requestId = null) {
  if (!pageContent) return;

  if (requestId === null) requestId = ++_tabLoadRequestId;

  const isActiveRequest = () =>
    requestId === _tabLoadRequestId && _currentTabKey === key;

  if (key === 'ai') {
    if (!isActiveRequest()) return;
    if (chatArea) chatArea.style.display = '';
    pageContent.style.display = 'none';
    return;
  }

  if (!isActiveRequest()) return;

  if (chatArea) chatArea.style.display = 'none';
  pageContent.style.display = '';

  /* Cached path — script already loaded */
  if (_moduleCache[key]) {
    const initFn = window['_atkynInit_' + key];
    if (typeof initFn === 'function' && isActiveRequest()) initFn();
    return;
  }

  /* First-load path — show skeleton while fetching */
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

    /*
     * FIX (BUG #11): Call the module initializer on first load, matching the
     * cached-path behaviour.  The guard ensures we never call a stale initFn
     * for a tab that is no longer active.
     */
    const initFn = window['_atkynInit_' + key];
    if (typeof initFn === 'function' && isActiveRequest()) initFn();

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
    const s       = document.createElement('script');
    s.src         = src;
    s.async       = true;
    const cleanup = () => { s.onload = null; s.onerror = null; };
    s.onload      = () => { cleanup(); resolve(); };
    s.onerror     = (err) => { cleanup(); delete _scriptLoadPromises[src]; reject(err); };
    document.head.appendChild(s);
  });
  return _scriptLoadPromises[src];
}

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

let _activeTabEl = tabBar ? tabBar.querySelector('.tab.active') : null;

if (tabBar) {
  tabBar.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const tab    = target ? target.closest('.tab') : null;
    if (!tab || tab.classList.contains('active')) return;

    const key = tab.getAttribute('data-tab');
    if (!key) return;

    const requestId = ++_tabLoadRequestId;

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
      _suppressHeaderUntil = Date.now() + 300;
      scrollHost.scrollTop = 0;
      _lastScrollY         = 0;
      _accumDown           = 0;
      _accumUp             = 0;
    }

    if (logoHeader && _isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
    if (tabBar && _isTabHidden)         { tabBar.classList.remove('hide');          _isTabHidden     = false; }
    if (tabBar && _isTabScrolled)       { tabBar.classList.remove('scrolled');      _isTabScrolled   = false; }

    _barHeight = -1;
    _scheduleVP();

    await _loadTab(key, requestId);

    _barHeight = -1;
    _scheduleVP();

    if (!_isCurrentTabRequest(key, requestId)) return;
    _animateContentIn();
  }, { passive: true });
}

/* ── PUBLIC CROSS-MODULE API ─────────────────────────────────────────────── */

window._atkynModuleCache = _moduleCache;
window._atkynPageContent = pageContent;
window._atkynAnimateIn   = _animateContentIn;
window._atkynLoadTab     = _loadTab;
