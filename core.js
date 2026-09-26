'use strict';

/* PRIMITIVE HELPERS */
let _prefersReducedMotion = !!(window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const EASE = {
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

/* DOM */
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

// Static tab-bar height for message anchoring.
const _tabBarHeight = tabBar ? tabBar.offsetHeight : 0;

const SVG_SEND  = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="5 11 12 4 19 11"/></svg>';
const SVG_CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/* SCROLL / HEADER STATE */

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

/* VIEWPORT / CHATBAR GEOMETRY
 *
 * ARCHITECTURE:
 *   Browser layout (interactive-widget=resizes-content) establishes the
 *   chatbar's normal flow position.
 *
 *   JavaScript does NOT maintain a separate keyboard state machine and does
 *   NOT animate viewport geometry. On every scheduled frame we measure the
 *   CURRENT untransformed chatbar bottom and the CURRENT VisualViewport bottom.
 *   The only derived correction is their actual overlap.
 *
 *   CURRENT MEASURED VIEWPORT
 *          ↓
 *   ONE GEOMETRY CALCULATION
 *          ↓
 *   ONE RAF COMMIT
 *          ↓
 *   CURRENT CHATBAR TRANSFORM
 *
 *   No transition, timeout, hysteresis, armed state, or stale geometry cache
 *   participates in keyboard positioning.
 */

let _barHeight        = -1;
let _lastKbInset      = 0;
let _lastSpacerH      = -1;
let _lastTransformStr = null;
let _kbOpen           = false;

let _vpPending         = false;
let _vpRafId           = null;
let _vpReasonFlags     = 0;
let _vpCommitCount     = 0;
let _geometryGeneration = 0;

const _VPReason = {
  VIEWPORT : 1,
  BAR_SIZE : 2,
  THEME    : 4,
  WINDOW   : 8,
  INIT     : 16
};

/*
 * Return the chatbar's layout-position bottom edge WITHOUT including its
 * current transform. offsetTop/offsetParent describe layout geometry and are
 * therefore safe to use as the input to the transform calculation itself.
 */
function _measureBarBox() {
  if (!chatbarWrap) return { height: 0, baseBottom: 0 };

  const height = Math.round(chatbarWrap.offsetHeight);

  let el = chatbarWrap;
  let top = 0;

  while (el && el !== document.body && el !== document.documentElement) {
    top += el.offsetTop;
    el = el.offsetParent;
  }

  const scrollY = window.scrollY || window.pageYOffset || 0;
  const baseBottom = Math.round(top + height - scrollY);

  return { height, baseBottom };
}

/*
 * Measure ONLY the current physical overlap between the chatbar's normal
 * layout position and the visible viewport.
 *
 * With interactive-widget=resizes-content, normal layout already follows the
 * keyboard, so overlap is normally zero. If a browser/device exposes a
 * transient visual/layout difference, the correction is derived from that
 * actual difference rather than from a guessed keyboard height.
 */
function _measureViewportGeometry(box) {
  if (!vvp || !(vvp.height > 0)) {
    return { inset: 0, open: false };
  }

  const visualBottom = vvp.offsetTop + vvp.height;
  const rawOverlap = box.baseBottom - visualBottom;

  const inset = Math.max(0, Math.round(rawOverlap));

  return {
    inset,
    open: inset > 0
  };
}

function _setSpacerHeight(h) {
  const safe = Math.max(0, Math.round(h));
  if (!chatSpacer || safe === _lastSpacerH) return;

  _lastSpacerH = safe;
  chatSpacer.style.height = safe + 'px';
}

/*
 * Preserve the existing message anchoring behavior. This function changes
 * scroll position only; it never writes chatbar geometry.
 */
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
  _resetScrollAccum();

  _programmaticScroll = false;
  _programmaticUntil = now + 400;
}

/*
 * Single viewport scheduler.
 *
 * IMPORTANT:
 * The RAF callback never captures viewport measurements. It reads them only
 * when the RAF actually runs. Multiple events before that frame are coalesced
 * into the same commit, while an event arriving after the frame schedules the
 * next commit. Therefore an older measurement can never be written later.
 */
function _scheduleVP(reason) {
  _vpReasonFlags |= (reason | 0);

  if (_vpPending) return;

  _vpPending = true;
  _vpRafId = _raf(_commitViewport);
}

function _commitViewport(now) {
  if (typeof now !== 'number') now = _now();

  _vpPending = false;
  _vpRafId = null;

  /*
   * Snapshot reasons only for diagnostics/traceability. They never alter the
   * geometry formula. The formula always uses current measurements.
   */
  const reasons = _vpReasonFlags;
  _vpReasonFlags = 0;

  if (!chatbarWrap) return;

  /* READ — current frame only. */
  const box = _measureBarBox();
  const geometry = _measureViewportGeometry(box);

  const wasOpen = _kbOpen;

  _barHeight = box.height;
  _kbOpen = geometry.open;
  _lastKbInset = geometry.inset;
  _geometryGeneration++;

  window._atkynKeyboardOpen = _kbOpen;

  /*
   * Preserve the existing scroll anchoring semantics when a real positive
   * overlap is first observed.
   */
  if (!wasOpen && geometry.open) {
    _anchorChatOnKeyboardOpen(now);
  }

  /*
   * Spacer follows the same authoritative overlap measurement. With
   * resizes-content this is normally just the bar height; if the browser
   * leaves a real visual/layout overlap, only that measured overlap is added.
   */
  _setSpacerHeight(_barHeight + geometry.inset);

  /*
   * Single derived target:
   *   normal flow position + current measured overlap correction.
   *
   * No CSS transition is ever used for this continuously changing geometry.
   * Any transition left by an older runtime is explicitly cleared.
   */
  const targetTransformStr = geometry.inset > 0
    ? 'translateY(' + (-geometry.inset) + 'px)'
    : 'none';

  const transformChanged = targetTransformStr !== _lastTransformStr;

  if (transformChanged || (reasons & (_VPReason.THEME | _VPReason.WINDOW | _VPReason.INIT)) !== 0) {
    _lastTransformStr = targetTransformStr;

    chatbarWrap.style.transform = targetTransformStr;
    _vpCommitCount++;
  }
}

/* VISUAL VIEWPORT */

function _onViewportEvent() {
  _scheduleVP(_VPReason.VIEWPORT);
}

if (vvp) {
  vvp.addEventListener('resize', _onViewportEvent, { passive: true });
  vvp.addEventListener('scroll', _onViewportEvent, { passive: true });

  if (typeof vvp.addEventListener === 'function') {
    vvp.addEventListener('scrollend', _onViewportEvent, { passive: true });
  }
}

/* Window events cover layout/orientation changes outside VisualViewport. */
window.addEventListener('resize', () => _scheduleVP(_VPReason.WINDOW), { passive: true });
window.addEventListener('orientationchange', () => _scheduleVP(_VPReason.WINDOW), { passive: true });

/* Revalidate after app/background lifecycle transitions. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    _scheduleVP(_VPReason.WINDOW);
  }
});

window.addEventListener('pageshow', () => {
  _scheduleVP(_VPReason.WINDOW);
}, { passive: true });

/* RESIZE OBSERVER */

if (chatbarWrap && typeof ResizeObserver === 'function') {
  const _barRO = new ResizeObserver((entries) => {
    if (!entries.length) return;
    _scheduleVP(_VPReason.BAR_SIZE);
  });

  _barRO.observe(chatbarWrap);
}

/* THEME / PREFERENCES
 *
 * A system theme change is a geometry invalidation only.
 * We do NOT reset keyboard state, inset, event cadence, or position.
 * There is no double-rAF and no timeout. The next RAF reads the current
 * viewport/layout state; any later VisualViewport event schedules another
 * current-state commit.
 */

if (window.matchMedia) {
  let _themeMQ         = null;
  let _reducedMotionMQ = null;

  try { _themeMQ = window.matchMedia('(prefers-color-scheme: dark)'); } catch (_e) {}
  try { _reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch (_e) {}

  const _onThemeChange = () => {
    _scheduleVP(_VPReason.THEME);
  };

  const _onReducedMotionChange = (e) => {
    _prefersReducedMotion = !!(e && e.matches);
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

/* INIT */

(function _init() {
  if (chatbarWrap) {
    if (chatbarWrap.style.opacity === '0') chatbarWrap.style.opacity = '';
    chatbarWrap.style.transform = 'none';
  }

  /* First paint after styles are available. */
  _scheduleVP(_VPReason.INIT);

  /* Interaction fallback when rAF is throttled. */
  const _recoverOnce = () => {
    window.removeEventListener('pointerdown', _recoverOnce, true);
    window.removeEventListener('keydown',     _recoverOnce, true);

    if (_vpCommitCount > 0) return;

    if (_vpRafId !== null) {
      _caf(_vpRafId);
      _vpRafId = null;
    }

    _vpPending = false;
    _commitViewport(_now());
  };

  window.addEventListener('pointerdown', _recoverOnce, true);
  window.addEventListener('keydown', _recoverOnce, true);
})();

/* SEND BUTTON */

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

/* SCROLL TO MESSAGE */

window._lastUserMsgEl = null;

function scrollToMsg(el) {
  if (!el || !scrollHost) return;

// End previous programmatic scroll before starting a new request.
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

/* HEADER / TAB SCROLL */

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

/* INPUT / PILL */

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
    if (document.activeElement === input) return;

    e.preventDefault();
    _raf(() => {
      if (input && document.activeElement !== input) {
        input.focus({ preventScroll: true });
      }
    });
  }, { passive: false });

  input.addEventListener('focus', () => {
    _scheduleVP(_VPReason.VIEWPORT);
  });

  input.addEventListener('input', () => {
    const hasText = input.value.trim().length > 0;
    pill.classList.toggle('has-text', hasText);
    if (pill.classList.contains('non-ai-tab')) {
      _setSendMode(hasText ? 'cross' : 'send');
    }
// ResizeObserver handles bar-height changes.
  });
}

/* PLUS MENU */

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
// Flush styles before animating.

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

/* TAB BAR */

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

/* CONTENT SWAP */
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
// Flush styles before animating.

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

/* TAB CLICK */
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
// Clear programmatic-scroll state before the stale-request guard.
        _programmaticScroll = false;
        if (requestId !== _tabLoadRequestId || !scrollHost) return;
        _lastScrollY = scrollHost.scrollTop;
      });
    }

// Reset header state on tab switch.
    if (logoHeader && _isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
    if (tabBar && _isTabHidden)         { tabBar.classList.remove('hide');          _isTabHidden     = false; }
    if (tabBar && _isTabScrolled)       { tabBar.classList.remove('scrolled');      _isTabScrolled   = false; }

// Re-measure around display/content changes.
    _scheduleVP(_VPReason.WINDOW);

    await _loadTab(key, requestId);

    _scheduleVP(_VPReason.WINDOW);

    if (!_isCurrentTabRequest(key, requestId)) return;
    _animateContentIn();
  }, { passive: true });
}

/* PUBLIC API */
window._atkynModuleCache = _moduleCache;
window._atkynPageContent = pageContent;
window._atkynAnimateIn   = _animateContentIn;
window._atkynLoadTab     = _loadTab;

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
  transition    : chatbarWrap ? chatbarWrap.style.transition : null,
  reducedMotion : _prefersReducedMotion
});
