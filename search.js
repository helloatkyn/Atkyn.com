===== PART 1/5 =====
/* ═══════════════════════════════════════════════════════════════
search.js — Atkyn Search
UI logic · scroll · header animation · tab animation
input · plus menu · chat rendering · stream handling
API interaction · typing animation · copy buttons
event listeners · application state
═══════════════════════════════════════════════════════════════ */
/* ── Cached DOM references ── */
const input        = document.getElementById('cbInput');
const sendBtn      = document.getElementById('sendBtn');
const pill         = document.getElementById('pill');
const msgWrap      = document.getElementById('msgWrap');
const scrollHost   = document.getElementById('scrollHost');
const logoHeader   = document.querySelector('.logo-header');
const tabBar       = document.getElementById('tabBar');
const chatbarWrap  = document.querySelector('.chatbar-wrap');
const chatSpacer   = document.getElementById('chatSpacer');
const plusBtn      = document.getElementById('plusBtn');
const plusMenu     = document.getElementById('plusMenu');
const plusBackdrop = document.getElementById('plusBackdrop');
/* ── Application state ── */
let _rafPending       = false;
let _lastScrollY      = 0;
let _accumDown        = 0;
let _accumUp          = 0;
let _keyboardOpen     = false;
let _isLogoCollapsed  = false;
let _isTabHidden      = false;
let _isTabScrolled    = false;
let _scrollRafId      = null;
let _programmaticScroll = false;
let _lastUserMsgEl    = null;
let _streamAbort      = null;
let _plusOpen         = false;
/* ── Viewport / keyboard internal state ── */
let _vvpRafId    = 0;
let _cleanupRafId = 0;
let _prevOffset  = -1;
/* ── Spacer dedup ── */
let _lastSpacerH = -1;
/* ── Conversation history: max 100 turns ── */
const MAX_HISTORY = 100;
const _history    = [];
/* ── Typing indicator ── */
let _typingEl = null;
/* ════════════════════════════════
HELPERS
════════════════════════════════ */
/** Reset scroll-direction accumulators. */
function resetScrollAccum() {
  _accumDown = 0;
  _accumUp   = 0;
}
/**
* Push a message into the conversation history and enforce the turn cap.
* @param {'user'|'assistant'} role
* @param {string} content
*/
function pushHistory(role, content) {
  _history.push({ role, content });
  if (_history.length > MAX_HISTORY) {
    _history.splice(0, _history.length - MAX_HISTORY);
  }
}
/**
* Escape a string for safe insertion as HTML text content via innerHTML.
* Covers all five characters that can open injection vectors in any context.
* @param {string} str
* @returns {string}
*/
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
/**
* Validate that a URL uses a safe scheme before placing it in an href.
* Returns the URL if safe, otherwise '#'.
* @param {string} url
* @returns {string}
*/
function safeLinkUrl(url) {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? url : '#';
  } catch (_) {
    return '#';
  }
}

===== END PART 1 =====
  ===== PART 2/5 =====
/* ════════════════════════════════
SCROLL HELPERS
════════════════════════════════ */
function scrollToMsg(el) {
  if (!el) return;
  if (_scrollRafId !== null) cancelAnimationFrame(_scrollRafId);
  // One RAF is enough: the element is already in the DOM when this is called,
  // and a single animation frame ensures layout is complete before we measure.
  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId = null;
    _programmaticScroll = true;
    const tabH   = tabBar.offsetHeight;
    const target = Math.max(0, el.offsetTop - tabH - 8);
    scrollHost.scrollTop = target;
    _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
    requestAnimationFrame(() => { _programmaticScroll = false; });
  });
}
/* ════════════════════════════════
CHATBAR / KEYBOARD POSITIONING
════════════════════════════════ */
function updateSpacer(kbHeight) {
  // Use the cached offsetHeight; this is only called from a ResizeObserver
  // callback (which already has an up-to-date layout) or after a viewport event.
  const barH    = chatbarWrap.offsetHeight;
  const spacerH = barH + (kbHeight || 0);
  if (spacerH === _lastSpacerH) return;
  _lastSpacerH = spacerH;
  chatSpacer.style.height = spacerH + 'px';
}
const _barResizeObserver = new ResizeObserver((entries) => {
  // Prefer ResizeObserverEntry geometry to avoid a forced layout read.
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
  chatSpacer.style.height = spacerH + 'px';
});
_barResizeObserver.observe(chatbarWrap);
function fixViewport() {
  if (_vvpRafId) return;
  _vvpRafId = requestAnimationFrame(_applyViewport);
}
function _applyViewport() {
  _vvpRafId = 0;
  const vvp = window.visualViewport;
  if (!vvp) return;
  const kbHeight = Math.max(0, window.innerHeight - vvp.height - vvp.offsetTop);
  if (Math.round(kbHeight) === Math.round(_prevOffset)) return;
  const wasOpen = _keyboardOpen;
  _keyboardOpen = kbHeight > 50;
  _prevOffset   = kbHeight;
  if (_keyboardOpen && !wasOpen) {
    chatbarWrap.style.transition = 'none';
  } else if (!_keyboardOpen && wasOpen) {
    chatbarWrap.style.transition = 'transform 0.28s cubic-bezier(0.0, 0.0, 0.2, 1)';
  }
  chatbarWrap.style.transform = kbHeight > 0
    ? `translateY(-${kbHeight}px) translateZ(0)` : '';
  updateSpacer(kbHeight);
  if (kbHeight > 0) {
    _programmaticScroll = true;
    if (_lastUserMsgEl) {
      scrollHost.scrollTop = Math.max(0, _lastUserMsgEl.offsetTop - 16);
    } else {
      scrollHost.scrollTop = scrollHost.scrollHeight;
    }
  }
  // One RAF is sufficient to let the browser settle before releasing the guard.
  cancelAnimationFrame(_cleanupRafId);
  _cleanupRafId = requestAnimationFrame(() => {
    _cleanupRafId = 0;
    _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
    _programmaticScroll = false;
  });
}
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

===== END PART 2 =====
  
