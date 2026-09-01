/* ═══════════════════════════════════════════════════════════════════
   core.js — Atkyn shared UI logic [PRODUCTION · STABLE v6]
   scroll · header · keyboard/viewport · theme stability
   chatbar · plus menu · tab navigation

   Goals:
   • zero layout-affecting animation during tab/mode switches
   • no style.cssText clobbering
   • coalesced viewport/scroll work
   • race-safe lazy tab loading
   • idempotent state changes
   • reduced-motion safe
════════════════════════════════════════════════════════════════════ */

/* ── Motion ─────────────────────────────────────────────────────── */
const _prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const EASE = {
  keyboard: 'cubic-bezier(0.32, 0.72, 0, 1)',
  headerHide: 'cubic-bezier(0.4, 0, 1, 1)',
  headerShow: 'cubic-bezier(0, 0, 0.2, 1)',
  chatbarEnter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  menuOpen: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  menuClose: 'cubic-bezier(0.4, 0, 1, 1)'
};

/* ── Stable DOM references ──────────────────────────────────────── */
const scrollHost = document.getElementById('scrollHost');
const logoHeader = document.querySelector('.logo-header');
const tabBar = document.getElementById('tabBar');
const chatbarWrap = document.querySelector('.chatbar-wrap');
const plusBtn = document.getElementById('plusBtn');
const plusMenu = document.getElementById('plusMenu');
const plusBackdrop = document.getElementById('plusBackdrop');
const pill = document.getElementById('pill');
const input = document.getElementById('cbInput');
const sendBtn = document.getElementById('sendBtn');
const pageContent = document.getElementById('pageContent');
const chatArea = document.getElementById('chatArea');
const msgWrap = document.getElementById('msgWrap');
const chatSpacer = document.getElementById('chatSpacer');
const visualViewport = window.visualViewport || null;

/* ── Constants ──────────────────────────────────────────────────── */
const SVG_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="5 11 12 4 19 11"/></svg>';
const SVG_CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

const HIDE_ACCUM = 40;
const SHOW_ACCUM = 55;
const LOGO_THRESH = 10;
const VELOCITY_ALPHA = 0.3;
const KEYBOARD_THRESHOLD = 50;
const THEME_FREEZE_MS = 350;

/* ── State ───────────────────────────────────────────────────────── */
let _rafPending = false;
let _lastScrollY = scrollHost ? scrollHost.scrollTop : 0;
let _accumDown = 0;
let _accumUp = 0;
let _velocityEMA = 0;
let _lastScrollTime = 0;
let _keyboardOpen = false;
let _stableKbH = 0;
let _barHeight = chatbarWrap ? Math.round(chatbarWrap.getBoundingClientRect().height) : 0;
let _lastSpacerH = -1;
let _lastChatbarTransform = '';
let _viewportRaf = 0;
let _cleanupRaf = 0;
let _scrollRafId = 0;
let _programmaticScroll = false;
let _isLogoCollapsed = false;
let _isTabHidden = false;
let _isTabScrolled = false;
let _plusOpen = false;
let _themeFreezeUntil = 0;
let _sendMode = 'send';
let _currentTabKey = tabBar?.querySelector('.tab.active')?.getAttribute('data-tab') || 'ai';
let _activeTabEl = tabBar?.querySelector('.tab.active') || null;
let _tabRequestId = 0;
let _menuAnimationId = 0;

const _moduleCache = Object.create(null);

/* ── Public state ───────────────────────────────────────────────── */
window._lastUserMsgEl = null;
window._atkynModuleCache = _moduleCache;
window._atkynPageContent = pageContent;

/* ── Small helpers ──────────────────────────────────────────────── */
function resetScrollAccum() {
  _accumDown = 0;
  _accumUp = 0;
  _velocityEMA = 0;
  _lastScrollTime = 0;
}

function _setInlineStyle(el, property, value) {
  if (el) el.style[property] = value;
}

function _clearInlineStyles(el, properties) {
  if (!el) return;
  for (const property of properties) el.style[property] = '';
}

function _cancelRaf(id) {
  if (id) cancelAnimationFrame(id);
  return 0;
}

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

/* ── Send button ────────────────────────────────────────────────── */
if (sendBtn) {
  sendBtn.addEventListener('click', () => {
    if (!pill?.classList.contains('non-ai-tab')) return;
    if (input) input.value = '';
    pill.classList.remove('has-text');
    _setSendMode('send');
  });
}

/* ── Scroll to message ─────────────────────────────────────────── */
function scrollToMsg(el) {
  if (!el || !scrollHost) return;

  _scrollRafId = _cancelRaf(_scrollRafId);
  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId = 0;
    const tabHeight = tabBar ? tabBar.getBoundingClientRect().height : 0;
    const target = Math.max(0, el.offsetTop - tabHeight - 8);

    _programmaticScroll = true;
    if (_prefersReducedMotion) {
      scrollHost.scrollTop = target;
      _programmaticScroll = false;
      _lastScrollY = target;
      resetScrollAccum();
      return;
    }

    scrollHost.scrollTo({ top: target, behavior: 'smooth' });
    _lastScrollY = target;
    resetScrollAccum();

    _cleanupRaf = _cancelRaf(_cleanupRaf);
    _cleanupRaf = requestAnimationFrame(() => {
      _cleanupRaf = 0;
      _programmaticScroll = false;
    });
  });
}
window.scrollToMsg = scrollToMsg;

/* ── Spacer / chatbar sizing ───────────────────────────────────── */
function _setSpacerHeight(height) {
  if (!chatSpacer) return;
  const h = Math.max(0, Math.round(height));
  if (h === _lastSpacerH) return;
  _lastSpacerH = h;
  chatSpacer.style.height = `${h}px`;
}

if (chatbarWrap && 'ResizeObserver' in window) {
  const barResizeObserver = new ResizeObserver(entries => {
    if (performance.now() < _themeFreezeUntil) return;
    const entry = entries[entries.length - 1];
    const box = entry?.borderBoxSize;
    const height = box
      ? (Array.isArray(box) ? box[0]?.blockSize : box.blockSize)
      : entry?.contentRect?.height;
    if (!Number.isFinite(height)) return;

    _barHeight = Math.round(height);
    _setSpacerHeight(_barHeight + _stableKbH);
  });
  barResizeObserver.observe(chatbarWrap);
}

/* ── Chatbar entrance: compositor-only, never clobber inline state ── */
(function initChatbarEntrance() {
  if (!chatbarWrap || _prefersReducedMotion) return;

  _setInlineStyle(chatbarWrap, 'willChange', 'transform, opacity');
  _setInlineStyle(chatbarWrap, 'transition', 'none');
  _setInlineStyle(chatbarWrap, 'transform', 'translate3d(0,24px,0)');
  _setInlineStyle(chatbarWrap, 'opacity', '0');
  chatbarWrap.getBoundingClientRect();

  requestAnimationFrame(() => {
    if (!chatbarWrap.isConnected) return;
    _setInlineStyle(chatbarWrap, 'transition', `transform 0.45s ${EASE.chatbarEnter}, opacity 0.35s ease-out`);
    _setInlineStyle(chatbarWrap, 'transform', 'translate3d(0,0,0)');
    _setInlineStyle(chatbarWrap, 'opacity', '1');
  });

  const onEntryEnd = event => {
    if (event.target !== chatbarWrap || event.propertyName !== 'transform') return;
    chatbarWrap.removeEventListener('transitionend', onEntryEnd);
    _clearInlineStyles(chatbarWrap, ['willChange']);
    /* Keyboard positioning owns transform once the keyboard is visible. */
    if (_keyboardOpen) {
      _setInlineStyle(chatbarWrap, 'transition', 'none');
      _setInlineStyle(chatbarWrap, 'transform', _lastChatbarTransform || 'translate3d(0,0,0)');
      _setInlineStyle(chatbarWrap, 'opacity', '');
      requestAnimationFrame(() => _clearInlineStyles(chatbarWrap, ['transition']));
    } else {
      _clearInlineStyles(chatbarWrap, ['transition', 'transform', 'opacity']);
    }
  };
  chatbarWrap.addEventListener('transitionend', onEntryEnd);
})();

/* ── Keyboard / VisualViewport ─────────────────────────────────── */
function _applyViewport(force = false) {
  if (!visualViewport || !chatbarWrap) return;
  if (!force && performance.now() < _themeFreezeUntil) return;

  const rawKeyboardHeight = Math.max(
    0,
    window.innerHeight - visualViewport.height - visualViewport.offsetTop
  );
  const keyboardHeight = rawKeyboardHeight > KEYBOARD_THRESHOLD
    ? Math.round(rawKeyboardHeight)
    : 0;

  if (!force && keyboardHeight === _stableKbH) return;

  const wasOpen = _keyboardOpen;
  _stableKbH = keyboardHeight;
  _keyboardOpen = keyboardHeight > 0;

  const transform = keyboardHeight
    ? `translate3d(0,-${keyboardHeight}px,0)`
    : 'translate3d(0,0,0)';

  if (force || transform !== _lastChatbarTransform) {
    if (force || _prefersReducedMotion) {
      _setInlineStyle(chatbarWrap, 'transition', 'none');
      _setInlineStyle(chatbarWrap, 'transform', transform);
    } else {
      const duration = keyboardHeight ? '0.35s' : '0.28s';
      _setInlineStyle(chatbarWrap, 'transition', `transform ${duration} ${EASE.keyboard}`);
      _setInlineStyle(chatbarWrap, 'transform', transform);
    }
    _lastChatbarTransform = transform;
  }

  _setSpacerHeight(_barHeight + keyboardHeight);

  if (!wasOpen && keyboardHeight > 0 && scrollHost && chatArea?.style.display !== 'none') {
    _programmaticScroll = true;
    const anchor = window._lastUserMsgEl;
    scrollHost.scrollTop = anchor
      ? Math.max(0, anchor.offsetTop - 16)
      : scrollHost.scrollHeight;
  }

  _cleanupRaf = _cancelRaf(_cleanupRaf);
  _cleanupRaf = requestAnimationFrame(() => {
    _cleanupRaf = 0;
    if (scrollHost) _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
    _programmaticScroll = false;

    if (force || _prefersReducedMotion) {
      _clearInlineStyles(chatbarWrap, ['transition']);
    }
  });
}

function fixViewport() {
  if (!visualViewport || _viewportRaf || performance.now() < _themeFreezeUntil) return;
  _viewportRaf = requestAnimationFrame(() => {
    _viewportRaf = 0;
    _applyViewport(false);
  });
}

if (visualViewport) {
  visualViewport.addEventListener('resize', fixViewport, { passive: true });
  visualViewport.addEventListener('scroll', fixViewport, { passive: true });
  _setSpacerHeight(_barHeight);
  _applyViewport(true);
} else {
  const legacyFix = () => {
    const height = `${window.innerHeight}px`;
    if (document.body.style.height !== height) document.body.style.height = height;
  };
  window.addEventListener('resize', legacyFix, { passive: true });
  legacyFix();
  _setSpacerHeight(_barHeight);
}

if (chatbarWrap) {
  chatbarWrap.addEventListener('transitionend', event => {
    if (event.target !== chatbarWrap || event.propertyName !== 'transform') return;
    if (!_keyboardOpen || _prefersReducedMotion) {
      _clearInlineStyles(chatbarWrap, ['transition']);
    }
  });
}

/* ── Theme changes ──────────────────────────────────────────────── */
if (window.matchMedia) {
  const themeMQ = window.matchMedia('(prefers-color-scheme: dark)');
  const onThemeChange = () => {
    _themeFreezeUntil = performance.now() + THEME_FREEZE_MS;
    _viewportRaf = _cancelRaf(_viewportRaf);
    _cleanupRaf = _cancelRaf(_cleanupRaf);

    /* Freeze transform animation while the browser swaps theme styles. */
    if (chatbarWrap) _setInlineStyle(chatbarWrap, 'transition', 'none');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!chatbarWrap) return;
        _barHeight = Math.round(chatbarWrap.getBoundingClientRect().height);
        _setSpacerHeight(_barHeight + _stableKbH);
        _applyViewport(true);
      });
    });
  };

  if (themeMQ.addEventListener) themeMQ.addEventListener('change', onThemeChange);
  else if (themeMQ.addListener) themeMQ.addListener(onThemeChange);
}

/* ── Header / tab scroll state ─────────────────────────────────── */
function updateHeader(now = performance.now()) {
  _rafPending = false;
  if (!scrollHost || !logoHeader || !tabBar) return;

  if (_programmaticScroll) {
    _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
    return;
  }

  const scrollY = scrollHost.scrollTop;
  const delta = scrollY - _lastScrollY;
  if (delta === 0) return;

  const dt = Math.max(1, now - _lastScrollTime);
  const velocity = delta / dt;
  _velocityEMA = _velocityEMA === 0
    ? velocity
    : _velocityEMA * (1 - VELOCITY_ALPHA) + velocity * VELOCITY_ALPHA;

  _lastScrollY = scrollY;
  _lastScrollTime = now;

  if (scrollY <= LOGO_THRESH) {
    resetScrollAccum();
    if (_isLogoCollapsed) {
      logoHeader.classList.remove('collapsed');
      _isLogoCollapsed = false;
    }
    if (_isTabHidden) {
      tabBar.classList.remove('hide');
      _isTabHidden = false;
    }
    if (_isTabScrolled) {
      tabBar.classList.remove('scrolled');
      _isTabScrolled = false;
    }
    return;
  }

  if (!_isLogoCollapsed) {
    logoHeader.classList.add('collapsed');
    _isLogoCollapsed = true;
  }
  if (!_isTabScrolled) {
    tabBar.classList.add('scrolled');
    _isTabScrolled = true;
  }

  if (_velocityEMA > 0.05) {
    _accumDown += delta;
    _accumUp = 0;
    if (!_isTabHidden && _accumDown >= HIDE_ACCUM) {
      tabBar.classList.add('hide');
      _isTabHidden = true;
      _accumDown = 0;
    }
  } else if (_velocityEMA < -0.05) {
    _accumUp += -delta;
    _accumDown = 0;
    if (_isTabHidden && _accumUp >= SHOW_ACCUM) {
      tabBar.classList.remove('hide');
      _isTabHidden = false;
      _accumUp = 0;
    }
  }
}

if (scrollHost) {
  scrollHost.addEventListener('scroll', () => {
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(updateHeader);
  }, { passive: true });
}

/* ── Input / pill ───────────────────────────────────────────────── */
if (pill && input) {
  pill.addEventListener('pointerdown', event => {
    const target = event.target;
    if (
      target !== pill &&
      target !== input &&
      !target.closest('button, .overlay-input-wrap')
    ) return;

    if (document.activeElement === input || _keyboardOpen) return;
    event.preventDefault();
    requestAnimationFrame(() => input.focus());
  }, { passive: false });

  input.addEventListener('input', () => {
    const hasText = input.value.trim().length > 0;
    pill.classList.toggle('has-text', hasText);
    if (pill.classList.contains('non-ai-tab')) {
      _setSendMode(hasText ? 'cross' : 'send');
    }
  });
}

/* ── Plus menu ──────────────────────────────────────────────────── */
function _finishMenuAnimation() {
  _menuAnimationId = _cancelRaf(_menuAnimationId);
  _clearInlineStyles(plusMenu, ['bottom', 'transition', 'transform', 'opacity']);
}

function openPlusMenu() {
  if (!plusBtn || !plusMenu || !plusBackdrop || _plusOpen) return;
  _plusOpen = true;
  _finishMenuAnimation();

  const rect = plusBtn.getBoundingClientRect();
  const viewHeight = visualViewport?.height || window.innerHeight;
  const bottom = `${viewHeight - rect.top + 8}px`;
  _setInlineStyle(plusMenu, 'bottom', bottom);
  plusBackdrop.classList.add('open');
  plusMenu.classList.add('open');

  if (_prefersReducedMotion) return;

  _setInlineStyle(plusMenu, 'transition', 'none');
  _setInlineStyle(plusMenu, 'transform', 'scale(0.88) translateY(10px)');
  _setInlineStyle(plusMenu, 'opacity', '0');
  plusMenu.getBoundingClientRect();

  _menuAnimationId = requestAnimationFrame(() => {
    _menuAnimationId = 0;
    if (!_plusOpen) return;
    _setInlineStyle(plusMenu, 'transition', `transform 0.3s ${EASE.menuOpen}, opacity 0.2s ease-out`);
    _setInlineStyle(plusMenu, 'transform', 'scale(1) translateY(0)');
    _setInlineStyle(plusMenu, 'opacity', '1');
  });
}

function closePlusMenu() {
  if (!_plusOpen || !plusMenu || !plusBackdrop) return;
  _plusOpen = false;
  _menuAnimationId = _cancelRaf(_menuAnimationId);
  plusBackdrop.classList.remove('open');

  if (_prefersReducedMotion) {
    plusMenu.classList.remove('open');
    _finishMenuAnimation();
    return;
  }

  _setInlineStyle(plusMenu, 'transition', `transform 0.22s ${EASE.menuClose}, opacity 0.18s ease-in`);
  _setInlineStyle(plusMenu, 'transform', 'scale(0.88) translateY(10px)');
  _setInlineStyle(plusMenu, 'opacity', '0');

  const onClose = event => {
    if (event.target !== plusMenu || event.propertyName !== 'opacity') return;
    plusMenu.removeEventListener('transitionend', onClose);
    plusMenu.classList.remove('open');
    _finishMenuAnimation();
  };
  plusMenu.addEventListener('transitionend', onClose);
}

if (plusBtn) {
  plusBtn.addEventListener('click', event => {
    event.stopPropagation();
    _plusOpen ? closePlusMenu() : openPlusMenu();
  });
}
if (plusBackdrop) plusBackdrop.addEventListener('click', closePlusMenu);

['pmPhoto', 'pmCamera', 'pmFile', 'pmLocation'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', closePlusMenu);
});

/* ── Lazy tab loading ──────────────────────────────────────────── */
function _loadModuleCSS(key) {
  const id = `_atkyn_css_${key}`;
  if (document.getElementById(id)) return;

  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `modules/${key}/${key}.css`;
  document.head.appendChild(link);
}

const _scriptPromises = Object.create(null);
function _loadScript(src) {
  if (_scriptPromises[src]) return _scriptPromises[src];

  _scriptPromises[src] = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      delete _scriptPromises[src];
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(script);
  });

  return _scriptPromises[src];
}

async function _loadTab(key) {
  if (!pageContent) return;

  if (key === 'ai') {
    if (chatArea) chatArea.style.display = '';
    pageContent.style.display = 'none';
    return;
  }

  if (chatArea) chatArea.style.display = 'none';
  pageContent.style.display = '';

  if (_moduleCache[key]) {
    window['_atkynInit_' + key]?.();
    return;
  }

  pageContent.innerHTML = '<div class="tab-skeleton"><div class="sk-line"></div><div class="sk-line sk-short"></div><div class="sk-line"></div></div>';

  try {
    _loadModuleCSS(key);
    await _loadScript(`modules/${key}/${key}.js`);
    _moduleCache[key] = true;
    if (_currentTabKey === key) window['_atkynInit_' + key]?.();
  } catch (_) {
    if (_currentTabKey === key) {
      pageContent.innerHTML = '<div class="tab-empty"><p>Coming soon</p></div>';
    }
  }
}

/* ── Tab content appearance: opacity only; never moves layout ───── */
function _animateContentIn() {
  if (!pageContent || _prefersReducedMotion) return;
  _setInlineStyle(pageContent, 'transition', 'none');
  _setInlineStyle(pageContent, 'opacity', '0');

  requestAnimationFrame(() => {
    if (!pageContent.isConnected) return;
    _setInlineStyle(pageContent, 'transition', 'opacity 0.18s ease-out');
    _setInlineStyle(pageContent, 'opacity', '1');
  });
}
window._atkynAnimateIn = _animateContentIn;
window._atkynLoadTab = _loadTab;

/* ── Tab navigation ────────────────────────────────────────────── */
if (tabBar) {
  tabBar.addEventListener('click', async event => {
    const tab = event.target.closest('.tab');
    if (!tab || !tabBar.contains(tab) || tab.classList.contains('active')) return;

    const key = tab.getAttribute('data-tab');
    if (!key || key === _currentTabKey) return;

    if (_currentTabKey === 'ai' && msgWrap) {
      try {
        sessionStorage.setItem('atkyn_chat_html', msgWrap.innerHTML);
        sessionStorage.setItem('atkyn_chat_scroll', String(scrollHost?.scrollTop || 0));
      } catch (_) {}
    }

    if (_activeTabEl) _activeTabEl.classList.remove('active');
    tab.classList.add('active');
    _activeTabEl = tab;
    _currentTabKey = key;
    const requestId = ++_tabRequestId;

    let query = '';
    try { query = sessionStorage.getItem('atkyn_last_query') || ''; } catch (_) {}

    if (key === 'ai') {
      if (input) input.value = '';
      pill?.classList.remove('has-text', 'non-ai-tab');
      _setSendMode('send');
    } else {
      pill?.classList.add('non-ai-tab');
      if (query && input) {
        input.value = query;
        pill?.classList.add('has-text');
        _setSendMode('cross');
      } else {
        _setSendMode('send');
      }
    }

    /* Mode switches are state changes, not navigation. Never smooth-scroll here. */
    if (scrollHost) {
      scrollHost.scrollTop = 0;
      _lastScrollY = 0;
      resetScrollAccum();
    }

    if (logoHeader && _isLogoCollapsed) {
      logoHeader.classList.remove('collapsed');
      _isLogoCollapsed = false;
    }
    if (_isTabHidden) {
      tabBar.classList.remove('hide');
      _isTabHidden = false;
    }
    if (_isTabScrolled) {
      tabBar.classList.remove('scrolled');
      _isTabScrolled = false;
    }

    await _loadTab(key);
    if (requestId !== _tabRequestId || _currentTabKey !== key) return;
    _animateContentIn();
  }, { passive: true });
}
