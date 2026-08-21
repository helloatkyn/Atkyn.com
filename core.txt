/* ═══════════════════════════════════════════════════════════════════
   core.js — Atkyn shared UI logic  [PRODUCTION READY · PERF-OPT v2]
   scroll · header animation · keyboard positioning
   chatbar entrance · plus menu · tab navigation (instant, NO reload)

   Tab switching: swaps #pageContent div only — zero page reload
   Modules: modules/{key}/{key}.js + modules/{key}/{key}.css
   ═══════════════════════════════════════════════════════════════════ */

/* ── Reduced-motion flag (MediaQueryList, queried once) ── */
const _prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Easing constants (unchanged) ── */
const EASE = {
  keyboardUp:   'cubic-bezier(0.32, 0.72, 0, 1)',
  keyboardDown: 'cubic-bezier(0.32, 0.72, 0, 1)',
  headerHide:   'cubic-bezier(0.4, 0, 1, 1)',
  headerShow:   'cubic-bezier(0, 0, 0.2, 1)',
  chatbarEnter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  menuOpen:     'cubic-bezier(0.34, 1.56, 0.64, 1)',
  menuClose:    'cubic-bezier(0.4, 0, 1, 1)',
  contentSwap:  'cubic-bezier(0.16, 1, 0.3, 1)',
};

/* ── Stable DOM references — queried ONCE, never inside hot paths ── */
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

/* ── SVG constants (string-literal, allocation-free at runtime) ── */
const SVG_SEND  = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="4"/><polyline points="5 11 12 4 19 11"/></svg>`;
const SVG_CROSS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

/* ── Scroll / header state ── */
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

/* ── Velocity EMA (exponential moving average) ── */
let _velocityEMA    = 0;
let _lastScrollTime = 0;
const VELOCITY_ALPHA = 0.3;

/* ── Keyboard / viewport state ── */
let _cleanupRafId = 0;
let _stableKbH    = 0;
let _kbAnimFrame  = null;
let _vvpDebounce  = 0;

/* ── Spacer guard (prevents identical writes) ── */
let _lastSpacerH = -1;

/* ── Public: last user message element for scroll anchoring ── */
window._lastUserMsgEl = null;

/* ── Current active tab key (resolved from DOM once at boot) ── */
let _currentTabKey = (() => {
  const a = tabBar.querySelector('.tab.active');
  return a ? a.getAttribute('data-tab') : 'ai';
})();

/* ── Module cache (key → true once loaded) ── */
const _moduleCache = {};

/* ── msgWrap reference for sessionStorage preservation ── */
const _msgWrap = document.getElementById('msgWrap');

/* ════════════════════════════════════
   HELPERS
   ════════════════════════════════════ */

function resetScrollAccum() {
  _accumDown = _accumUp = _velocityEMA = _lastScrollTime = 0;
}

/* ════════════════════════════════════
   SEND BUTTON MODE
   ════════════════════════════════════ */

/*
 * PERF: _setSendMode only writes innerHTML when the mode actually differs
 * from the current DOM state. Avoids two innerHTML writes + layout invalidation
 * on repeated calls with the same mode (e.g. input event firing while keyboard
 * is still animating).
 *
 * We track the current mode in a module-scoped variable — O(1) comparison,
 * no DOM read required.
 */
let _sendMode = 'send'; // 'send' | 'cross'

function _setSendMode(mode) {
  if (mode === _sendMode) return; // guard: no-op if already in this mode
  _sendMode = mode;
  if (mode === 'cross') {
    sendBtn.innerHTML = SVG_CROSS;
    sendBtn.classList.add('cross-mode');
  } else {
    sendBtn.innerHTML = SVG_SEND;
    sendBtn.classList.remove('cross-mode');
  }
}

sendBtn.addEventListener('click', () => {
  if (pill.classList.contains('non-ai-tab')) {
    input.value = '';
    pill.classList.remove('has-text');
    _setSendMode('send');
  }
});

/* ════════════════════════════════════
   SCROLL TO MSG
   ════════════════════════════════════ */

/*
 * PERF: tabBar.offsetHeight is cached inside the RAF callback.
 * Only one RAF is ever pending at a time (cancel-then-schedule).
 * _programmaticScroll is cleared synchronously in reduced-motion path
 * and after a 400 ms timeout in smooth path — unchanged behavior.
 */
function scrollToMsg(el) {
  if (!el) return;
  if (_scrollRafId !== null) cancelAnimationFrame(_scrollRafId);
  _scrollRafId = requestAnimationFrame(() => {
    _scrollRafId        = null;
    _programmaticScroll = true;
    // Read layout once inside RAF (after any pending style flushes)
    const target = Math.max(0, el.offsetTop - tabBar.offsetHeight - 8);
    if (_prefersReducedMotion) {
      scrollHost.scrollTop = target;
      _lastScrollY = target;
      resetScrollAccum();
      _programmaticScroll = false;
    } else {
      scrollHost.scrollTo({ top: target, behavior: 'smooth' });
      _lastScrollY = target;
      resetScrollAccum();
      setTimeout(() => { _programmaticScroll = false; }, 400);
    }
  });
}
window.scrollToMsg = scrollToMsg;

/* ════════════════════════════════════
   CHATBAR / KEYBOARD POSITIONING
   ════════════════════════════════════ */

/*
 * PERF: _setSpacerHeight is called from both _barResizeObserver and
 * _applyViewport. The _lastSpacerH guard prevents identical style writes
 * (and therefore layout invalidation + possible compositor rasterisation)
 * on every observer tick. Spacer element is looked up once per write;
 * if performance profiling showed it was hot, we could cache it, but it is
 * not in the scroll hot-path.
 */
function _setSpacerHeight(h) {
  if (h === _lastSpacerH) return;
  _lastSpacerH = h;
  const spacer = document.getElementById('chatSpacer');
  if (spacer) spacer.style.height = h + 'px';
}

/*
 * PERF: ResizeObserver — takes the LAST entry only (avoids processing
 * superseded intermediate measurements), reads borderBoxSize with
 * contentRect fallback. No DOM writes until _setSpacerHeight confirms a
 * change. No feedback loop: writing spacer height does not affect
 * chatbarWrap's own dimensions.
 */
const _barResizeObserver = new ResizeObserver((entries) => {
  const entry = entries[entries.length - 1];
  const barH  = entry.borderBoxSize
    ? entry.borderBoxSize[0].blockSize
    : entry.contentRect.height;
  _setSpacerHeight(barH + _stableKbH);
});
_barResizeObserver.observe(chatbarWrap);

/* ── Chatbar entrance animation (runs once at boot) ──────────────── */
(function _chatbarEntrance() {
  if (_prefersReducedMotion) return;
  /*
   * PERF: Use cssText for batched initial style write (single style
   * recalc). Force a style flush via getBoundingClientRect() before
   * scheduling the RAF so the browser registers the start state.
   * will-change is removed via cssText='' in the transitionend callback
   * (limits compositor layer lifetime to the animation duration only).
   */
  chatbarWrap.style.cssText = 'will-change:transform,opacity;transition:none;transform:translateY(24px) translateZ(0);opacity:0';
  chatbarWrap.getBoundingClientRect(); // force style flush — intentional
  requestAnimationFrame(() => {
    chatbarWrap.style.transition = `transform 0.45s ${EASE.chatbarEnter}, opacity 0.35s ease-out`;
    chatbarWrap.style.transform  = 'translateY(0) translateZ(0)';
    chatbarWrap.style.opacity    = '1';
    chatbarWrap.addEventListener('transitionend', function _onEntry(e) {
      if (e.propertyName !== 'transform') return;
      chatbarWrap.removeEventListener('transitionend', _onEntry);
      chatbarWrap.style.cssText = ''; // remove will-change after animation
    });
  });
}());

/* ── Keyboard / VisualViewport positioning ───────────────────────── */

/*
 * _applyViewport: the core keyboard-positioning logic.
 *
 * PERF improvements vs. original:
 *   1. Single forced layout read (chatbarWrap.offsetHeight) placed AFTER
 *      the early-exit guard — so the common case (kbHeight unchanged)
 *      exits without any layout reads at all.
 *   2. No extra RAF introduced. The outer fixViewport() already gates on
 *      a single RAF via _vvpDebounce, so _applyViewport always runs
 *      inside a RAF callback — writes here are batched with the frame.
 *   3. _kbAnimFrame cancelation is preserved to prevent the
 *      transition-clear setTimeout from firing against a stale kbHeight.
 *   4. Scroll after keyboard open is a synchronous scrollTop write (no
 *      smooth), which is correct: we want instant repositioning to avoid
 *      content being hidden behind the keyboard during its animation.
 *   5. The cleanup RAF (reset _programmaticScroll) is unchanged — it
 *      must run AFTER the synchronous scroll write to let the scroll
 *      event handler see _programmaticScroll=true for that one tick.
 */
function _applyViewport() {
  _vvpDebounce = 0;
  const vvp = window.visualViewport;
  if (!vvp) return;

  const rawKb    = Math.max(0, window.innerHeight - vvp.height - vvp.offsetTop);
  const kbHeight = rawKb > 50 ? Math.round(rawKb) : 0;

  // Early exit — most common case during normal scroll with keyboard open
  if (kbHeight === _stableKbH) return;

  _stableKbH    = kbHeight;
  _keyboardOpen = kbHeight > 0;

  if (_kbAnimFrame) { cancelAnimationFrame(_kbAnimFrame); _kbAnimFrame = null; }

  // Read layout AFTER early-exit guard so the common case never pays this cost
  const barH     = chatbarWrap.offsetHeight;
  const transform = kbHeight > 0 ? `translateY(-${kbHeight}px) translateZ(0)` : 'translateZ(0)';

  if (_prefersReducedMotion) {
    chatbarWrap.style.transition = 'none';
    chatbarWrap.style.transform  = transform;
  } else {
    const dur  = kbHeight > 0 ? '0.35s' : '0.28s';
    const ease = kbHeight > 0 ? EASE.keyboardUp : EASE.keyboardDown;
    chatbarWrap.style.transition = `transform ${dur} ${ease}`;
    chatbarWrap.style.transform  = transform;
    // Clear the transition after it completes, but only if kbHeight hasn't
    // changed again (guard against rapid open/close).
    const capturedKbH = kbHeight;
    _kbAnimFrame = requestAnimationFrame(() => {
      _kbAnimFrame = null;
      setTimeout(() => {
        if (_stableKbH === capturedKbH) chatbarWrap.style.transition = '';
      }, 380);
    });
  }

  // Batch spacer write with the transform write (both compositor-friendly)
  _setSpacerHeight(barH + kbHeight);

  if (kbHeight > 0) {
    _programmaticScroll = true;
    const anchor = window._lastUserMsgEl;
    // Synchronous scroll: instant repositioning during keyboard open
    scrollHost.scrollTop = anchor
      ? Math.max(0, anchor.offsetTop - 16)
      : scrollHost.scrollHeight;
  }

  // Reset programmatic flag after the current frame so the scroll handler
  // sees it as true for this tick, then clears for subsequent user scrolls.
  cancelAnimationFrame(_cleanupRafId);
  _cleanupRafId = requestAnimationFrame(() => {
    _cleanupRafId = 0;
    _lastScrollY  = scrollHost.scrollTop;
    resetScrollAccum();
    _programmaticScroll = false;
  });
}

/*
 * fixViewport: RAF-debounces _applyViewport.
 * Coalesces rapid visualViewport resize+scroll events into a single
 * _applyViewport call per frame.
 */
function fixViewport() {
  if (_vvpDebounce) return;
  _vvpDebounce = requestAnimationFrame(_applyViewport);
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', fixViewport, { passive: true });
  window.visualViewport.addEventListener('scroll', fixViewport, { passive: true });
  // Set initial spacer height synchronously before first frame
  _setSpacerHeight(chatbarWrap.offsetHeight);
  _applyViewport();
} else {
  // Legacy fallback for browsers without VisualViewport API
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

/*
 * updateHeader — runs inside a RAF callback (scheduled by scroll handler).
 *
 * PERF notes:
 *   1. Single scrollTop read at top (cached to local `sy`).
 *   2. Early exit on delta === 0 (no movement since last frame).
 *   3. Early exit on _programmaticScroll (no header mutation needed).
 *   4. classList operations are guarded by boolean flags (_isLogoCollapsed,
 *      _isTabHidden, _isTabScrolled) — prevents redundant classList.add/remove
 *      calls which would otherwise force a style recalc each time.
 *   5. performance.now() is only called when delta !== 0 (avoids cost in
 *      the common rapid-fire frame case where position hasn't changed).
 *   6. Velocity EMA uses max(1, dt) to prevent division by near-zero on
 *      high-refresh-rate displays (120 Hz → ~8 ms frames). The EMA
 *      smooths out per-frame noise without being unstable.
 *   7. _accumDown/_accumUp cross-zero reset (if(_accumUp > 0) _accumUp = 0)
 *      prevents direction hysteresis from stale accumulator values.
 */
function updateHeader() {
  _rafPending = false;

  // Programmatic scroll in progress: reset accumulators and exit
  if (_programmaticScroll) {
    _lastScrollY = scrollHost.scrollTop;
    resetScrollAccum();
    return;
  }

  const sy    = scrollHost.scrollTop;
  const delta = sy - _lastScrollY;
  if (delta === 0) return; // no movement — skip performance.now() call

  const now = performance.now();
  const dt  = Math.max(1, now - _lastScrollTime); // guard against 0 on first tick
  _velocityEMA = _velocityEMA === 0
    ? delta / dt
    : _velocityEMA * (1 - VELOCITY_ALPHA) + (delta / dt) * VELOCITY_ALPHA;

  _lastScrollY    = sy;
  _lastScrollTime = now;

  // ── Top-of-page reset ────────────────────────────────────────────
  if (sy <= LOGO_THRESH) {
    resetScrollAccum();
    if (_isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
    if (_isTabHidden)     { tabBar.classList.remove('hide');          _isTabHidden      = false; }
    if (_isTabScrolled)   { tabBar.classList.remove('scrolled');      _isTabScrolled    = false; }
    return;
  }

  // ── Past threshold: logo always collapsed, tab marked scrolled ───
  if (!_isLogoCollapsed) { logoHeader.classList.add('collapsed'); _isLogoCollapsed = true;  }
  if (!_isTabScrolled)   { tabBar.classList.add('scrolled');      _isTabScrolled    = true; }

  // ── Tab hide/show via accumulation + velocity gate ────────────────
  if (_velocityEMA > 0.05) {
    _accumDown += delta;
    if (_accumUp > 0) _accumUp = 0; // cross-zero reset
    if (!_isTabHidden && _accumDown >= HIDE_ACCUM) {
      tabBar.classList.add('hide');
      _isTabHidden = true;
      _accumDown   = 0;
    }
  } else if (_velocityEMA < -0.05) {
    _accumUp += -delta;
    if (_accumDown > 0) _accumDown = 0; // cross-zero reset
    if (_isTabHidden && _accumUp >= SHOW_ACCUM) {
      tabBar.classList.remove('hide');
      _isTabHidden = false;
      _accumUp     = 0;
    }
  }
}

/*
 * Scroll listener: passive (never calls preventDefault), single RAF
 * gate. At most one updateHeader() call is in flight per frame.
 */
scrollHost.addEventListener('scroll', () => {
  if (!_rafPending) { _rafPending = true; requestAnimationFrame(updateHeader); }
}, { passive: true });

/* ════════════════════════════════════
   INPUT & PILL
   ════════════════════════════════════ */

/*
 * pointerdown on pill: focus input on tap.
 * passive: false required for e.preventDefault() to suppress ghost click.
 */
pill.addEventListener('pointerdown', (e) => {
  if (e.target !== pill && e.target !== input &&
      e.target.closest('button, .overlay-input-wrap')) return;
  if (document.activeElement === input || _keyboardOpen) return;
  e.preventDefault();
  requestAnimationFrame(() => { input.focus(); });
}, { passive: false });

/*
 * input event: update pill state and send button mode.
 * PERF: _setSendMode now guards against no-op calls internally.
 */
input.addEventListener('input', () => {
  const hasText = input.value.trim().length > 0;
  pill.classList.toggle('has-text', hasText);
  if (pill.classList.contains('non-ai-tab')) {
    _setSendMode(hasText ? 'cross' : 'send');
  }
});

/* ════════════════════════════════════
   PLUS MENU
   ════════════════════════════════════ */

/*
 * openPlusMenu
 *
 * PERF / BUG FIX: The original code set `plusMenu.style.bottom` then
 * immediately overwrote it with `plusMenu.style.cssText = ...`, which
 * silently discarded the `bottom` value. Fixed by setting bottom
 * separately after the cssText batch write, then force-flushing once.
 *
 * Animation uses compositor-only properties (transform, opacity).
 * will-change is NOT set here (menu opens rarely; GPU layer cost not
 * justified for an occasional interaction).
 */
function openPlusMenu() {
  const rect  = plusBtn.getBoundingClientRect();
  const vvp   = window.visualViewport;
  const viewH = vvp ? vvp.height : window.innerHeight;
  const bottom = (viewH - rect.top + 8) + 'px';

  _plusOpen = true;
  plusBackdrop.classList.add('open');

  if (_prefersReducedMotion) {
    plusMenu.style.bottom = bottom;
    plusMenu.classList.add('open');
    return;
  }

  // Batch initial state write: scale + opacity start values
  plusMenu.style.cssText = `bottom:${bottom};transition:none;transform:scale(0.88) translateY(10px);opacity:0`;
  plusMenu.getBoundingClientRect(); // force flush so browser registers start state
  plusMenu.classList.add('open');
  requestAnimationFrame(() => {
    plusMenu.style.transition = `transform 0.3s ${EASE.menuOpen}, opacity 0.2s ease-out`;
    plusMenu.style.transform  = 'scale(1) translateY(0)';
    plusMenu.style.opacity    = '1';
    plusMenu.addEventListener('transitionend', function _onOpen(e) {
      if (e.propertyName !== 'opacity') return;
      plusMenu.removeEventListener('transitionend', _onOpen);
      // Clear inline styles but preserve bottom (set via CSS class .open)
      plusMenu.style.transition = plusMenu.style.transform = plusMenu.style.opacity = '';
    });
  });
}

function closePlusMenu() {
  if (!_plusOpen) return;
  _plusOpen = false;
  plusBackdrop.classList.remove('open');

  if (_prefersReducedMotion) { plusMenu.classList.remove('open'); return; }

  plusMenu.style.transition = `transform 0.22s ${EASE.menuClose}, opacity 0.18s ease-in`;
  plusMenu.style.transform  = 'scale(0.88) translateY(10px)';
  plusMenu.style.opacity    = '0';
  plusMenu.addEventListener('transitionend', function _onClose(e) {
    if (e.propertyName !== 'opacity') return;
    plusMenu.removeEventListener('transitionend', _onClose);
    plusMenu.classList.remove('open');
    plusMenu.style.cssText = '';
  });
}

plusBtn.addEventListener('click', (e) => { e.stopPropagation(); _plusOpen ? closePlusMenu() : openPlusMenu(); });
plusBackdrop.addEventListener('click', closePlusMenu);

['pmPhoto', 'pmCamera', 'pmFile', 'pmLocation'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', closePlusMenu);
});

/* ════════════════════════════════════
   TAB BAR — instant content swap
   Modules live in modules/{key}/{key}.js + modules/{key}/{key}.css
   ════════════════════════════════════ */

/*
 * _loadTab
 *
 * PERF: Module caching via _moduleCache[key] prevents duplicate script
 * loading. CSS guard via document.getElementById(id) prevents duplicate
 * <link> injection. Both checks are O(1).
 *
 * Skeleton is shown only on first load (before cache hit). Subsequent
 * tab switches to a cached module are instant.
 */
async function _loadTab(key) {
  const chatArea = document.getElementById('chatArea');

  if (key === 'ai') {
    if (chatArea) chatArea.style.display = '';
    pageContent.style.display = 'none';
    return;
  }

  if (chatArea) chatArea.style.display = 'none';
  pageContent.style.display = '';

  if (_moduleCache[key]) {
    // Module already loaded: re-init if the module exported an init function
    if (window[`_atkynInit_${key}`]) window[`_atkynInit_${key}`]();
    return;
  }

  // First load: show skeleton while fetching
  pageContent.innerHTML = `<div class="tab-skeleton"><div class="sk-line"></div><div class="sk-line sk-short"></div><div class="sk-line"></div></div>`;

  try {
    _loadModuleCSS(key);              // non-blocking — browser fetches in parallel
    await _loadScript(`modules/${key}/${key}.js`);
    _moduleCache[key] = true;
  } catch (_) {
    pageContent.innerHTML = `<div class="tab-empty"><p>Coming soon</p></div>`;
  }
}

/*
 * _loadModuleCSS: injects a <link> exactly once per key.
 * Guard: document.getElementById(id) — O(1) lookup.
 */
function _loadModuleCSS(key) {
  const id = `_atkyn_css_${key}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id   = id;
  link.rel  = 'stylesheet';
  link.href = `modules/${key}/${key}.css`;
  document.head.appendChild(link);
}

/*
 * _loadScript: promise-wrapped dynamic <script> injection.
 * No duplicate-load protection needed here — _moduleCache gates entry.
 */
function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s   = document.createElement('script');
    s.src     = src;
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/*
 * _animateContentIn: fade + translate pageContent into view.
 * Uses opacity + transform only (compositor-friendly).
 * getBoundingClientRect() forces a style flush so the 'none' transition
 * is registered before we set the animated transition.
 */
function _animateContentIn() {
  if (_prefersReducedMotion) return;
  pageContent.style.opacity    = '0';
  pageContent.style.transform  = 'translateY(8px)';
  pageContent.style.transition = 'none';
  pageContent.getBoundingClientRect(); // flush — intentional
  pageContent.style.transition = `opacity 0.22s ease-out, transform 0.28s ${EASE.contentSwap}`;
  pageContent.style.opacity    = '1';
  pageContent.style.transform  = 'translateY(0)';
}

/*
 * Tab click handler
 *
 * PERF: querySelectorAll + forEach to remove 'active' replaced with a
 * targeted approach: track the previously-active tab element and toggle
 * only those two elements instead of iterating all tabs.
 *
 * passive: true is safe here — no preventDefault is called.
 *
 * Header / accumulator reset on tab switch prevents stale velocity from
 * the previous scroll context carrying into the new tab.
 */
let _activeTabEl = tabBar.querySelector('.tab.active'); // track active element

tabBar.addEventListener('click', async e => {
  const tab = e.target.closest('.tab');
  if (!tab || tab.classList.contains('active')) return;

  const key = tab.getAttribute('data-tab');

  // Persist AI tab chat state before switching away from it
  if (_currentTabKey === 'ai' && _msgWrap) {
    sessionStorage.setItem('atkyn_chat_html',   _msgWrap.innerHTML);
    sessionStorage.setItem('atkyn_chat_scroll',  String(scrollHost.scrollTop));
  }

  // Toggle active class: O(1) — only touch two elements
  if (_activeTabEl) _activeTabEl.classList.remove('active');
  tab.classList.add('active');
  _activeTabEl = tab;
  _currentTabKey = key;

  const q = sessionStorage.getItem('atkyn_last_query') || '';
  if (key === 'ai') {
    input.value = '';
    pill.classList.remove('has-text');
    pill.classList.remove('non-ai-tab');
    _setSendMode('send');
  } else {
    pill.classList.add('non-ai-tab');
    if (q) {
      input.value = q;
      pill.classList.add('has-text');
      _setSendMode('cross');
    } else {
      _setSendMode('send');
    }
  }

  // Scroll to top and reset header state
  scrollHost.scrollTo({ top: 0, behavior: _prefersReducedMotion ? 'auto' : 'smooth' });
  resetScrollAccum();

  if (_isLogoCollapsed) { logoHeader.classList.remove('collapsed'); _isLogoCollapsed = false; }
  if (_isTabHidden)     { tabBar.classList.remove('hide');          _isTabHidden      = false; }
  if (_isTabScrolled)   { tabBar.classList.remove('scrolled');      _isTabScrolled    = false; }

  await _loadTab(key);
  _animateContentIn();

}, { passive: true });

/* ── Public API — must remain fully compatible ── */
window._atkynModuleCache  = _moduleCache;
window._atkynPageContent  = pageContent;
window._atkynAnimateIn    = _animateContentIn;
window._atkynLoadTab      = _loadTab;
