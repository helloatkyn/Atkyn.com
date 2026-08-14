/* ═══════════════════════════════════════════════════════════════
   core.js — Atkyn shared UI logic
   scroll · header animation · keyboard positioning
   chatbar entrance · plus menu · tab navigation
   Loads on every page. Chat logic is in search.js only.
   ═══════════════════════════════════════════════════════════════ */

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

/* ── Viewport / keyboard internal state ── */
let _cleanupRafId = 0;
let _stableKbH    = 0;

/* ── Spacer dedup ── */
let _lastSpacerH  = -1;

/* ── last user message el — updated by search.js on Answer page ── */
/* exposed so _applyViewport can scroll to it */
window._lastUserMsgEl = null;

/* ════════════════════════════════
   HELPERS
   ════════════════════════════════ */

function resetScrollAccum() {
  _accumDown = 0;
  _accumUp   = 0;
}

/* ════════════════════════════════
   SCROLL TO MSG (used by search.js)
   ════════════════════════════════ */

function scrollToMsg(el) {
  if (!el) return;
  if (_scrollRafId !== null) cancelAnimationFrame(_scrollRafId);
  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId = null;
    _programmaticScroll = true;
    const tabH   = tabBar.offsetHeight;
    const target = Math.max(0, el.offsetTop - tabH - 8);
    scrollHost.scrollTo({ top: target, behavior: 'smooth' });
    _lastScrollY = target;
    resetScrollAccum();
    setTimeout(() => { _programmaticScroll = false; }, 400);
  });
}

/* expose for search.js */
window.scrollToMsg = scrollToMsg;

/* ════════════════════════════════
   CHATBAR / KEYBOARD POSITIONING
   ════════════════════════════════ */

function updateSpacer(kbHeight) {
  /* On non-Answer pages there is no chatSpacer — chatbar still needs positioning */
  const chatSpacer = document.getElementById('chatSpacer');
  const barH    = chatbarWrap.offsetHeight;
  const spacerH = barH + (kbHeight || 0);
  if (spacerH === _lastSpacerH) return;
  _lastSpacerH = spacerH;
  if (chatSpacer) chatSpacer.style.height = spacerH + 'px';
}

const _barResizeObserver = new ResizeObserver((entries) => {
  const entry = entries[entries.length - 1];
  const barH  = entry.borderBoxSize
    ? entry.borderBoxSize[0].blockSize
    : entry.contentRect.height;
  const kbH = _keyboardOpen
    ? Math.max(0, window.innerHeight - (window.visualViewport?.height ?? 0) - (window.visualViewport?.offsetTop ?? 0))
    : 0;
  const spacerH = barH + kbH;
  if (spacerH === _lastSpacerH) return;
  _lastSpacerH = spacerH;
  const chatSpacer = document.getElementById('chatSpacer');
  if (chatSpacer) chatSpacer.style.height = spacerH + 'px';
});
_barResizeObserver.observe(chatbarWrap);

let _debounceTimer = 0;

function fixViewport() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(_applyViewport, 80);
}

function _applyViewport() {
  _debounceTimer = 0;
  const vvp = window.visualViewport;
  if (!vvp) return;

  const rawKb    = Math.max(0, window.innerHeight - vvp.height - vvp.offsetTop);
  const kbHeight = rawKb > 50 ? rawKb : 0;

  if (Math.round(kbHeight) === Math.round(_stableKbH)) return;

  _keyboardOpen = kbHeight > 50;
  _stableKbH    = kbHeight;

  chatbarWrap.style.transition = _keyboardOpen
    ? 'transform 0.30s ease-out'
    : 'transform 0.40s ease-out';

  chatbarWrap.style.transform = kbHeight > 0
    ? `translateY(-${kbHeight}px) translateZ(0)` : '';
  updateSpacer(kbHeight);

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
}

/* ── Chatbar entrance: slide up smoothly on first load ── */
(function _chatbarEntrance() {
  if (new URLSearchParams(location.search).get('q')) return;

  chatbarWrap.style.willChange = 'transform';
  chatbarWrap.style.transition = 'none';
  chatbarWrap.style.transform  = 'translateY(110%) translateZ(0)';

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      chatbarWrap.style.transition = 'transform 0.42s ease-out';
      chatbarWrap.style.transform  = 'translateZ(0)';

      chatbarWrap.addEventListener('transitionend', function _onEntryDone(e) {
        if (e.propertyName !== 'transform') return;
        chatbarWrap.removeEventListener('transitionend', _onEntryDone);
        chatbarWrap.style.transition = '';
        chatbarWrap.style.transform  = '';
        chatbarWrap.style.willChange = '';
      });
    });
  });
}());

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', fixViewport, { passive: true });
  window.visualViewport.addEventListener('scroll', fixViewport, { passive: true });
  updateSpacer(0);
  _applyViewport();
} else {
  function _legacyFix() {
    const h = window.innerHeight + 'px';
    if (document.body.style.height !== h) document.body.style.height = h;
  }
  window.addEventListener('resize', _legacyFix, { passive: true });
  _legacyFix();
  updateSpacer(0);
}

/* ════════════════════════════════
   HEADER / TAB SCROLL ANIMATION
   ════════════════════════════════ */

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
  const delta = sy - _lastScrollY;
  if (delta === 0) return;
  _lastScrollY = sy;

  if (sy <= LOGO_THRESH) {
    resetScrollAccum();
    if (_isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
    if (_isTabHidden)     { tabBar.classList.remove('hide');          _isTabHidden      = false; }
    if (_isTabScrolled)   { tabBar.classList.remove('scrolled');      _isTabScrolled    = false; }
    return;
  }

  if (!_isLogoCollapsed) { logoHeader.classList.add('collapsed'); _isLogoCollapsed = true; }
  if (!_isTabScrolled)   { tabBar.classList.add('scrolled');      _isTabScrolled    = true; }

  if (delta > 0) {
    _accumDown += delta;
    if (_accumUp > 0) _accumUp = 0;
    if (!_isTabHidden && _accumDown >= HIDE_ACCUM) {
      tabBar.classList.add('hide'); _isTabHidden = true; _accumDown = 0;
    }
  } else {
    _accumUp += -delta;
    if (_accumDown > 0) _accumDown = 0;
    if (_isTabHidden && _accumUp >= SHOW_ACCUM) {
      tabBar.classList.remove('hide'); _isTabHidden = false; _accumUp = 0;
    }
  }
}

scrollHost.addEventListener('scroll', () => {
  if (!_rafPending) { _rafPending = true; requestAnimationFrame(updateHeader); }
}, { passive: true });

/* ════════════════════════════════
   INPUT & PILL
   ════════════════════════════════ */

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

/* ════════════════════════════════
   PLUS MENU
   ════════════════════════════════ */

function openPlusMenu() {
  const rect = plusBtn.getBoundingClientRect();
  plusMenu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  _plusOpen = true;
  plusBackdrop.classList.add('open');
  requestAnimationFrame(() => plusMenu.classList.add('open'));
}

function closePlusMenu() {
  _plusOpen = false;
  plusMenu.classList.remove('open');
  plusBackdrop.classList.remove('open');
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

/* ════════════════════════════════
   TAB BAR — real page navigation
   ════════════════════════════════ */

const _TAB_PAGES = {
  'ai':     'search.html',
  'web':    'web.html',
  'images': 'images.html',
  'videos': 'videos.html',
  'news':   'news.html',
  'maps':   'maps.html',
};

tabBar.addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  if (tab.classList.contains('active')) return;
  const key  = tab.getAttribute('data-tab');
  const page = _TAB_PAGES[key];
  if (page) location.href = page;
}, { passive: true });
                                              
