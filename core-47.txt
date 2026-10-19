/* core.js — Atkyn shared UI logic */

/* Reduced motion */
let _prefersReducedMotion = typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Easing / timing */
const EASE = {
  chatbarEnter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  menuOpen: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  menuClose: 'cubic-bezier(0.4, 0, 1, 1)',
  contentSwap: 'cubic-bezier(0.16, 1, 0.3, 1)'
};

const PLUS_HIDDEN = 'scale(0.88) translateY(10px)';
const PLUS_SHOWN = 'scale(1) translateY(0)';
const PLUS_OPEN_MS = 300;
const PLUS_CLOSE_MS = 220;
const PLUS_OPEN_TRANSITION = `transform ${PLUS_OPEN_MS}ms ${EASE.menuOpen}, opacity 200ms ease-out`;
const PLUS_CLOSE_TRANSITION = `transform ${PLUS_CLOSE_MS}ms ${EASE.menuClose}, opacity 180ms ease-in`;

const KB_OPEN_MIN = 50;

/* DOM */
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
const _msgWrap = document.getElementById('msgWrap');
const chatSpacer = document.getElementById('chatSpacer');

/* Plus menu rest styles (captured once, while idle) */
const _plusMenuBase = plusMenu ? {
  transition: plusMenu.style.transition,
  transform: plusMenu.style.transform,
  opacity: plusMenu.style.opacity,
  pointerEvents: plusMenu.style.pointerEvents
} : null;

const vvp = window.visualViewport;

/* Keyboard handling: the viewport meta (interactive-widget=resizes-content)
   makes the layout viewport end at the keyboard, so .chatbar-wrap (fixed,
   bottom-anchored) needs nothing. navigator.virtualKeyboard.overlaysContent is
   deliberately NOT enabled: it would override that meta and make two systems
   compete. The viewport adapter below only covers browsers that do not resize the
   layout viewport (VISUAL mode) and otherwise only sets the data-kb flag. */

/* SVG */
const SVG_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="5 11 12 4 19 11"/></svg>';
const SVG_CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/* ── State ── */

/* Scroll / header */
let _tabBarHeight = tabBar ? tabBar.offsetHeight : 0;
let _rafPending = false;
let _headerRafId = 0;
let _lastScrollY = 0;
let _accumDown = 0;
let _accumUp = 0;
let _isLogoCollapsed = false;
let _isTabHidden = false;
let _isTabScrolled = false;
let _scrollRafId = null;
let _tabScrollRafId = 0;
let _msgScrollCleanup = null;
let _programmaticScroll = false;
let _programmaticScrollToken = 0;
const _scrollOwners = { keyboard: false, message: false, tab: false };

let _velocityEMA = 0;
let _lastScrollTime = 0;
const VELOCITY_ALPHA = 0.3;

/* Chatbar entrance */
let _entranceMove = null;
let _entranceFade = null;

/* Plus menu */
if (typeof _plusOpen === 'undefined') {
  globalThis._plusOpen = false;
}
let _plusAnimationToken = 0;
let _plusFallbackTimer = 0;
let _plusTransitionEndHandler = null;

/* Content transition */
let _contentAnimations = [];
let _contentFallback = null;

/* Chat persistence */
let _chatSavePending = false;
let _chatSaveScroll = 0;
let _chatSaveHandle = 0;

/* Public */
window._lastUserMsgEl = null;

/* Tabs */
let _currentTabKey = (() => {
  if (!tabBar) return 'ai';
  const a = tabBar.querySelector('.tab.active');
  return a ? a.getAttribute('data-tab') : 'ai';
})();
const _moduleCache = {};
const _moduleLoadPromises = {};
const _scriptLoadPromises = {};
const _cssPromises = {};
let _tabLoadRequestId = 0;

/* ════════════════════════════════
   HELPERS
   ════════════════════════════════ */

function _setScrollOwner(owner, on) {
  _scrollOwners[owner] = !!on;
  _programmaticScroll =
    _scrollOwners.keyboard || _scrollOwners.message || _scrollOwners.tab;
}

function resetScrollAccum() {
  _accumDown = 0;
  _accumUp = 0;
  _velocityEMA = 0;
  _lastScrollTime = 0;
}

function _nextTabLoadRequestId() {
  _tabLoadRequestId += 1;
  return _tabLoadRequestId;
}

function _isCurrentTabRequest(key, requestId) {
  return requestId === _tabLoadRequestId && _currentTabKey === key;
}

/* Style flush only (no layout): commits a start state before a transition is armed */
function _flushStyle(el) {
  return getComputedStyle(el).opacity;
}

/* Transform + opacity enter fallback for engines without Element.animate */
function _cssEnter(el, y, moveMs, fadeMs, ease, onDone) {
  let armRaf = 0;
  let timer = 0;
  let ended = false;

  function onEnd(e) {
    if (e.target === el && e.propertyName === 'transform') end();
  }

  function clear() {
    if (armRaf) cancelAnimationFrame(armRaf);
    armRaf = 0;
    clearTimeout(timer);
    el.removeEventListener('transitionend', onEnd);
    el.style.transition = '';
    el.style.opacity = '';
    el.style.transform = '';
  }

  function end() {
    if (ended) return;
    ended = true;
    clear();
    if (onDone) onDone();
  }

  el.style.transition = 'none';
  el.style.opacity = '0';
  el.style.transform = `translateY(${y}px)`;

  /* Two frames: start state must be painted before the transition is armed */
  armRaf = requestAnimationFrame(() => {
    armRaf = requestAnimationFrame(() => {
      armRaf = 0;
      el.style.transition = `transform ${moveMs}ms ${ease}, opacity ${fadeMs}ms ease-out`;
      el.style.opacity = '';
      el.style.transform = '';
      el.addEventListener('transitionend', onEnd);
    });
  });

  /* Watchdog: never leave the element hidden if no transition runs */
  timer = window.setTimeout(end, moveMs + 120);

  return {
    cancel() {
      if (ended) return;
      ended = true;
      clear();
    }
  };
}

/* ════════════════════════════════
   EDITABLE CHECK
   ════════════════════════════════ */

function _isEditableElement(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
  }
  return false;
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

/* Non-AI tab clear/cancel only; submission is owned elsewhere */
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

function _cancelMessageScroll() {
  _programmaticScrollToken += 1;

  if (_scrollRafId !== null) {
    cancelAnimationFrame(_scrollRafId);
    _scrollRafId = null;
  }

  if (_msgScrollCleanup) {
    _msgScrollCleanup();
    _msgScrollCleanup = null;
  }

  _setScrollOwner('message', false);
}

/* Resolves when a smooth scroll ends, is interrupted by the user, or stalls */
function _watchScrollSettle(done) {
  let raf = 0;
  let timer = 0;
  let still = 0;
  let last = scrollHost.scrollTop;

  function cleanup() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(timer);
    scrollHost.removeEventListener('scrollend', finish);
    scrollHost.removeEventListener('touchstart', finish);
    scrollHost.removeEventListener('wheel', finish);
  }

  function finish() {
    cleanup();
    done();
  }

  scrollHost.addEventListener('touchstart', finish, { passive: true });
  scrollHost.addEventListener('wheel', finish, { passive: true });

  if ('onscrollend' in window) {
    scrollHost.addEventListener('scrollend', finish, { passive: true });
  } else {
    const tick = () => {
      const top = scrollHost.scrollTop;
      still = top === last ? still + 1 : 0;
      last = top;

      if (still >= 4) {
        finish();
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
  }

  /* Watchdog for a scroll that never starts or never reports its end */
  timer = window.setTimeout(finish, 1500);

  return cleanup;
}

function scrollToMsg(el) {
  if (!el || !scrollHost) return;

  _cancelMessageScroll();
  const token = _programmaticScrollToken;

  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId = null;

    if (token !== _programmaticScrollToken) return;

    /* Read phase */
    if (tabBar) _tabBarHeight = tabBar.offsetHeight;
    if (el === _turnEl) _updateTail();
    const maxTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
    /* Content-space top of el from rects. el.offsetTop is relative to its
       offsetParent (.msg-wrap has contain: layout), which ignores the header,
       tabs and chat-area padding above the message list. */
    const contentTop = el.getBoundingClientRect().top -
      scrollHost.getBoundingClientRect().top + scrollHost.scrollTop;
    const target = Math.min(maxTop, Math.max(0, contentTop - _tabBarHeight - TURN_TOP_GAP));
    const distance = Math.abs(target - scrollHost.scrollTop);

    _setScrollOwner('message', true);

    if (_prefersReducedMotion || distance < 1) {
      if (distance >= 1) scrollHost.scrollTop = target;
      _lastScrollY = scrollHost.scrollTop;
      resetScrollAccum();
      _setScrollOwner('message', false);
      return;
    }

    scrollHost.scrollTo({ top: target, behavior: 'smooth' });

    _msgScrollCleanup = _watchScrollSettle(() => {
      _msgScrollCleanup = null;
      if (token !== _programmaticScrollToken) return;

      _setScrollOwner('message', false);
      _lastScrollY = scrollHost.scrollTop;
      resetScrollAccum();
    });
  });
}

window.scrollToMsg = scrollToMsg;

/* ════════════════════════════════
   CHATBAR ENTRANCE
   ════════════════════════════════ */

function _endEntranceMove() {
  _entranceMove = null;
}

function _startChatbarEntrance() {
  if (!chatbarWrap || _prefersReducedMotion) return;

  if (typeof chatbarWrap.animate !== 'function') {
    _entranceMove = _cssEnter(chatbarWrap, 24, 420, 300, EASE.chatbarEnter, _endEntranceMove);
    return;
  }

  /* 'backwards' fill: start state applies immediately, nothing is held after the end */
  const move = chatbarWrap.animate(
    [
      { transform: 'translateY(24px) translateZ(0)' },
      { transform: 'translateY(0) translateZ(0)' }
    ],
    { duration: 420, easing: EASE.chatbarEnter, fill: 'backwards' }
  );

  const fade = chatbarWrap.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: 300, easing: 'ease-out', fill: 'backwards' }
  );

  move.onfinish = move.oncancel = () => {
    if (_entranceMove === move) _endEntranceMove();
  };

  fade.onfinish = fade.oncancel = () => {
    if (_entranceFade === fade) _entranceFade = null;
  };

  _entranceMove = move;
  _entranceFade = fade;
}

function _cancelChatbarEntrance() {
  const move = _entranceMove;
  const fade = _entranceFade;

  _entranceMove = null;
  _entranceFade = null;

  if (move) {
    move.onfinish = move.oncancel = null;
    move.cancel();
  }

  if (fade) {
    fade.onfinish = fade.oncancel = null;
    fade.cancel();
  }
}

/* ════════════════════════════════
   CHATBAR
   Keyboard positioning is CSS-first: <meta viewport interactive-widget=resizes-content>
   shrinks the layout viewport, so the fixed .chatbar-wrap (chatbar.css) ends up directly
   above the keyboard. The viewport adapter below only adds --cb-kb-offset for browsers
   that do not resize the layout viewport (VISUAL mode), and the data-kb flag used for spacing.
   ════════════════════════════════ */

/* ── Bottom anchor (single rule for "stay at the bottom") ──
   scrollHost is the only scroller. Ordinary streaming keeps the established near-bottom
   heuristic; a keyboard session snapshots the user's exact bottom intent before focus changes
   the viewport. That keeps an intentional upward scroll out of keyboard anchor restoration,
   without changing the established streaming behavior when the keyboard is not involved. */
const NEAR_BOTTOM_PX = 64;
const KEYBOARD_BOTTOM_EPSILON = 2;
let _bottomDist = 0;
let _stickBottom = true;
let _anchorRelease = 0;

/* Capture scroll intent before focus can change viewport geometry. Keyboard anchoring uses
   an exact-bottom decision, independent of the 64px threshold used for normal streaming. */
let _keyboardScrollSession = null;
let _keyboardSessionEndRaf = 0;

function _beginKeyboardScrollSession() {
  if (!scrollHost || !_chatVisible()) {
    _keyboardScrollSession = null;
    return;
  }

  if (_keyboardSessionEndRaf) {
    cancelAnimationFrame(_keyboardSessionEndRaf);
    _keyboardSessionEndRaf = 0;
  }

  const maxTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
  const dist = Math.max(0, maxTop - scrollHost.scrollTop);
  const atBottom = dist <= KEYBOARD_BOTTOM_EPSILON;
  _keyboardScrollSession = {
    followBottom: atBottom,
    bottomDist: atBottom ? 0 : dist,
    sawKeyboard: _vpOpen,
    userMovedUp: false
  };
}

function _syncKeyboardScrollSession(open, editing) {
  const session = _keyboardScrollSession;
  if (!session) return;

  if (open) {
    session.sawKeyboard = true;
    if (_keyboardSessionEndRaf) {
      cancelAnimationFrame(_keyboardSessionEndRaf);
      _keyboardSessionEndRaf = 0;
    }
    return;
  }

  /* Initial focus precedes the first viewport-resize event. Keep its snapshot until the
     keyboard opens, or focus is genuinely abandoned. */
  if (!session.sawKeyboard && editing) return;
  if (_keyboardSessionEndRaf) return;

  _keyboardSessionEndRaf = requestAnimationFrame(() => {
    _keyboardSessionEndRaf = 0;
    const current = _keyboardScrollSession;
    if (!current || _vpOpen) return;
    const stillEditing = _isEditableElement(document.activeElement);
    if (stillEditing && !current.sawKeyboard) return;

    _keyboardScrollSession = null;
    if (current.followBottom) {
      /* Preserve the keyboard session's captured intent. Measuring the spacer here can
         mistake an intentional blank turn-tail for a user who left the bottom. */
      _stickBottom = true;
      _bottomDist = current.bottomDist;
    } else {
      _stickBottom = false;
    }
  });
}

/* Layout-induced scroll (browser clamp). When the scroller's max scroll position shrinks
   (keyboard opens, composer loses its safe-area padding, spacer shrinks) the browser clamps
   scrollTop and fires a scroll event that is NOT user input. A clamp is recognised exactly:
   the previous sampled scrollTop is beyond the new maximum, which a finger can never produce.
   Such events must not update scroll intent (_bottomDist/_stickBottom) nor drive the header
   collapse/tab-bar hide logic, otherwise the clamp is read as a user scroll and triggers a
   second layout change in the middle of the keyboard transition. */
let _sampleTop = 0;
let _scrollWasClamp = false;

function _sampleScroll() {
  const top = scrollHost.scrollTop;
  const maxTop = scrollHost.scrollHeight - scrollHost.clientHeight;
  _scrollWasClamp = _sampleTop > maxTop + 1 && top <= maxTop + 1;
  _sampleTop = top;
}

function _chatVisible() {
  return !chatArea || chatArea.style.display !== 'none';
}

function _trackBottom() {
  if (!scrollHost) return;
  _bottomDist = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight - scrollHost.scrollTop);
  _stickBottom = _bottomDist <= NEAR_BOTTOM_PX;
}

/* The one place anchor/follow code writes scrollTop. Ownership is released
   after the resulting scroll event has been dispatched. */
let _dbgWrites = 0;   /* number of anchor/follow scroll writes (see ?kbdebug=1 trace) */

function _writeScrollTop(top) {
  _dbgWrites++;
  _setScrollOwner('keyboard', true);
  scrollHost.scrollTop = top;
  _lastScrollY = top;
  resetScrollAccum();

  if (_anchorRelease) cancelAnimationFrame(_anchorRelease);
  _anchorRelease = requestAnimationFrame(() => {
    _anchorRelease = 0;
    _lastScrollY = scrollHost.scrollTop;
    _setScrollOwner('keyboard', false);
  });
}

/* Where the anchor wants scrollTop. Normally: same distance from the bottom. While a blank
   turn tail is open (--cb-tail-min > 0) the real content ends far above the scroll bottom, so
   keeping the distance would shove the content up by the full keyboard height for nothing.
   Then only reveal what the composer actually covers (last message above the pill). */
const ANCHOR_REVEAL_GAP = 16;

function _anchorTarget(maxTop, dist) {
  let top = Math.max(0, maxTop - dist);
  if (_tailPx > 0 && _msgWrap && pill) {
    const need = _msgWrap.getBoundingClientRect().bottom -
                 (pill.getBoundingClientRect().top - ANCHOR_REVEAL_GAP);
    top = Math.min(top, scrollHost.scrollTop + Math.max(0, Math.ceil(need)));
  }
  return top;
}

function _restoreBottomAnchor() {
  if (!scrollHost || !_chatVisible()) return;
  if (_scrollOwners.message || _scrollOwners.tab) return;

  const session = _keyboardScrollSession;
  const followBottom = session ? session.followBottom : _stickBottom;
  if (!followBottom) return;

  const maxTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
  const distance = session ? session.bottomDist : _bottomDist;
  const top = _anchorTarget(maxTop, distance);
  if (Math.abs(top - scrollHost.scrollTop) < 1) return;
  _writeScrollTop(top);
}

/* ── Turn positioning + following ──
   Model (ChatGPT-style): sending a message moves that user message near the top
   (scrollToMsg). --cb-tail-min grows #chatSpacer just enough for that to be
   possible and shrinks as the answer fills the screen, so scrollHeight stays
   put while the answer grows into the blank space. Once the answer is taller than
   the screen the tail is 0 and the normal rule applies: if the user is at the
   bottom (_stickBottom, measured from scroll events BEFORE the content grew),
   keep the newest content in view; if they scrolled up, leave them alone. */
const TURN_TOP_GAP = 8;
let _turnEl = null;
let _tailPx = 0;

function _setTail(px) {
  if (px === _tailPx) return;
  _tailPx = px;
  document.documentElement.style.setProperty('--cb-tail-min', px + 'px');
}

function _updateTail() {
  const el = _turnEl;
  if (!el || !el.isConnected || !_msgWrap || !scrollHost || !_chatVisible()) {
    _setTail(0);
    return;
  }

  const inset = tabBar ? tabBar.offsetHeight : 0;
  const avail = scrollHost.clientHeight - inset - TURN_TOP_GAP;
  const after = _msgWrap.getBoundingClientRect().bottom - el.getBoundingClientRect().top;
  _setTail(Math.max(0, Math.round(avail - after)));
}

/* Runs after layout, before paint, once per frame (ResizeObserver) */
function _followContent() {
  if (!scrollHost || !_chatVisible()) return;
  _updateTail();

  const session = _keyboardScrollSession;
  if (!(session ? session.followBottom : _stickBottom) ||
      _scrollOwners.message || _scrollOwners.tab) return;

  const maxTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
  const distance = session ? session.bottomDist : 0;
  const target = _anchorTarget(maxTop, distance);
  if (target - scrollHost.scrollTop > 1) {
    _writeScrollTop(target);
    _bottomDist = 0;
    if (session) session.bottomDist = 0;
  }
}

window.AtkynScroll = {
  /* A new user message was added: bring it to the reading position */
  beginTurn(el) {
    _turnEl = el || null;
    if (el) scrollToMsg(el);
  }
};

if (scrollHost) {
  /* Scroll events caused by our own anchor/follow writes (_writeScrollTop) are not user
     intent. They are dispatched a frame later, by which time a further keyboard resize
     step may have changed scrollHeight/clientHeight; measuring then records a distance
     that never existed, flips _stickBottom to false and disengages the anchor for the
     rest of the keyboard animation. Intent (_bottomDist/_stickBottom) is therefore only
     updated from scrolls we did not write. _scrollOwners.keyboard stays true from the
     write until the frame after its scroll event (see _writeScrollTop). */
  scrollHost.addEventListener('scroll', () => {
    const previousTop = _sampleTop;
    _sampleScroll();                 /* always: keeps the clamp reference current */
    const wasClamp = _scrollWasClamp;
    if (_scrollOwners.keyboard) return;

    _trackBottom();

    /* A real scroll away from the bottom is stronger intent than the 64px near-bottom
       streaming heuristic. Browser clamps and message/tab-owned scrolls are excluded. */
    const session = _keyboardScrollSession;
    const changed = Math.abs(scrollHost.scrollTop - previousTop) > 1;
    if (session && changed && !wasClamp &&
        !_scrollOwners.message && !_scrollOwners.tab) {
      const top = scrollHost.scrollTop;
      const maxTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
      const dist = Math.max(0, maxTop - top);
      session.bottomDist = dist <= KEYBOARD_BOTTOM_EPSILON ? 0 : dist;
      if (dist <= KEYBOARD_BOTTOM_EPSILON) {
        session.followBottom = true;
        session.userMovedUp = false;
      } else {
        session.followBottom = false;
        if (top < previousTop - 1) session.userMovedUp = true;
      }
      if (session.userMovedUp) _stickBottom = false;
    }
  }, { passive: true });
  _trackBottom();
  _sampleTop = scrollHost.scrollTop;

  if (typeof ResizeObserver === 'function') {
    let _hostH = scrollHost.clientHeight;
    new ResizeObserver(() => {
      const h = scrollHost.clientHeight;
      const shrank = h < _hostH;
      _hostH = h;
      _updateTail();
      /* Growing (keyboard closing): the browser has already clamped scrollTop during layout.
         Re-derive the intent from that settled position so the next keyboard open anchors
         to where the page really is. Not a write, so it cannot add a scroll correction. */
      if (!shrank && !_scrollOwners.message && !_scrollOwners.tab) _trackBottom();
      if (shrank) {
        /* chatbarWrap's RO runs after this one; without this the restore below would use the
           previous spacer height and be corrected again by _syncSpacer. Publish first. */
        _syncSpacer();
        _restoreBottomAnchor();
      }
    }).observe(scrollHost);

    /* Message list grew (streamed text, cards, images loading, final render):
       one coordinated reaction per frame, no per-callsite scroll calls */
    if (_msgWrap) new ResizeObserver(_followContent).observe(_msgWrap);
  }
}

/* Spacer under the chat: height comes from CSS (--cb-bar-h + --cb-content-gap).
   JS only publishes the composer's real height. */
let _closedPadB = null;

function _syncSpacer() {
  if (!chatbarWrap) return;

  let h = Math.ceil(chatbarWrap.getBoundingClientRect().height) || chatbarWrap.offsetHeight;
  if (h <= 0) return;

  /* The bottom padding drops from (gap + safe-area) to the keyboard gap while the keyboard
     is open (html[data-kb]). That moves the pill but must NOT change the content spacer:
     otherwise one keyboard open = two geometry changes (viewport, then scrollHeight), i.e.
     a second scroll correction. Content space is always measured with the closed-state
     padding; the closed value is captured whenever the keyboard is not open. */
  const padB = parseFloat(getComputedStyle(chatbarWrap).paddingBottom) || 0;
  if (!document.documentElement.hasAttribute('data-kb')) _closedPadB = padB;
  h = Math.ceil(h - padB + (_closedPadB === null ? padB : _closedPadB));

  const px = h + 'px';
  const root = document.documentElement;
  if (root.style.getPropertyValue('--cb-bar-h') === px) return;

  root.style.setProperty('--cb-bar-h', px);
  if (chatSpacer && chatSpacer.style.height) chatSpacer.style.height = '';
  _restoreBottomAnchor();
}

if (chatbarWrap && typeof ResizeObserver === 'function') {
  new ResizeObserver(_syncSpacer).observe(chatbarWrap);
}
_syncSpacer();

_startChatbarEntrance();

/* ── Viewport adapter: one positioning authority per environment ──
   LAYOUT mode is used on Android browsers configured to resize the layout viewport
   (interactive-widget=resizes-content): the fixed bar follows the resized viewport and JS
   does not add a keyboard offset. VISUAL mode is used where the layout viewport stays still;
   in that case the measured covered height lifts the bar. These modes stay mutually exclusive
   to prevent browser-native resize and JavaScript translation from compensating twice. */
const _LAYOUT_RESIZES = /Android/i.test(navigator.userAgent) || 'virtualKeyboard' in navigator;

let _vpRaf = 0;
let _vpOffset = 0;
let _vpOpen = false;
let _stableH = 0;        /* VISUAL mode: visual viewport height before the keyboard session */
let _stableW = 0;
let _stableLayoutH = 0;  /* LAYOUT mode: layout viewport height before the keyboard session */
let _stableLayoutW = 0;

function _setKbFlag(open) {
  if (open === _vpOpen) return;
  _vpOpen = open;
  if (open) document.documentElement.setAttribute('data-kb', 'open');
  else document.documentElement.removeAttribute('data-kb');
}

/* LAYOUT mode: let fixed positioning follow the layout viewport. Hold the keyboard flag
   through the closing resize so the composer's bottom padding does not change mid-animation. */
function _syncKeyboardLayout() {
  const root = document.documentElement;
  const editing = _isEditableElement(document.activeElement);
  const lh = root.clientHeight;
  const lw = root.clientWidth;
  const resized = _stableLayoutW && Math.abs(lw - _stableLayoutW) > 50;

  if (resized || !_stableLayoutH || (!_vpOpen && !editing)) {
    _stableLayoutH = lh;
    _stableLayoutW = lw;
  }

  const shrink = Math.max(0, _stableLayoutH - lh);
  const opening = editing && shrink > KB_OPEN_MIN;
  const closing = _vpOpen && shrink > 1;
  const open = opening || closing;
  _setKbFlag(open);
  _syncKeyboardScrollSession(open, editing);
}

/* VISUAL mode: retain the offset until the visual viewport has actually returned, even if
   blur fires first. Keep the closed-height reference frozen throughout that same interval. */
function _syncKeyboardVisual() {
  const editing = _isEditableElement(document.activeElement);
  const vh = vvp.height;
  const vw = vvp.width;
  const root = document.documentElement;
  const layoutH = root.clientHeight;
  const covered = Math.max(0, layoutH - (vvp.offsetTop + vh));
  const zoomed = vvp.scale > 1.01;

  if (!editing && !_vpOpen) {
    _stableH = vh;
    _stableW = vw;
  }

  const keyboardSession = editing || _vpOpen;
  const offset = keyboardSession && !zoomed && covered > 1 ? Math.round(covered) : 0;
  const shrink = _stableH && Math.abs(vw - _stableW) <= 50
    ? Math.max(0, _stableH - vh)
    : 0;
  const opening = editing && !zoomed && (offset > KB_OPEN_MIN || shrink > KB_OPEN_MIN);
  const closing = _vpOpen && !zoomed && (offset > 1 || shrink > 1);
  const open = opening || closing;

  _setKbFlag(open);
  _syncKeyboardScrollSession(open, editing);

  if (offset !== _vpOffset) {
    _vpOffset = offset;
    if (offset > 0) root.style.setProperty('--cb-kb-offset', offset + 'px');
    else root.style.removeProperty('--cb-kb-offset');
    _restoreBottomAnchor();
  }

  /* The closed baseline may be refreshed only after the close has actually settled. */
  if (!open && !editing) {
    _stableH = vh;
    _stableW = vw;
  }
}

function _syncViewport() {
  _vpRaf = 0;
  if (_LAYOUT_RESIZES) _syncKeyboardLayout();
  else if (vvp) _syncKeyboardVisual();
}

function _scheduleViewportSync() {
  if (_vpRaf) return;
  _vpRaf = requestAnimationFrame(_syncViewport);
}

if (scrollHost) {
  window.addEventListener('resize', _scheduleViewportSync, { passive: true });
  document.addEventListener('focusin', (event) => {
    if (input && event.target === input && !_keyboardScrollSession) {
      _beginKeyboardScrollSession();
    }
    _scheduleViewportSync();
  }, { passive: true });
  document.addEventListener('focusout', _scheduleViewportSync, { passive: true });

  if (vvp && !_LAYOUT_RESIZES) {
    vvp.addEventListener('resize', _scheduleViewportSync, { passive: true });
    vvp.addEventListener('scroll', _scheduleViewportSync, { passive: true });
  }
  _scheduleViewportSync();
}

/* Measurement trace for real-device testing: open the page with ?kbdebug=1.
   Each timestamped line captures visual/layout viewport height, scroll-host dimensions, scroll
   position and bottom distance, composer position, spacer height, anchor-write count, captured
   keyboard intent, and keyboard flag. Some writes are expected as a resizing viewport animates;
   inspect for more than one conflicting correction at the same geometry step and for stability
   after the keyboard and viewport have fully settled. */
if (scrollHost && /[?&]kbdebug=1/.test(location.search)) {
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;margin:0;padding:4px;' +
    'font:10px/1.25 monospace;background:rgba(0,0,0,.8);color:#0f0;pointer-events:none;' +
    'white-space:pre-wrap;max-height:42vh;overflow:hidden';
  document.body.appendChild(box);
  const lines = [];
  let prev = '';
  const t0 = performance.now();
  const tick = () => {
    const top = scrollHost.scrollTop;
    const dist = scrollHost.scrollHeight - scrollHost.clientHeight - top;
    const root = document.documentElement;
    const cur = 'vv=' + (vvp ? Math.round(vvp.height) : '-') +
      ' vh=' + Math.round(root.clientHeight) + ' ch=' + Math.round(scrollHost.clientHeight) +
      ' sh=' + Math.round(scrollHost.scrollHeight) + ' top=' + Math.round(top) +
      ' dist=' + Math.round(dist) +
      ' pill=' + (pill ? Math.round(pill.getBoundingClientRect().top) : '-') +
      ' bar=' + (chatbarWrap ? Math.round(chatbarWrap.getBoundingClientRect().top) : '-') +
      ' sp=' + (chatSpacer ? Math.round(chatSpacer.getBoundingClientRect().height) : '-') +
      ' w=' + _dbgWrites + ' stick=' + (_stickBottom ? 1 : 0) +
      ' kfollow=' + (_keyboardScrollSession && _keyboardScrollSession.followBottom ? 1 : 0) +
      ' kb=' + (_vpOpen ? 1 : 0);
    if (cur !== prev) {
      prev = cur;
      lines.push(String(Math.round(performance.now() - t0)).padStart(6) + ' ' + cur);
      if (lines.length > 16) lines.shift();
      box.textContent = lines.join('\n');
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* Kept so any other script that still calls it does not throw */
function fixViewport() {}

/* ════════════════════════════════
   CHAT PERSISTENCE (off the tab-click path)
   ════════════════════════════════ */

function _flushChatSave() {
  if (!_chatSavePending) return;
  _chatSavePending = false;

  try {
    sessionStorage.setItem('atkyn_chat_html', _msgWrap.innerHTML);
    sessionStorage.setItem('atkyn_chat_scroll', String(_chatSaveScroll));
  } catch (_) {}
}

function _queueChatSave() {
  if (!_msgWrap) return;

  _chatSavePending = true;
  _chatSaveScroll = scrollHost ? scrollHost.scrollTop : 0;

  if (_chatSaveHandle) return;

  const run = () => {
    _chatSaveHandle = 0;
    _flushChatSave();
  };

  _chatSaveHandle = typeof requestIdleCallback === 'function'
    ? requestIdleCallback(run, { timeout: 800 })
    : window.setTimeout(run, 120);
}

/* ════════════════════════════════
   LIFECYCLE
   ════════════════════════════════ */

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') _flushChatSave();
}, { passive: true });

window.addEventListener('pagehide', () => {
  _flushChatSave();

  if (_headerRafId) {
    cancelAnimationFrame(_headerRafId);
    _headerRafId = 0;
    _rafPending = false;
  }

  if (_tabScrollRafId) {
    cancelAnimationFrame(_tabScrollRafId);
    _tabScrollRafId = 0;
    _setScrollOwner('tab', false);
  }

  _cancelMessageScroll();
  _cancelChatbarEntrance();
  _clearContentAnimation();
  _settlePlusMenu();
}, { passive: true });

/* ════════════════════════════════
   REDUCED-MOTION CHANGE
   ════════════════════════════════ */

if (window.matchMedia) {
  const reducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  const _onReducedMotionChange = (e) => {
    _prefersReducedMotion = e.matches;

    if (_prefersReducedMotion) {
      _cancelChatbarEntrance();
      _clearContentAnimation();
      _settlePlusMenu();
    }
  };

  if (reducedMotionMQ.addEventListener) {
    reducedMotionMQ.addEventListener('change', _onReducedMotionChange);
  } else if (reducedMotionMQ.addListener) {
    reducedMotionMQ.addListener(_onReducedMotionChange);
  }
}

/* ════════════════════════════════
   HEADER / TAB SCROLL ANIMATION
   ════════════════════════════════ */

const HIDE_ACCUM = 40;
const SHOW_ACCUM = 55;
const LOGO_THRESH = 10;
const VELOCITY_MIN = 0.05;
const IDLE_GAP = 120;

function updateHeader(now) {
  _rafPending = false;
  _headerRafId = 0;

  if (!scrollHost || !logoHeader || !tabBar) return;

  const sy = scrollHost.scrollTop;

  if (_programmaticScroll) {
    _lastScrollY = sy;
    resetScrollAccum();
    return;
  }

  const delta = sy - _lastScrollY;

  if (delta === 0) return;

  now = now || performance.now();
  /* First sample after a reset has no previous timestamp */
  const dt = _lastScrollTime ? Math.max(1, now - _lastScrollTime) : 16;
  const v = delta / dt;

  /* Reseed on first sample, idle gap, or direction reversal so stale velocity never leaks */
  _velocityEMA = (_velocityEMA === 0 || dt > IDLE_GAP || (v > 0) !== (_velocityEMA > 0))
    ? v
    : _velocityEMA * (1 - VELOCITY_ALPHA) + v * VELOCITY_ALPHA;

  _lastScrollY = sy;
  _lastScrollTime = now;

  if (sy <= LOGO_THRESH) {
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

  if (delta > 0) {
    _accumUp = 0;

    if (_velocityEMA > VELOCITY_MIN) {
      _accumDown += delta;

      if (!_isTabHidden && _accumDown >= HIDE_ACCUM) {
        tabBar.classList.add('hide');
        _isTabHidden = true;
        _accumDown = 0;
      }
    }
  } else {
    _accumDown = 0;

    if (_velocityEMA < -VELOCITY_MIN) {
      _accumUp -= delta;

      if (_isTabHidden && _accumUp >= SHOW_ACCUM) {
        tabBar.classList.remove('hide');
        _isTabHidden = false;
        _accumUp = 0;
      }
    }
  }
}

if (scrollHost) {
  scrollHost.addEventListener('scroll', () => {
    if (_programmaticScroll || _scrollWasClamp) {
      _lastScrollY = scrollHost.scrollTop;
      if (_scrollWasClamp) resetScrollAccum();
      return;
    }

    if (!_rafPending) {
      _rafPending = true;
      _headerRafId = requestAnimationFrame(updateHeader);
    }
  }, { passive: true });
}

/* ════════════════════════════════
   INPUT & PILL
   ════════════════════════════════ */

if (pill && input) {
  pill.addEventListener('pointerdown', (e) => {
    const target = e.target instanceof Element ? e.target : null;

    /* Plus button has its own click handler */
    if (plusBtn && target && (target === plusBtn || plusBtn.contains(target))) {
      return;
    }

    if (
      target &&
      target !== pill &&
      target !== input &&
      !target.closest('button, .overlay-input-wrap')
    ) {
      return;
    }

    if (document.activeElement === input) {
      /* Android can dismiss the IME without blurring the input. Refresh intent before a
         subsequent tap reopens it, but never recapture while the keyboard is already up. */
      if (!_vpOpen) _beginKeyboardScrollSession();
      return;
    }

    _beginKeyboardScrollSession();
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

function _unwatchPlus() {
  if (_plusFallbackTimer) {
    clearTimeout(_plusFallbackTimer);
    _plusFallbackTimer = 0;
  }

  if (plusMenu && _plusTransitionEndHandler) {
    plusMenu.removeEventListener('transitionend', _plusTransitionEndHandler);
    _plusTransitionEndHandler = null;
  }
}

function _cancelPlusAnimation() {
  _plusAnimationToken += 1;
  _unwatchPlus();
}

/* Finish on the transform transition; watchdog covers a transition that never runs */
function _watchPlusTransition(token, done, ms) {
  const finish = () => done(token);

  _plusTransitionEndHandler = (e) => {
    if (e.target === plusMenu && e.propertyName === 'transform') finish();
  };

  plusMenu.addEventListener('transitionend', _plusTransitionEndHandler);
  _plusFallbackTimer = window.setTimeout(finish, ms + 80);
}

function _applyPlusRest() {
  plusMenu.style.transition = _plusMenuBase.transition;
  plusMenu.style.transform = _plusMenuBase.transform;
  plusMenu.style.opacity = _plusMenuBase.opacity;
  plusMenu.style.pointerEvents = _plusMenuBase.pointerEvents;
}

function _finishPlusOpen(token) {
  if (!plusMenu || token !== _plusAnimationToken || !_plusOpen) return;

  _unwatchPlus();
  _applyPlusRest();
}

function _finishPlusClose(token) {
  if (!plusMenu || token !== _plusAnimationToken || _plusOpen) return;

  _unwatchPlus();

  const instant = _prefersReducedMotion;
  if (instant) plusMenu.style.transition = 'none';

  plusMenu.classList.remove('open');
  plusBackdrop?.classList.remove('open');

  if (instant) _flushStyle(plusMenu);
  _applyPlusRest();
}

/* Jump to the final state of the current intent (reduced motion, pagehide) */
function _settlePlusMenu() {
  if (!plusMenu || !plusBackdrop) return;

  _cancelPlusAnimation();

  if (_plusOpen) {
    plusMenu.classList.add('open');
    plusBackdrop.classList.add('open');
    _applyPlusRest();
    if (_prefersReducedMotion) plusMenu.style.transition = 'none';
  } else if (plusMenu.classList.contains('open')) {
    _finishPlusClose(_plusAnimationToken);
  }
}

function openPlusMenu() {
  if (!plusBtn || !plusMenu || !plusBackdrop) return;
  if (_plusOpen) return;

  /* Menu still carries 'open' only while a close is in flight */
  const resuming = plusMenu.classList.contains('open');

  _cancelPlusAnimation();
  const token = _plusAnimationToken;

  _plusOpen = true;
  plusBackdrop.classList.add('open');

  if (_prefersReducedMotion) {
    plusMenu.classList.add('open');
    _applyPlusRest();
    plusMenu.style.transition = 'none';
    return;
  }

  plusMenu.style.pointerEvents = _plusMenuBase.pointerEvents;

  if (!resuming) {
    plusMenu.classList.add('open');
    plusMenu.style.transition = 'none';
    plusMenu.style.transform = PLUS_HIDDEN;
    plusMenu.style.opacity = '0';
    _flushStyle(plusMenu);
  }

  /* Resuming retargets from the current in-flight value: no pop */
  plusMenu.style.transition = PLUS_OPEN_TRANSITION;
  plusMenu.style.transform = PLUS_SHOWN;
  plusMenu.style.opacity = '1';

  _watchPlusTransition(token, _finishPlusOpen, PLUS_OPEN_MS);
}

function closePlusMenu() {
  if (!_plusOpen || !plusMenu || !plusBackdrop) return;

  _cancelPlusAnimation();

  _plusOpen = false;
  plusBackdrop.classList.remove('open');

  const token = _plusAnimationToken;

  if (_prefersReducedMotion) {
    _finishPlusClose(token);
    return;
  }

  /* Closing menu must not take taps */
  plusMenu.style.pointerEvents = 'none';
  plusMenu.style.transition = PLUS_CLOSE_TRANSITION;
  plusMenu.style.transform = PLUS_HIDDEN;
  plusMenu.style.opacity = '0';

  _watchPlusTransition(token, _finishPlusClose, PLUS_CLOSE_MS);
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

/* Outside tap */
if (plusMenu || plusBtn) {
  document.addEventListener('click', (e) => {
    if (!_plusOpen) return;

    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    if (plusMenu?.contains(target) || plusBtn?.contains(target)) return;

    closePlusMenu();
  });
}

/* Escape */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _plusOpen) {
    closePlusMenu();
  }
});

['pmPhoto', 'pmCamera', 'pmFile', 'pmLocation'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', closePlusMenu);
});

/* ════════════════════════════════
   CONTENT TRANSITION
   ════════════════════════════════ */

function _clearContentAnimation() {
  if (_contentFallback) {
    _contentFallback.cancel();
    _contentFallback = null;
  }

  if (!_contentAnimations.length) return;

  const list = _contentAnimations;
  _contentAnimations = [];

  list.forEach((anim) => {
    anim.onfinish = anim.oncancel = null;
    anim.cancel();
  });
}

function _animateContentIn() {
  if (!pageContent) return;

  _clearContentAnimation();

  if (_prefersReducedMotion || pageContent.style.display === 'none') return;

  if (typeof pageContent.animate !== 'function') {
    _contentFallback = _cssEnter(pageContent, 8, 280, 220, EASE.contentSwap, () => {
      _contentFallback = null;
    });
    return;
  }

  const track = (anim) => {
    anim.onfinish = anim.oncancel = () => {
      const i = _contentAnimations.indexOf(anim);
      if (i !== -1) _contentAnimations.splice(i, 1);
    };
    return anim;
  };

  /* 'backwards' fill: start state applies immediately, nothing is held after the end */
  _contentAnimations = [
    track(pageContent.animate(
      [{ transform: 'translateY(8px)' }, { transform: 'translateY(0)' }],
      { duration: 280, easing: EASE.contentSwap, fill: 'backwards' }
    )),
    track(pageContent.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 220, easing: 'ease-out', fill: 'backwards' }
    ))
  ];
}

/* ════════════════════════════════
   TAB BAR — race-safe content swap
   ════════════════════════════════ */

async function _loadTab(key, requestId = null) {
  if (!pageContent) return;

  /* Public calls keep the historical behavior; internal calls also require the tab to stay selected */
  const internalRequest = requestId !== null;
  if (requestId === null) {
    requestId = _nextTabLoadRequestId();
  }

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
    if (typeof initFn === 'function' && isActiveRequest()) {
      initFn();
    }
    return;
  }

  pageContent.innerHTML =
    '<div class="tab-skeleton">' +
      '<div class="sk-line"></div>' +
      '<div class="sk-line sk-short"></div>' +
      '<div class="sk-line"></div>' +
    '</div>';

  try {
    const cssReady = _loadModuleCSS(key);

    if (!_moduleLoadPromises[key]) {
      _moduleLoadPromises[key] = _loadScript(`modules/${key}/${key}.js`)
        .then(() => {
          _moduleCache[key] = true;
          return true;
        })
        .catch((error) => {
          delete _moduleLoadPromises[key];
          throw error;
        });
    }

    /* Styles settle with the script so the entrance never plays on unstyled content */
    await Promise.all([_moduleLoadPromises[key], cssReady]);

    if (!_isCurrentTabRequest(key, requestId)) return;
  } catch (_) {
    if (_isCurrentTabRequest(key, requestId)) {
      pageContent.innerHTML = '<div class="tab-empty"><p>Coming soon</p></div>';
    }
  }
}

/* Resolves on load or error: a missing stylesheet must not block the tab */
function _loadModuleCSS(key) {
  if (_cssPromises[key]) return _cssPromises[key];

  const id = `_atkyn_css_${key}`;

  if (document.getElementById(id)) {
    _cssPromises[key] = Promise.resolve();
    return _cssPromises[key];
  }

  _cssPromises[key] = new Promise((resolve) => {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `modules/${key}/${key}.css`;

    link.onload = link.onerror = () => {
      link.onload = link.onerror = null;
      resolve();
    };

    document.head.appendChild(link);
  });

  return _cssPromises[key];
}

function _loadScript(src) {
  if (_scriptLoadPromises[src]) return _scriptLoadPromises[src];

  _scriptLoadPromises[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;

    const cleanup = () => {
      s.onload = null;
      s.onerror = null;
    };

    s.onload = () => {
      cleanup();
      resolve();
    };

    s.onerror = (error) => {
      cleanup();
      delete _scriptLoadPromises[src];
      if (s.parentNode) s.parentNode.removeChild(s);
      reject(error);
    };

    document.head.appendChild(s);
  });

  return _scriptLoadPromises[src];
}

let _activeTabEl = tabBar ? tabBar.querySelector('.tab.active') : null;

if (tabBar) {
  tabBar.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const tab = target ? target.closest('.tab') : null;

    if (!tab || tab.classList.contains('active')) return;

    const key = tab.getAttribute('data-tab');
    if (!key) return;

    const requestId = _nextTabLoadRequestId();

    /* Scroll position is captured now; serialization runs off the click path */
    if (_currentTabKey === 'ai') _queueChatSave();

    _clearContentAnimation();

    if (_activeTabEl) _activeTabEl.classList.remove('active');
    tab.classList.add('active');

    _activeTabEl = tab;
    _currentTabKey = key;

    let q = '';
    try {
      q = sessionStorage.getItem('atkyn_last_query') || '';
    } catch (_) {}

    if (key === 'ai') {
      if (input) input.value = '';

      if (pill) {
        pill.classList.remove('has-text');
        pill.classList.remove('non-ai-tab');
      }

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

    /* Instant scroll reset; smooth scrolling here would queue bouncing animations */
    if (scrollHost) {
      _cancelMessageScroll();
      _setScrollOwner('tab', true);
      scrollHost.scrollTop = 0;
      _lastScrollY = 0;
      resetScrollAccum();

      if (_tabScrollRafId) cancelAnimationFrame(_tabScrollRafId);

      _tabScrollRafId = requestAnimationFrame(() => {
        _tabScrollRafId = 0;
        _setScrollOwner('tab', false);
        if (scrollHost) _lastScrollY = scrollHost.scrollTop;
      });
    }

    if (logoHeader && _isLogoCollapsed) {
      logoHeader.classList.remove('collapsed');
      _isLogoCollapsed = false;
    }

    if (tabBar && _isTabHidden) {
      tabBar.classList.remove('hide');
      _isTabHidden = false;
    }

    if (tabBar && _isTabScrolled) {
      tabBar.classList.remove('scrolled');
      _isTabScrolled = false;
    }

    await _loadTab(key, requestId);

    if (!_isCurrentTabRequest(key, requestId)) return;

    if (key === 'ai') {
      _clearContentAnimation();
    } else {
      _animateContentIn();
    }
  }, { passive: true });
}

/* ── Public API ── */
window._atkynModuleCache = _moduleCache;
window._atkynPageContent = pageContent;
window._atkynAnimateIn = _animateContentIn;
window._atkynLoadTab = _loadTab;
