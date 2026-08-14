/* ═══════════════════════════════════════════════════════════════
   core.js — Atkyn shared UI logic
   scroll · header animation · keyboard positioning
   chatbar entrance · plus menu · tab navigation (instant, no reload)
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

/* ── last user message el (set by search.js) ── */
window._lastUserMsgEl = null;

/* ── Tab page map — absolute paths based on current origin + folder ── */
const _BASE = (() => {
  const p = location.pathname;
  const dir = p.substring(0, p.lastIndexOf('/') + 1);
  return location.origin + dir;
})();

const _TAB_PAGES = {
  'ai':     _BASE + 'search.html',
  'web':    _BASE + 'web.html',
  'images': _BASE + 'images.html',
  'videos': _BASE + 'videos.html',
  'news':   _BASE + 'news.html',
  'maps':   _BASE + 'maps.html',
};

/* ── Current active tab (read from DOM on load) ── */
const _activeTabEl   = tabBar?.querySelector('.tab.active');
const _currentTabKey = _activeTabEl ? _activeTabEl.getAttribute('data-tab') : 'ai';

/* ── Content area refs ── */
const _msgWrap    = document.getElementById('msgWrap');
const _chatSpacer = document.getElementById('chatSpacer');

/* ════════════════════════════════
   HELPERS
   ════════════════════════════════ */

function resetScrollAccum() { 
  _accumDown = 0; 
  _accumUp = 0; 
}

/* ════════════════════════════════
   SCROLL TO MSG
   ════════════════════════════════ */

function scrollToMsg(el) {
  if (!el || !scrollHost) return;
  if (_scrollRafId !== null) cancelAnimationFrame(_scrollRafId);
  
  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId = null;
    _programmaticScroll = true;
    const tabH   = tabBar ? tabBar.offsetHeight : 0;
    const target = Math.max(0, el.offsetTop - tabH - 8);
    
    scrollHost.scrollTo({ top: target, behavior: 'smooth' });
    _lastScrollY = target;
    resetScrollAccum();
    
    setTimeout(() => { _programmaticScroll = false; }, 400);
  });
}
window.scrollToMsg = scrollToMsg;

/* ════════════════════════════════
   CHATBAR / KEYBOARD POSITIONING
   ════════════════════════════════ */

function updateSpacer(kbHeight) {
  const spacer = document.getElementById('chatSpacer');
  if (!spacer || !chatbarWrap) return;

  const barH = chatbarWrap.offsetHeight;
  const spacerH = barH + (kbHeight || 0);

  if (spacerH === _lastSpacerH) return;
  _lastSpacerH = spacerH;
  spacer.style.height = `${spacerH}px`;
}

let _barResizeObserver = null;
if (chatbarWrap) {
  _barResizeObserver = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;

    const barH = entry.borderBoxSize
      ? entry.borderBoxSize[0].blockSize
      : entry.contentRect.height;

    const vvp = window.visualViewport;
    const kbH = _keyboardOpen && vvp
      ? Math.max(0, window.innerHeight - vvp.height - vvp.offsetTop)
      : 0;

    const spacerH = barH + kbH;
    if (spacerH === _lastSpacerH) return;
    _lastSpacerH = spacerH;

    const spacer = document.getElementById('chatSpacer');
    if (spacer) spacer.style.height = `${spacerH}px`;
  });
  
  _barResizeObserver.observe(chatbarWrap);
}

let _debounceTimer = 0;
function fixViewport() { 
  clearTimeout(_debounceTimer); 
  _debounceTimer = setTimeout(_applyViewport, 80); 
}

function _applyViewport() {
  _debounceTimer = 0;
  const vvp = window.visualViewport;
  if (!vvp || !chatbarWrap || !scrollHost) return;

  const rawKb    = Math.max(0, window.innerHeight - vvp.height - vvp.offsetTop);
  const kbHeight = rawKb > 50 ? rawKb : 0;

  if (Math.round(kbHeight) === Math.round(_stableKbH)) return;
  
  _keyboardOpen = kbHeight > 50;
  _stableKbH    = kbHeight;

  chatbarWrap.style.transition = _keyboardOpen ? 'transform 0.30s ease-out' : 'transform 0.40s ease-out';
  chatbarWrap.style.transform  = kbHeight > 0 ? `translateY(-${kbHeight}px) translateZ(0)` : '';

  updateSpacer(kbHeight);

  if (kbHeight > 0) {
    _programmaticScroll = true;
    const anchor = window._lastUserMsgEl;
    scrollHost.scrollTop = anchor ? Math.max(0, anchor.offsetTop - 16) : scrollHost.scrollHeight;
  }

  cancelAnimationFrame(_cleanupRafId);
  _cleanupRafId = requestAnimationFrame(() => {
    _cleanupRafId = 0;
    _lastScrollY  = scrollHost.scrollTop;
    resetScrollAccum();
    _programmaticScroll = false;
  });
}

/* ── Chatbar entrance animation ── */
(function _chatbarEntrance() {
  if (!chatbarWrap) return;
  
  const fromTab = sessionStorage.getItem('atkyn_tab_switch');
  if (fromTab) { 
    sessionStorage.removeItem('atkyn_tab_switch'); 
    return; 
  }
  if (new URLSearchParams(location.search).get('q')) return;

  chatbarWrap.style.willChange = 'transform';
  chatbarWrap.style.transition = 'none';
  chatbarWrap.style.transform  = 'translateY(110%) translateZ(0)';

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      chatbarWrap.style.transition = 'transform 0.42s ease-out';
      chatbarWrap.style.transform  = 'translateZ(0)';
      
      const _onEntryDone = (e) => {
        if (e.propertyName !== 'transform') return;
        chatbarWrap.removeEventListener('transitionend', _onEntryDone);
        chatbarWrap.style.transition = '';
        chatbarWrap.style.transform  = '';
        chatbarWrap.style.willChange = '';
      };
      
      chatbarWrap.addEventListener('transitionend', _onEntryDone);
    });
  });
}());

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', fixViewport, { passive: true });
  window.visualViewport.addEventListener('scroll', fixViewport, { passive: true });
  updateSpacer(0);
  _applyViewport();
} else {
  const _legacyFix = () => {
    const h = `${window.innerHeight}px`;
    if (document.body.style.height !== h) document.body.style.height = h;
  };
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
  if (!scrollHost) return;

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
    if (_isLogoCollapsed && logoHeader) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
    if (_isTabHidden && tabBar)         { tabBar.classList.remove('hide');          _isTabHidden      = false; }
    if (_isTabScrolled && tabBar)       { tabBar.classList.remove('scrolled');      _isTabScrolled    = false; }
    return;
  }

  if (!_isLogoCollapsed && logoHeader) { logoHeader.classList.add('collapsed');  _isLogoCollapsed = true; }
  if (!_isTabScrolled && tabBar)       { tabBar.classList.add('scrolled');       _isTabScrolled    = true; }

  if (delta > 0) {
    _accumDown += delta; 
    if (_accumUp > 0) _accumUp = 0;
    if (!_isTabHidden && tabBar && _accumDown >= HIDE_ACCUM) { 
      tabBar.classList.add('hide'); 
      _isTabHidden = true; 
      _accumDown = 0; 
    }
  } else {
    _accumUp += -delta; 
    if (_accumDown > 0) _accumDown = 0;
    if (_isTabHidden && tabBar && _accumUp >= SHOW_ACCUM) { 
      tabBar.classList.remove('hide'); 
      _isTabHidden = false; 
      _accumUp = 0; 
    }
  }
}

if (scrollHost) {
  scrollHost.addEventListener('scroll', () => {
    if (!_rafPending) { 
      _rafPending = true; 
      requestAnimationFrame(updateHeader); 
    }
  }, { passive: true });
}

/* ════════════════════════════════
   INPUT & PILL
   ════════════════════════════════ */

if (pill) {
  pill.addEventListener('pointerdown', (e) => {
    if (e.target !== pill && e.target !== input && e.target.closest('button, .overlay-input-wrap')) return;
    if (document.activeElement === input || _keyboardOpen) return;
    
    e.preventDefault();
    requestAnimationFrame(() => { input?.focus(); });
  }, { passive: false });
}

if (input) {
  input.addEventListener('input', () => {
    pill?.classList.toggle('has-text', input.value.trim().length > 0);
  });
}

/* ════════════════════════════════
   PLUS MENU
   ════════════════════════════════ */

function openPlusMenu() {
  if (!plusBtn || !plusMenu || !plusBackdrop) return;
  const rect = plusBtn.getBoundingClientRect();
  plusMenu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  _plusOpen = true;
  plusBackdrop.classList.add('open');
  requestAnimationFrame(() => plusMenu.classList.add('open'));
}

function closePlusMenu() {
  if (!plusMenu || !plusBackdrop) return;
  _plusOpen = false;
  plusMenu.classList.remove('open');
  plusBackdrop.classList.remove('open');
}

if (plusBtn) {
  plusBtn.addEventListener('click', (e) => { 
    e.stopPropagation(); 
    _plusOpen ? closePlusMenu() : openPlusMenu(); 
  });
}

if (plusBackdrop) {
  plusBackdrop.addEventListener('click', closePlusMenu);
}

['pmPhoto', 'pmCamera', 'pmFile', 'pmLocation'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', closePlusMenu);
});

/* ════════════════════════════════
   TAB BAR — instant switching
   ════════════════════════════════ */

if (tabBar) {
  tabBar.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab || tab.classList.contains('active')) return;

    const key  = tab.getAttribute('data-tab');
    const page = _TAB_PAGES[key];
    if (!page) return;

    /* Mark tab switch to suppress entrance animation */
    sessionStorage.setItem('atkyn_tab_switch', '1');

    /* Save chat state if leaving Answer tab */
    if (_currentTabKey === 'ai' && _msgWrap) {
      sessionStorage.setItem('atkyn_chat_html', _msgWrap.innerHTML);
      if (scrollHost) {
        sessionStorage.setItem('atkyn_chat_scroll', String(scrollHost.scrollTop));
      }
    }

    location.href = page;
  }, { passive: true });
}
