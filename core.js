/* ═══════════════════════════════════════════════════════════════════
   core.js — Atkyn shared UI logic [PRODUCTION HARDENED]
   scroll · header animation · smart viewport tracking · tab navigation
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

const vvp = window.visualViewport;

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

/* ════════════════════════════════
   KEYBOARD / VIEWPORT STATE
════════════════════════════════ */

let _keyboardOpen = false;
let _stableKbH    = 0;
let _barHeight    = chatbarWrap ? chatbarWrap.offsetHeight : 0;
let _lastSpacerH  = -1;
let _lastCbTransform = '';

/* Viewport rendering state */
let _vvpDirty = false;
let _vvpRafId = 0;
let _lastVvpTime = 0;
let _cbTransitionTimer = null;
let _entranceOpacity = false;

function _setSpacerHeight(h) {
  if (!chatSpacer || h === _lastSpacerH) return;
  _lastSpacerH = h;
  chatSpacer.style.height = h + 'px';
}

function _setWillChange(active) {
  if (!chatbarWrap) return;
  chatbarWrap.style.willChange = active ? 'transform' : '';
}

function getViewportState() {
  if (!vvp) return { keyboardInset: 0, keyboardOpen: false };
  const viewportBottom = vvp.offsetTop + vvp.height;
  const rawInset       = Math.max(0, window.innerHeight - viewportBottom);
  const keyboardInset  = rawInset > 50 ? Math.round(rawInset) : 0;
  return { keyboardInset, keyboardOpen: keyboardInset > 0 };
}

/* ─── HARDENED _applyViewport: Zero Clipping & iOS Lag Fix ─── */
function _applyViewport(opts) {
  if (!chatbarWrap) return;

  const { keyboardInset, keyboardOpen } = getViewportState();
  const targetTransform = keyboardInset > 0
    ? `translateY(-${keyboardInset}px) translateZ(0)`
    : 'translateZ(0)';

  const force = opts?.force ?? false;
  let instant = opts?.instant ?? _prefersReducedMotion;

  /* 
   * SMART TRACKING: iOS updates the visualViewport frame-by-frame during keyboard 
   * animation and page scrolling. Applying a CSS transition during these updates 
   * causes extreme lag/clipping. If the jump is small (< 150px), it's a stream, 
   * so we snap it instantly to match native speed perfectly.
   */
  const now = performance.now();
  const insetDelta = Math.abs(keyboardInset - _stableKbH);
  _lastVvpTime = now;

  if (!instant && insetDelta > 0 && insetDelta < 150) {
    instant = true;
  }

  const wasOpen = _keyboardOpen;
  _stableKbH    = keyboardInset;
  _keyboardOpen = keyboardOpen;
  
  _setSpacerHeight(_barHeight + keyboardInset);

  const transformChanged = targetTransform !== _lastCbTransform;

  if (!transformChanged && !force) {
    if (_entranceOpacity && keyboardInset === 0) _runEntranceAnimation();
    return;
  }

  _lastCbTransform = targetTransform;

  /* Scroll anchor when keyboard first opens */
  if (!wasOpen && keyboardOpen && scrollHost) {
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

  if (_cbTransitionTimer) {
    clearTimeout(_cbTransitionTimer);
    _cbTransitionTimer = null;
  }

  /* ── INSTANT SNAP (Stream, Theme Switch, Reduced Motion) ── */
  if (instant) {
    _entranceOpacity = false;
    _setWillChange(false);
    chatbarWrap.style.transition = '';
    chatbarWrap.style.opacity = '';
    chatbarWrap.style.transform = targetTransform;
    return;
  }

  /* ── ANIMATED PATH (Android snap-jump > 150px) ── */
  const durMs = keyboardInset > 0 ? 350 : 280;
  const durS = (durMs / 1000).toFixed(2);
  let trans = `transform ${durS}s ${EASE.keyboardMove}`;

  if (_entranceOpacity) {
    trans += `, opacity 0.35s ease-out`;
    chatbarWrap.style.opacity = '1';
    _entranceOpacity = false;
  }

  _setWillChange(true);
  chatbarWrap.style.transition = trans;
  chatbarWrap.style.transform = targetTransform;

  _cbTransitionTimer = setTimeout(() => {
    chatbarWrap.style.transition = '';
    chatbarWrap.style.opacity = '';
    _setWillChange(false);
    _cbTransitionTimer = null;
  }, durMs + 50);
}

function _runEntranceAnimation() {
  if (!chatbarWrap || !_entranceOpacity) return;
  _entranceOpacity = false;

  if (_cbTransitionTimer) clearTimeout(_cbTransitionTimer);

  chatbarWrap.style.transition = 'opacity 0.35s ease-out';
  chatbarWrap.style.opacity = '1';

  _cbTransitionTimer = setTimeout(() => {
    chatbarWrap.style.transition = '';
    chatbarWrap.style.opacity = '';
    _cbTransitionTimer = null;
  }, 400);
}

/* ─── fixViewport — single RAF gate ─── */
function fixViewport() {
  if (!vvp || _vvpDirty) return;
  _vvpDirty = true;
  _vvpRafId = requestAnimationFrame(() => {
    _vvpDirty = false;
    _vvpRafId = 0;
    _applyViewport();
  });
}

/* ─── VisualViewport wiring ─── */
if (vvp) {
  vvp.addEventListener('resize', fixViewport, { passive: true });
  vvp.addEventListener('scroll', fixViewport, { passive: true });
  _setSpacerHeight(_barHeight);
  _applyViewport({ force: true, instant: true });
} else {
  const _legacyFix = () => {
    const h = window.innerHeight + 'px';
    if (document.body.style.height !== h) document.body.style.height = h;
  };
  window.addEventListener('resize', _legacyFix, { passive: true });
  _legacyFix();
  _setSpacerHeight(_barHeight);
}

/* ─── ResizeObserver ─── */
if (chatbarWrap && typeof ResizeObserver === 'function') {
  new ResizeObserver((entries) => {
    if (_plusOpen) return;
    const entry = entries[entries.length - 1];
    if (!entry) return;
    const bs = entry.borderBoxSize;
    const barH = bs
      ? (bs[0] ? bs[0].blockSize : bs.blockSize)
      : entry.contentRect.height;
    _barHeight = Math.round(barH);
    _setSpacerHeight(_barHeight + _stableKbH);
  }).observe(chatbarWrap);
}

/* ════════════════════════════════
   CHATBAR ENTRANCE
════════════════════════════════ */
(function _chatbarEntrance() {
  if (!chatbarWrap || _prefersReducedMotion) return;
  _entranceOpacity = true;
  chatbarWrap.style.opacity = '0';
  requestAnimationFrame(() => {
    if (!chatbarWrap || !_entranceOpacity) return;
    _applyViewport({ force: true });
  });
})();

/* ════════════════════════════════
   THEME / PREFERENCE CHANGE
════════════════════════════════ */
if (window.matchMedia) {
  const themeMQ = window.matchMedia('(prefers-color-scheme: dark)');
  const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  const _onThemeChange = () => {
    if (_vvpDirty) {
      cancelAnimationFrame(_vvpRafId);
      _vvpRafId = 0;
      _vvpDirty = false;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (chatbarWrap) _barHeight = chatbarWrap.offsetHeight;
        _lastCbTransform = ''; 
        _applyViewport({ force: true, instant: true });
      });
    });
  };

  const _onReducedMotionChange = (e) => {
    _prefersReducedMotion = e.matches;
    if (_prefersReducedMotion && _plusOpen && plusMenu) {
      if (_plusMenuTimer) clearTimeout(_plusMenuTimer);
      plusMenu.style.transition = 'none';
      plusMenu.style.transform  = '';
      plusMenu.style.opacity    = '';
    }
    _applyViewport({ force: true, instant: true });
  };

  if (themeMQ.addEventListener) themeMQ.addEventListener('change', _onThemeChange);
  else if (themeMQ.addListener) themeMQ.addListener(_onThemeChange);

  if (reducedMotionMQ.addEventListener) reducedMotionMQ.addEventListener('change', _onReducedMotionChange);
  else if (reducedMotionMQ.addListener) reducedMotionMQ.addListener(_onReducedMotionChange);
}

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

  _lastScrollY = sy;
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

const _scheduleHeaderUpdate = window.requestPostAnimationFrame || requestAnimationFrame;

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
    if (document.activeElement === input || _keyboardOpen) return;

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
   PLUS MENU - Hardened 
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

  // Prep for transition
  plusMenu.style.transition = 'none';
  plusMenu.style.transform  = 'scale(0.88) translateY(10px)';
  plusMenu.style.opacity    = '0';

  // Force reflow immediately (fail-safe over RAF)
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

/* ── Content swap animation (Hardened) ── */
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

  void pageContent.offsetWidth; // Force Reflow

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
