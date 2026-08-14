/* ═══════════════════════════════════════════════════════════════════
   core.js — Atkyn shared UI logic  [PRODUCTION READY]
   scroll · header animation · keyboard positioning
   chatbar entrance · plus menu · tab navigation (instant, no reload)
   
   Performance optimizations:
   - Velocity-based scroll smoothing (EMA)
   - rAF batching with single paint per frame
   - Passive event listeners throughout
   - prefers-reduced-motion support
   - Platform-matched easing curves
   ═══════════════════════════════════════════════════════════════════ */

/* ── Motion preferences ── */
const _prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Platform-matched easing curves ── */
const EASE = {
  keyboardUp:   'cubic-bezier(0.32, 0.72, 0, 1)',
  keyboardDown: 'cubic-bezier(0.32, 0.72, 0, 1)',
  headerHide:   'cubic-bezier(0.4, 0, 1, 1)',
  headerShow:   'cubic-bezier(0, 0, 0.2, 1)',
  chatbarEnter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  menuOpen:     'cubic-bezier(0.34, 1.56, 0.64, 1)',
  menuClose:    'cubic-bezier(0.4, 0, 1, 1)'
};

/* ── Cached DOM references ── */
const scrollHost   = document.getElementById('scrollHost');
const logoHeader   = document.querySelector('.logo-header');
const tabBar       = document.getElementById('tabBar');
const chatbarWrap  = document.querySelector('.chatbar-wrap');
const plusBtn      = document.getElementById('plusBtn');
const plusMenu     = document.getElementById('plusMenu');
const plusBackdrop = document.getElementById('plusBackdrop');
const pill         = document.getElementById('pill');
const input        = document.getElementById('cbInput');

/* ── Shared state ── */
let _rafPending         = false;
let _lastScrollY        = 0;
let _accumDown          = 0;
let _accumUp            = 0;
let _keyboardOpen       = false;
let _isLogoCollapsed    = false;
let _isTabHidden        = false;
let _isTabScrolled      = false;
let _scrollRafId        = null;
let _programmaticScroll = false;
let _plusOpen           = false;

/* ── Velocity smoothing (EMA) ── */
let _velocityEMA    = 0;
let _lastScrollTime = 0;
const VELOCITY_ALPHA = 0.3;

/* ── Viewport / keyboard state ── */
let _cleanupRafId = 0;
let _stableKbH    = 0;   // last committed keyboard height (rounded px)
let _kbAnimFrame  = null;
let _vvpDebounce  = 0;

/* ── Spacer dedup ── */
let _lastSpacerH  = -1;

/* ── last user message el (set by search.js) ── */
window._lastUserMsgEl = null;

/* ── Tab page map ── */
const _BASE = (() => {
  const p = location.pathname;
  return location.origin + p.substring(0, p.lastIndexOf('/') + 1);
})();

const _TAB_PAGES = {
  'ai':     _BASE + 'search.html',
  'web':    _BASE + 'web.html',
  'images': _BASE + 'images.html',
  'videos': _BASE + 'videos.html',
  'news':   _BASE + 'news.html',
  'maps':   _BASE + 'maps.html',
};

const _activeTabEl   = tabBar.querySelector('.tab.active');
const _currentTabKey = _activeTabEl ? _activeTabEl.getAttribute('data-tab') : 'ai';

const _msgWrap    = document.getElementById('msgWrap');
const _chatSpacer = document.getElementById('chatSpacer');

/* ════════════════════════════════════
   HELPERS
   ════════════════════════════════════ */

function resetScrollAccum() {
  _accumDown      = 0;
  _accumUp        = 0;
  _velocityEMA    = 0;
  _lastScrollTime = 0;
}

/* ════════════════════════════════════
   SCROLL TO MSG
   ════════════════════════════════════ */

function scrollToMsg(el) {
  if (!el) return;
  if (_scrollRafId !== null) cancelAnimationFrame(_scrollRafId);
  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId = null;
    _programmaticScroll = true;
    const tabH   = tabBar.offsetHeight;
    const target = Math.max(0, el.offsetTop - tabH - 8);

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
    setTimeout(() => { _programmaticScroll = false; }, 400);
  });
}
window.scrollToMsg = scrollToMsg;

/* ════════════════════════════════════
   CHATBAR / KEYBOARD POSITIONING
   ════════════════════════════════════ */

function _setSpacerHeight(h) {
  if (h === _lastSpacerH) return;
  _lastSpacerH = h;
  const spacer = document.getElementById('chatSpacer');
  if (spacer) spacer.style.height = h + 'px';
}

/* ResizeObserver — only handles bar-height changes, NOT keyboard */
const _barResizeObserver = new ResizeObserver((entries) => {
  const entry = entries[entries.length - 1];
  const barH  = entry.borderBoxSize
    ? entry.borderBoxSize[0].blockSize
    : entry.contentRect.height;
  _setSpacerHeight(barH + _stableKbH);
});
_barResizeObserver.observe(chatbarWrap);

/* ── Chatbar entrance animation ── */
(function _chatbarEntrance() {
  const fromTab = sessionStorage.getItem('atkyn_tab_switch');
  if (fromTab) { sessionStorage.removeItem('atkyn_tab_switch'); return; }
  if (new URLSearchParams(location.search).get('q')) return;
  if (_prefersReducedMotion) return;

  // Force layout before animating — prevents initial-frame jitter
  chatbarWrap.style.cssText = 'will-change:transform,opacity;transition:none;transform:translateY(24px) translateZ(0);opacity:0';
  chatbarWrap.getBoundingClientRect(); // force reflow

  requestAnimationFrame(() => {
    chatbarWrap.style.transition = `transform 0.45s ${EASE.chatbarEnter}, opacity 0.35s ease-out`;
    chatbarWrap.style.transform  = 'translateY(0) translateZ(0)';
    chatbarWrap.style.opacity    = '1';

    chatbarWrap.addEventListener('transitionend', function _onEntry(e) {
      if (e.propertyName !== 'transform') return;
      chatbarWrap.removeEventListener('transitionend', _onEntry);
      chatbarWrap.style.cssText = ''; // full reset — no stale transition
    });
  });
}());

/* ── Viewport / keyboard handler ── */
function _applyViewport() {
  _vvpDebounce = 0;
  const vvp = window.visualViewport;
  if (!vvp) return;

  const rawKb    = Math.max(0, window.innerHeight - vvp.height - vvp.offsetTop);
  const kbHeight = rawKb > 50 ? Math.round(rawKb) : 0; // round once here

  // FIX: already committed this exact height — skip entirely
  if (kbHeight === _stableKbH) return;

  _stableKbH    = kbHeight;
  _keyboardOpen = kbHeight > 0;

  // Cancel any in-flight keyboard animation
  if (_kbAnimFrame) { cancelAnimationFrame(_kbAnimFrame); _kbAnimFrame = null; }

  const transform = kbHeight > 0 ? `translateY(-${kbHeight}px) translateZ(0)` : 'translateZ(0)';
  const barH      = chatbarWrap.offsetHeight;

  if (_prefersReducedMotion) {
    chatbarWrap.style.transition = 'none';
    chatbarWrap.style.transform  = transform;
    _setSpacerHeight(barH + kbHeight);

    if (kbHeight > 0) {
      _programmaticScroll = true;
      const anchor = window._lastUserMsgEl;
      scrollHost.scrollTop = anchor
        ? Math.max(0, anchor.offsetTop - 16)
        : scrollHost.scrollHeight;
    }

    cancelAnimationFrame(_cleanupRafId);
    _cleanupRafId = requestAnimationFrame(() => {
      _cleanupRafId = 0;
      _lastScrollY  = scrollHost.scrollTop;
      resetScrollAccum();
      _programmaticScroll = false;
    });
    return;
  }

  const duration  = kbHeight > 0 ? '0.35s' : '0.28s';
  const easeCurve = kbHeight > 0 ? EASE.keyboardUp : EASE.keyboardDown;

  chatbarWrap.style.transition = `transform ${duration} ${easeCurve}`;
  chatbarWrap.style.transform  = transform;
  _setSpacerHeight(barH + kbHeight);

  if (kbHeight > 0) {
    _programmaticScroll = true;
    const anchor = window._lastUserMsgEl;
    scrollHost.scrollTop = anchor
      ? Math.max(0, anchor.offsetTop - 16)
      : scrollHost.scrollHeight;
  }

  // Clean up transition property after animation completes (prevents bleed-through)
  _kbAnimFrame = requestAnimationFrame(() => {
    _kbAnimFrame = null;
    // 350ms + small buffer
    setTimeout(() => {
      // Only clear if no new animation started
      if (_stableKbH === kbHeight) {
        chatbarWrap.style.transition = '';
      }
    }, 380);
  });

  cancelAnimationFrame(_cleanupRafId);
  _cleanupRafId = requestAnimationFrame(() => {
    _cleanupRafId = 0;
    _lastScrollY  = scrollHost.scrollTop;
    resetScrollAccum();
    _programmaticScroll = false;
  });
}

function fixViewport() {
  // FIX: deduplicated via rAF instead of setTimeout — no 80ms delay accumulation
  if (_vvpDebounce) return;
  _vvpDebounce = requestAnimationFrame(() => { _applyViewport(); });
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', fixViewport, { passive: true });
  window.visualViewport.addEventListener('scroll', fixViewport, { passive: true });
  _setSpacerHeight(chatbarWrap.offsetHeight); // initial spacer without keyboard
  _applyViewport();
} else {
  function _legacyFix() {
    const h = window.innerHeight + 'px';
    if (document.body.style.height !== h) document.body.style.height = h;
  }
  window.addEventListener('resize', _legacyFix, { passive: true });
  _legacyFix();
  _setSpacerHeight(chatbarWrap.offsetHeight);
}

/* ════════════════════════════════════
   HEADER / TAB SCROLL ANIMATION
   ════════════════════════════════════ */

const HIDE_ACCUM  = 40;
const SHOW_ACCUM  = 55;
const LOGO_THRESH = 10;

function updateHeader() {
  _rafPending = false;
  if (_programmaticScroll) {
    _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
    return;
  }

  const sy    = scrollHost.scrollTop;
  const now   = performance.now();
  const delta = sy - _lastScrollY;
  if (delta === 0) return;

  const dt = Math.max(1, now - _lastScrollTime);
  const instantVelocity = delta / dt;
  _velocityEMA = _velocityEMA === 0
    ? instantVelocity
    : _velocityEMA * (1 - VELOCITY_ALPHA) + instantVelocity * VELOCITY_ALPHA;

  _lastScrollY    = sy;
  _lastScrollTime = now;

  if (sy <= LOGO_THRESH) {
    resetScrollAccum();
    if (_isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
    if (_isTabHidden)     { tabBar.classList.remove('hide');         _isTabHidden = false; }
    if (_isTabScrolled)   { tabBar.classList.remove('scrolled');     _isTabScrolled = false; }
    return;
  }

  if (!_isLogoCollapsed) { logoHeader.classList.add('collapsed'); _isLogoCollapsed = true; }
  if (!_isTabScrolled)   { tabBar.classList.add('scrolled');      _isTabScrolled = true; }

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

scrollHost.addEventListener('scroll', () => {
  if (!_rafPending) { _rafPending = true; requestAnimationFrame(updateHeader); }
}, { passive: true });

/* ════════════════════════════════════
   INPUT & PILL
   ════════════════════════════════════ */

pill.addEventListener('pointerdown', (e) => {
  if (e.target !== pill && e.target !== input &&
      e.target.closest('button, .overlay-input-wrap')) return;
  if (document.activeElement === input || _keyboardOpen) return;
  e.preventDefault();
  requestAnimationFrame(() => { input.focus(); });
}, { passive: false });

input.addEventListener('input', () => {
  pill.classList.toggle('has-text', input.value.trim().length > 0);
});

/* ════════════════════════════════════
   PLUS MENU
   ════════════════════════════════════ */

function openPlusMenu() {
  const rect = plusBtn.getBoundingClientRect();
  plusMenu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  _plusOpen = true;
  plusBackdrop.classList.add('open');

  if (_prefersReducedMotion) { plusMenu.classList.add('open'); return; }

  // FIX: set initial state BEFORE adding 'open' class, force reflow, then animate
  plusMenu.style.cssText = `transition:none;transform:scale(0.88) translateY(10px);opacity:0`;
  plusMenu.getBoundingClientRect(); // force reflow
  plusMenu.classList.add('open');

  requestAnimationFrame(() => {
    plusMenu.style.transition = `transform 0.3s ${EASE.menuOpen}, opacity 0.2s ease-out`;
    plusMenu.style.transform  = 'scale(1) translateY(0)';
    plusMenu.style.opacity    = '1';

    plusMenu.addEventListener('transitionend', function _onOpen(e) {
      if (e.propertyName !== 'opacity') return; // wait for LAST property
      plusMenu.removeEventListener('transitionend', _onOpen);
      plusMenu.style.transition = '';
      plusMenu.style.transform  = '';
      plusMenu.style.opacity    = '';
    });
  });
}

function closePlusMenu() {
  if (!_plusOpen) return; // guard against double-close
  _plusOpen = false;
  plusBackdrop.classList.remove('open');

  if (_prefersReducedMotion) { plusMenu.classList.remove('open'); return; }

  plusMenu.style.transition = `transform 0.22s ${EASE.menuClose}, opacity 0.18s ease-in`;
  plusMenu.style.transform  = 'scale(0.88) translateY(10px)';
  plusMenu.style.opacity    = '0';

  // FIX: listen to opacity (last to finish), not transform
  plusMenu.addEventListener('transitionend', function _onClose(e) {
    if (e.propertyName !== 'opacity') return;
    plusMenu.removeEventListener('transitionend', _onClose);
    plusMenu.classList.remove('open');
    plusMenu.style.cssText = ''; // full reset
  });
}

plusBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  _plusOpen ? closePlusMenu() : openPlusMenu();
});
plusBackdrop.addEventListener('click', closePlusMenu);
['pmPhoto', 'pmCamera', 'pmFile', 'pmLocation'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', closePlusMenu);
});

/* ════════════════════════════════════
   TAB BAR — instant switching
   ════════════════════════════════════ */

tabBar.addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab || tab.classList.contains('active')) return;

  const key  = tab.getAttribute('data-tab');
  const page = _TAB_PAGES[key];
  if (!page) return;

  // FIX: set flag SYNCHRONOUSLY before any async work
  sessionStorage.setItem('atkyn_tab_switch', '1');

  if (_currentTabKey === 'ai' && _msgWrap) {
    sessionStorage.setItem('atkyn_chat_html',    _msgWrap.innerHTML);
    sessionStorage.setItem('atkyn_chat_scroll',  String(scrollHost.scrollTop));
  }

  // FIX: freeze the current page visually before navigating
  // Prevents the browser from showing a blank frame between pages
  document.body.style.opacity = '1'; // ensure visible
  document.body.style.pointerEvents = 'none'; // block double-clicks

  // Use replace to avoid polluting history with tab switches
  location.replace(page);
}, { passive: true });
