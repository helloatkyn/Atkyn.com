/* ═══════════════════════════════════════════════════════════════════
   core-part2.js — ATKYN Core UI  [PRODUCTION]
   scroll · header animation · plus menu · send mode
   tab navigation · content swap · session state · preferences
   ═══════════════════════════════════════════════════════════════════
   RULE: This file must NEVER write chatbarWrap transform/bottom/top/
   position values. All chatbar geometry is owned by Part 1.
   ══════════════════════════════════════════════════════════════════ */

'use strict';

/* ────────────────────────────────────────────────────────────────────
   CONSTANTS
   ──────────────────────────────────────────────────────────────────── */

const EASE = {
  menuOpen    : 'cubic-bezier(0.32, 0.72, 0, 1)',
  menuClose   : 'cubic-bezier(0.4, 0, 1, 1)',
  contentSwap : 'cubic-bezier(0.16, 1, 0.3, 1)',
};

/* Header scroll thresholds (px of accumulated delta) */
const HIDE_ACCUM  = 40;
const SHOW_ACCUM  = 55;
const LOGO_THRESH = 10;

const VELOCITY_ALPHA = 0.3;

/* SVGs */
const SVG_SEND  = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="5 11 12 4 19 11"/></svg>';
const SVG_CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/* ────────────────────────────────────────────────────────────────────
   DOM REFERENCES
   ──────────────────────────────────────────────────────────────────── */

const scrollHost   = document.getElementById('scrollHost');
const logoHeader   = document.querySelector('.logo-header');
const tabBar       = document.getElementById('tabBar');
const plusBtn      = document.getElementById('plusBtn');
const plusMenu     = document.getElementById('plusMenu');
const plusBackdrop = document.getElementById('plusBackdrop');
const pill         = document.getElementById('pill');
const cbInput      = document.getElementById('cbInput');
const sendBtn      = document.getElementById('sendBtn');
const pageContent  = document.getElementById('pageContent');
const chatArea     = document.getElementById('chatArea');
const _msgWrap     = document.getElementById('msgWrap');

const _tabBarHeight = tabBar ? tabBar.offsetHeight : 0;

/* ────────────────────────────────────────────────────────────────────
   PREFERENCES  — Part 2 owns the listeners; Part 1 reads the flag
   ──────────────────────────────────────────────────────────────────── */

/*
 * Shared with Part 1 via window._atkynReducedMotion.
 * Part 1's _prefersReducedMotion() function reads this flag.
 */
window._atkynReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function _prefersReducedMotion() {
  return window._atkynReducedMotion;
}

/* ────────────────────────────────────────────────────────────────────
   SCROLL / HEADER STATE
   ──────────────────────────────────────────────────────────────────── */

let _rafPending           = false;
let _lastScrollY          = 0;
let _accumDown            = 0;
let _accumUp              = 0;
let _isLogoCollapsed      = false;
let _isTabHidden          = false;
let _isTabScrolled        = false;
let _scrollRafId          = null;
let _programmaticScroll   = false;
let _programmaticToken    = 0;
let _velocityEMA          = 0;
let _lastScrollTime       = 0;

function _resetScrollAccum() {
  _accumDown    = 0;
  _accumUp      = 0;
  _velocityEMA  = 0;
  _lastScrollTime = 0;
}

function _resetHeaderState() {
  if (_isLogoCollapsed && logoHeader) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
  if (_isTabHidden     && tabBar)     { tabBar.classList.remove('hide');          _isTabHidden     = false; }
  if (_isTabScrolled   && tabBar)     { tabBar.classList.remove('scrolled');      _isTabScrolled   = false; }
  _resetScrollAccum();
}

function _updateHeader(now) {
  _rafPending = false;
  if (!scrollHost || !logoHeader || !tabBar) return;

  if (_programmaticScroll) {
    _lastScrollY = scrollHost.scrollTop;
    _resetScrollAccum();
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

  /* At top: restore all defaults. */
  if (sy <= LOGO_THRESH) {
    _resetHeaderState();
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

const _scheduleHeader = window.requestPostAnimationFrame || requestAnimationFrame;

if (scrollHost) {
  scrollHost.addEventListener('scroll', (e) => {
    if (_programmaticScroll) {
      _lastScrollY = scrollHost.scrollTop;
      return;
    }
    if (!_rafPending) {
      _rafPending = true;
      _scheduleHeader(_updateHeader);
    }
  }, { passive: true });
}

/* ────────────────────────────────────────────────────────────────────
   SCROLL TO MESSAGE
   ──────────────────────────────────────────────────────────────────── */

function scrollToMsg(el) {
  if (!el || !scrollHost) return;

  /* Cancel any pending scroll animation. */
  if (_scrollRafId !== null) {
    cancelAnimationFrame(_scrollRafId);
    _scrollRafId = null;
  }

  const token = ++_programmaticToken;

  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId = null;
    if (token !== _programmaticToken) return;

    _programmaticScroll = true;
    const target = Math.max(0, el.offsetTop - _tabBarHeight - 8);

    if (_prefersReducedMotion()) {
      scrollHost.scrollTop = target;
      _lastScrollY = target;
      _resetScrollAccum();
      _programmaticScroll = false;
      return;
    }

    scrollHost.scrollTo({ top: target, behavior: 'smooth' });
    _lastScrollY = target;
    _resetScrollAccum();

    /*
     * Smooth scroll duration varies by browser; 450 ms is a safe upper
     * bound for the programmaticScroll flag lifetime.
     */
    window.setTimeout(() => {
      if (token !== _programmaticToken) return;
      _programmaticScroll = false;
      if (scrollHost) _lastScrollY = scrollHost.scrollTop;
      _resetScrollAccum();
    }, 450);
  });
}

window.scrollToMsg = scrollToMsg;

/* ────────────────────────────────────────────────────────────────────
   SEND BUTTON MODE
   ──────────────────────────────────────────────────────────────────── */

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
      if (cbInput) cbInput.value = '';
      pill.classList.remove('has-text');
      _setSendMode('send');
    }
  });
}

/* ────────────────────────────────────────────────────────────────────
   INPUT  — text input listener (pill state)
   ──────────────────────────────────────────────────────────────────── */

if (pill && cbInput) {
  cbInput.addEventListener('input', () => {
    const hasText = cbInput.value.trim().length > 0;
    pill.classList.toggle('has-text', hasText);
    if (pill.classList.contains('non-ai-tab')) {
      _setSendMode(hasText ? 'cross' : 'send');
    }
  });
}

/* ────────────────────────────────────────────────────────────────────
   PLUS MENU
   ──────────────────────────────────────────────────────────────────── */

let _plusOpen  = false;

/*
 * Animation token: incremented on every open/close call.
 * Stale transitionend callbacks are identified by capturing the token
 * at dispatch time and comparing at handler invocation.
 */
let _plusToken          = 0;
let _plusAnimFrame      = 0;
let _plusFallbackTimer  = 0;
let _plusTransEndHandler = null;

function _removePlusTransEnd() {
  if (!plusMenu || !_plusTransEndHandler) return;
  plusMenu.removeEventListener('transitionend', _plusTransEndHandler);
  _plusTransEndHandler = null;
}

function _cancelPlusAnimation() {
  _plusToken += 1;
  if (_plusAnimFrame)     { cancelAnimationFrame(_plusAnimFrame); _plusAnimFrame = 0; }
  if (_plusFallbackTimer) { clearTimeout(_plusFallbackTimer);    _plusFallbackTimer = 0; }
  _removePlusTransEnd();
}

function _finishPlusOpen(token) {
  if (!plusMenu || token !== _plusToken || !_plusOpen) return;
  _removePlusTransEnd();
  plusMenu.style.transition = '';
  plusMenu.style.transform  = '';
  plusMenu.style.opacity    = '';
}

function _finishPlusClose(token) {
  if (!plusMenu || token !== _plusToken || _plusOpen) return;
  _removePlusTransEnd();
  if (_plusFallbackTimer) { clearTimeout(_plusFallbackTimer); _plusFallbackTimer = 0; }
  plusMenu.classList.remove('open');
  plusMenu.style.transition = '';
  plusMenu.style.transform  = '';
  plusMenu.style.opacity    = '';
}

function openPlusMenu() {
  if (!plusBtn || !plusMenu || !plusBackdrop || _plusOpen) return;

  _cancelPlusAnimation();
  const token = _plusToken;

  _plusOpen = true;
  plusBackdrop.classList.add('open');
  plusMenu.classList.add('open');

  if (_prefersReducedMotion()) {
    plusMenu.style.transition = '';
    plusMenu.style.transform  = '';
    plusMenu.style.opacity    = '';
    return;
  }

  /* Set initial state synchronously. */
  plusMenu.style.transition = 'none';
  plusMenu.style.transform  = 'scale(0.88) translateY(10px)';
  plusMenu.style.opacity    = '0';

  _plusAnimFrame = requestAnimationFrame(() => {
    _plusAnimFrame = 0;
    if (token !== _plusToken || !_plusOpen) return;

    plusMenu.style.transition = `transform 0.3s ${EASE.menuOpen}, opacity 0.2s ease-out`;
    plusMenu.style.transform  = 'scale(1) translateY(0)';
    plusMenu.style.opacity    = '1';

    const onEnd = (e) => {
      if (e.target !== plusMenu || e.propertyName !== 'opacity') return;
      if (token !== _plusToken) return;
      _finishPlusOpen(token);
    };
    _plusTransEndHandler = onEnd;
    plusMenu.addEventListener('transitionend', onEnd);
  });
}

function closePlusMenu() {
  if (!_plusOpen || !plusMenu || !plusBackdrop) return;

  _cancelPlusAnimation();
  const token = _plusToken;

  _plusOpen = false;
  plusBackdrop.classList.remove('open');

  if (_prefersReducedMotion()) {
    _finishPlusClose(token);
    return;
  }

  plusMenu.style.transition = `transform 0.22s ${EASE.menuClose}, opacity 0.18s ease-in`;
  plusMenu.style.transform  = 'scale(0.88) translateY(10px)';
  plusMenu.style.opacity    = '0';

  const onEnd = (e) => {
    if (e.target !== plusMenu || e.propertyName !== 'opacity') return;
    if (token !== _plusToken || _plusOpen) return;
    _finishPlusClose(token);
  };
  _plusTransEndHandler = onEnd;
  plusMenu.addEventListener('transitionend', onEnd);

  /* Fallback in case transitionend never fires. */
  _plusFallbackTimer = window.setTimeout(() => {
    _plusFallbackTimer = 0;
    if (token !== _plusToken || _plusOpen) return;
    _finishPlusClose(token);
  }, 320);
}

/* Plus button */
if (plusBtn) {
  plusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _plusOpen ? closePlusMenu() : openPlusMenu();
  });
}

/* Backdrop */
if (plusBackdrop) {
  plusBackdrop.addEventListener('click', closePlusMenu);
}

/* Outside click */
if (plusMenu || plusBtn) {
  document.addEventListener('click', (e) => {
    if (!_plusOpen) return;
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (plusMenu?.contains(t) || plusBtn?.contains(t)) return;
    closePlusMenu();
  });
}

/* Escape */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _plusOpen) closePlusMenu();
});

/* Menu items */
['pmPhoto', 'pmCamera', 'pmFile', 'pmLocation'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', closePlusMenu);
});

/* ────────────────────────────────────────────────────────────────────
   TAB LOADING
   ──────────────────────────────────────────────────────────────────── */

const _moduleCache        = {};
const _moduleLoadPromises = {};
const _scriptLoadPromises = {};

let _tabLoadRequestId = 0;
let _currentTabKey    = (() => {
  if (!tabBar) return 'ai';
  const a = tabBar.querySelector('.tab.active');
  return a ? a.getAttribute('data-tab') : 'ai';
})();

function _nextRequestId() {
  return ++_tabLoadRequestId;
}

function _isCurrentRequest(key, id) {
  return id === _tabLoadRequestId && _currentTabKey === key;
}

async function _loadTab(key, requestId = null) {
  if (!pageContent) return;

  if (requestId === null) requestId = _nextRequestId();

  const isActive = () => requestId === _tabLoadRequestId && _currentTabKey === key;

  if (key === 'ai') {
    if (!isActive()) return;
    if (chatArea) chatArea.style.display = '';
    pageContent.style.display = 'none';
    return;
  }

  if (!isActive()) return;

  if (chatArea) chatArea.style.display = 'none';
  pageContent.style.display = '';

  /* Module already cached: just call init. */
  if (_moduleCache[key]) {
    const initFn = window['_atkynInit_' + key];
    if (typeof initFn === 'function' && isActive()) initFn();
    return;
  }

  /* Show skeleton while loading. */
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
    if (!_isCurrentRequest(key, requestId)) return;

    const initFn = window['_atkynInit_' + key];
    if (typeof initFn === 'function') initFn();
  } catch (_) {
    if (_isCurrentRequest(key, requestId)) {
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
    const s = document.createElement('script');
    s.src   = src;
    s.async = true;
    const cleanup = () => { s.onload = null; s.onerror = null; };
    s.onload  = () => { cleanup(); resolve(); };
    s.onerror = (err) => {
      cleanup();
      delete _scriptLoadPromises[src];
      reject(err);
    };
    document.head.appendChild(s);
  });

  return _scriptLoadPromises[src];
}

/* ────────────────────────────────────────────────────────────────────
   CONTENT SWAP ANIMATION  (pageContent only; never touches chatbar)
   ──────────────────────────────────────────────────────────────────── */

let _contentAnimRaf  = 0;
let _contentAnimEnd  = null;
let _contentAnimBase = null;

function _clearContentAnimation() {
  if (!pageContent) return;
  if (_contentAnimRaf) { cancelAnimationFrame(_contentAnimRaf); _contentAnimRaf = 0; }
  if (_contentAnimEnd) {
    pageContent.removeEventListener('transitionend', _contentAnimEnd);
    _contentAnimEnd = null;
  }
  if (_contentAnimBase) {
    pageContent.style.opacity    = _contentAnimBase.opacity;
    pageContent.style.transform  = _contentAnimBase.transform;
    pageContent.style.transition = _contentAnimBase.transition;
    _contentAnimBase = null;
  }
}

function _animateContentIn() {
  if (!pageContent) return;
  _clearContentAnimation();
  if (_prefersReducedMotion()) return;

  _contentAnimBase = {
    opacity:    pageContent.style.opacity,
    transform:  pageContent.style.transform,
    transition: pageContent.style.transition,
  };

  pageContent.style.opacity    = '0';
  pageContent.style.transform  = 'translateY(8px)';
  pageContent.style.transition = 'none';

  _contentAnimRaf = requestAnimationFrame(() => {
    _contentAnimRaf = 0;

    pageContent.style.transition = `opacity 0.22s ease-out, transform 0.28s ${EASE.contentSwap}`;
    pageContent.style.opacity    = '1';
    pageContent.style.transform  = 'translateY(0)';

    const onEnd = (e) => {
      if (e.target !== pageContent || e.propertyName !== 'opacity') return;
      if (_contentAnimEnd !== onEnd) return;
      pageContent.removeEventListener('transitionend', onEnd);
      _contentAnimEnd = null;
      if (_contentAnimBase) {
        pageContent.style.opacity    = _contentAnimBase.opacity;
        pageContent.style.transform  = _contentAnimBase.transform;
        pageContent.style.transition = _contentAnimBase.transition;
        _contentAnimBase = null;
      }
    };

    _contentAnimEnd = onEnd;
    pageContent.addEventListener('transitionend', onEnd);
  });
}

/* ────────────────────────────────────────────────────────────────────
   TAB BAR CLICK HANDLER
   ──────────────────────────────────────────────────────────────────── */

let _activeTabEl = tabBar ? tabBar.querySelector('.tab.active') : null;

if (tabBar) {
  tabBar.addEventListener('click', async (e) => {
    const t   = e.target instanceof Element ? e.target : null;
    const tab = t ? t.closest('.tab') : null;
    if (!tab || tab.classList.contains('active')) return;

    const key = tab.getAttribute('data-tab');
    if (!key) return;

    const requestId = _nextRequestId();

    /* Save chat state before leaving AI tab. */
    if (_currentTabKey === 'ai' && _msgWrap) {
      try {
        sessionStorage.setItem('atkyn_chat_html',   _msgWrap.innerHTML);
        sessionStorage.setItem('atkyn_chat_scroll', String(scrollHost ? scrollHost.scrollTop : 0));
      } catch (_) {}
    }

    /* Update active tab visually. */
    if (_activeTabEl) _activeTabEl.classList.remove('active');
    tab.classList.add('active');
    _activeTabEl   = tab;
    _currentTabKey = key;

    /* Restore last query for non-AI tabs. */
    let q = '';
    try { q = sessionStorage.getItem('atkyn_last_query') || ''; } catch (_) {}

    if (key === 'ai') {
      if (cbInput) cbInput.value = '';
      if (pill) { pill.classList.remove('has-text', 'non-ai-tab'); }
      _setSendMode('send');
    } else {
      if (pill) pill.classList.add('non-ai-tab');
      if (q && cbInput) {
        cbInput.value = q;
        if (pill) pill.classList.add('has-text');
        _setSendMode('cross');
      } else {
        if (pill) pill.classList.remove('has-text');
        _setSendMode('send');
      }
    }

    /* Scroll to top programmatically. */
    if (scrollHost) {
      const resetToken = ++_programmaticToken;
      _programmaticScroll  = true;
      scrollHost.scrollTop = 0;
      _lastScrollY         = 0;
      _resetScrollAccum();

      requestAnimationFrame(() => {
        if (requestId !== _tabLoadRequestId) return;
        _programmaticScroll = false;
        _lastScrollY        = scrollHost.scrollTop;
      });
    }

    /* Restore header to default state. */
    _resetHeaderState();

    await _loadTab(key, requestId);
    if (!_isCurrentRequest(key, requestId)) return;

    _animateContentIn();
  }, { passive: true });
}

/* ────────────────────────────────────────────────────────────────────
   PREFERENCES — THEME + REDUCED MOTION LISTENERS
   ──────────────────────────────────────────────────────────────────── */

if (window.matchMedia) {
  const themeMQ         = window.matchMedia('(prefers-color-scheme: dark)');
  const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  const _onThemeChange = () => {
    /*
     * Delegate geometry re-measurement to Part 1 via the shared hook.
     * Part 2 does not touch chatbarWrap here.
     */
    if (typeof window._atkynOnThemeChange === 'function') {
      window._atkynOnThemeChange();
    }
  };

  const _onReducedMotionChange = (e) => {
    window._atkynReducedMotion = e.matches;

    /* Settle plus menu if it's mid-animation. */
    if (e.matches && _plusOpen && plusMenu) {
      _cancelPlusAnimation();
      plusMenu.style.transition = '';
      plusMenu.style.transform  = '';
      plusMenu.style.opacity    = '';
      plusMenu.classList.add('open');
      plusBackdrop?.classList.add('open');
    }

    /*
     * Settle chatbar geometry via Part 1.
     * Part 2 never writes chatbar styles directly.
     */
    if (typeof window._atkynOnThemeChange === 'function') {
      window._atkynOnThemeChange();
    }
  };

  /* addEventListener with addListener fallback for older Safari. */
  const _listen = (mq, handler) => {
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener)  mq.addListener(handler);
  };

  _listen(themeMQ,         _onThemeChange);
  _listen(reducedMotionMQ, _onReducedMotionChange);
}

/* ────────────────────────────────────────────────────────────────────
   PUBLIC API
   ──────────────────────────────────────────────────────────────────── */

window._atkynModuleCache = _moduleCache;
window._atkynPageContent = pageContent;
window._atkynAnimateIn   = _animateContentIn;
window._atkynLoadTab     = _loadTab;
