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
  ===== PART 3/5 =====
/* ════════════════════════════════
WEB RESULT CARDS
════════════════════════════════ */
function _buildWebCard(r) {
  let hostname = r.url;
  let pathname = r.url;
  try {
    const u = new URL(r.url);
    hostname = u.hostname.replace(/^www\./, '');
    pathname = u.hostname.replace(/^www\./, '') + u.pathname;
  } catch (_) {}
  const href = safeLinkUrl(r.url);
  const faviconSrc      = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`;
  const faviconFallback = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostname)}.ico`;
  const thumbHtml = r.image
    ? `<img class="web-card-thumb"
             src="${escapeHtml(r.image)}"
             width="92" height="92"
             loading="lazy"
             decoding="async"
             alt=""
             onerror="this.remove()">`
    : '';
  const a = document.createElement('a');
  a.className = 'web-card';
  a.href      = escapeHtml(href);
  a.target    = '_blank';
  a.rel       = 'noopener noreferrer';
  a.innerHTML = `
<div class="web-card-body">
  <div class="web-card-text">
    <div class="web-card-title">${escapeHtml(r.title)}</div>
    <div class="web-card-snippet">${escapeHtml(r.snippet)}</div>
  </div>
  ${thumbHtml}
</div>
<div class="web-card-meta">
  <div class="web-card-favicon-wrap">
    <img class="web-card-favicon"
         src="${escapeHtml(faviconSrc)}"
         width="16" height="16"
         loading="lazy"
         decoding="async"
         alt=""
         onerror="this.src='${escapeHtml(faviconFallback)}';this.onerror=function(){this.closest('.web-card-favicon-wrap').style.display='none'}">
  </div>
  <span class="web-card-domain">${escapeHtml(hostname)}</span>
  <span class="web-card-sep">•</span>
  <span class="web-card-url-text">${escapeHtml(pathname)}</span>
  <span class="web-card-dots" aria-hidden="true">
    <svg viewBox="0 0 4 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="2" cy="2"  r="1.5"/>
      <circle cx="2" cy="8"  r="1.5"/>
      <circle cx="2" cy="14" r="1.5"/>
    </svg>
  </span>
</div>`;
  return a;
}
function _renderWebCards(results) {
  /* ── 1. Preview strip (first 2 cards) ── */
  const previewWrap = document.createElement('div');
  previewWrap.className = 'msg bot';
  const previewOuter = document.createElement('div');
  previewOuter.className = 'web-cards-shadow-wrap';
  const previewBubble = document.createElement('div');
  previewBubble.className = 'bubble web-results-preview';
  const previewResults  = results.slice(0, 2);
  const carouselResults = results.slice(2);
  previewResults.forEach(r => previewBubble.appendChild(_buildWebCard(r)));
  previewOuter.appendChild(previewBubble);
  previewWrap.appendChild(previewOuter);
  msgWrap.appendChild(previewWrap);
  /* ── 2. Carousel (cards 3+) — stashed for later injection ── */
  if (carouselResults.length > 0) {
    const carouselOuter = document.createElement('div');
    carouselOuter.className = 'web-cards-shadow-wrap';
    const carousel = document.createElement('div');
    carousel.className = 'web-results-carousel-wrap';
    carousel.setAttribute('data-atkyn-carousel', '1');
    carouselResults.forEach(r => carousel.appendChild(_buildWebCard(r)));
    carouselOuter.appendChild(carousel);
    carouselOuter.style.display = 'none';
    msgWrap._pendingCarousel = carouselOuter;
  }
}
function _injectCarousel() {
  const carouselOuter = msgWrap._pendingCarousel;
  if (!carouselOuter) return;
  msgWrap._pendingCarousel = null;
  const carouselWrap = document.createElement('div');
  carouselWrap.className = 'msg bot';
  carouselOuter.style.display = '';
  carouselWrap.appendChild(carouselOuter);
  msgWrap.appendChild(carouselWrap);
  const track = carouselOuter.querySelector('.web-results-carousel-wrap');
  if (track) {
    carouselOuter.setAttribute('data-carousel-mask', '1');
    requestAnimationFrame(() => _initCarouselMarquee(track));
  }
}
function _initCarouselMarquee(track) {
  const START_DELAY_MS  = 1800;
  const RESUME_DELAY_MS = 2000;
  const SPEED_PX_FRAME  = 0.4;
  const originals = Array.from(track.children);
  if (originals.length === 0) return;
  originals.forEach(card => {
    const clone = card.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    clone.style.pointerEvents = 'none';
    track.appendChild(clone);
  });
  let halfWidth = 0;
  function measureHalf() {
    halfWidth = track.scrollWidth / 2;
  }
  measureHalf();
  let rafId         = 0;
  let running       = false;
  let touchActive   = false;
  let resumeTimerId = 0;
  let startTimerId  = 0;
  function tick() {
    if (!running || touchActive) { rafId = 0; return; }
    let sl = track.scrollLeft + SPEED_PX_FRAME;
    if (sl >= halfWidth) { sl -= halfWidth; }
    track.scrollLeft = sl;
    rafId = requestAnimationFrame(tick);
  }
  function startTicking() {
    if (rafId) return;
    running = true;
    rafId = requestAnimationFrame(tick);
  }
  function stopTicking() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }
  function onTouchStart() {
    touchActive = true;
    clearTimeout(resumeTimerId);
  }
  function onTouchEnd() {
    touchActive = false;
    clearTimeout(resumeTimerId);
    resumeTimerId = setTimeout(startTicking, RESUME_DELAY_MS);
  }
  track.addEventListener('touchstart',  onTouchStart, { passive: true });
  track.addEventListener('touchend',    onTouchEnd,   { passive: true });
  track.addEventListener('touchcancel', onTouchEnd,   { passive: true });
  track.addEventListener('mousedown',   onTouchStart, { passive: true });
  track.addEventListener('mouseup',     onTouchEnd,   { passive: true });
  startTimerId = setTimeout(startTicking, START_DELAY_MS);
  const io = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) {
      stopTicking();
      clearTimeout(resumeTimerId);
      clearTimeout(startTimerId);
      io.disconnect();
    }
  }, { threshold: 0 });
  io.observe(track);
}

===== END PART 3 =====
  ===== PART 4/5 =====
/* ════════════════════════════════
SSE STREAM PARSER
════════════════════════════════ */
/**
* Consume a ReadableStream as Server-Sent Events.
* Calls onResults(results[]) when an `event: results` block arrives,
* and onDelta(text) for each streamed content delta.
* Returns the full accumulated text.
*
* @param {ReadableStreamDefaultReader} reader
* @param {(results: object[]) => void} onResults
* @param {(delta: string) => void} onDelta
* @returns {Promise<string>}
*/
async function _parseSseStream(reader, onResults, onDelta) {
const decoder = new TextDecoder('utf-8', { fatal: false });
let sseBuffer = '';
let fullText  = '';
let eventType = '';
let done      = false;
while (!done) {
const chunk = await reader.read();
done = chunk.done;
sseBuffer += done
? decoder.decode()                              // flush the internal buffer
: decoder.decode(chunk.value, { stream: true });
// On the final iteration we still need to process whatever remains.
const lines = sseBuffer.split('\n');
// Keep the last (possibly incomplete) line for the next iteration,
// unless we're done — then process it too.
sseBuffer = done ? '' : lines.pop();
for (const line of lines) {
if (line.startsWith('event: ')) {
eventType = line.slice(7).trim();
continue;
}
if (!line.startsWith('data: ')) { eventType = ''; continue; }
const data = line.slice(6).trim();
if (data === '[DONE]') { done = true; break; }
if (eventType === 'results') {
try {
const results = JSON.parse(data);
if (results.length) onResults(results);
} catch (_) {}
eventType = '';
continue;
}
try {
const json  = JSON.parse(data);
const delta = json.choices?.[0]?.delta?.content || '';
if (delta) { fullText += delta; onDelta(delta); }
} catch (_) {}
}
}
return fullText;
}

===== END PART 4 =====
  ===== PART 5/5 =====
/* ════════════════════════════════
SEND / STREAM
════════════════════════════════ */
async function send() {
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  pill.classList.remove('has-text');
  addMsg('user', q);
  // Cancel any in-flight request. removeTyping() is called inside showTyping(),
  // so we don't need to call it separately here.
  if (_streamAbort) { _streamAbort.abort(); _streamAbort = null; }
  showTyping();
  pushHistory('user', q);
  _streamAbort = new AbortController();
  const activeTab = tabBar.querySelector('.tab.active')?.dataset?.tab;
  const endpoint  = '/api/chat';
  try {
    const resp = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      // Exclude the message we just pushed so the server sees prior context only.
      body:    JSON.stringify({ query: q, history: _history.slice(0, -1) }),
      signal:  _streamAbort.signal,
    });
    if (!resp.ok) {
      removeTyping();
      addMsg('bot', 'Something went wrong. Please try again.');
      _streamAbort = null;
      return;
    }
    const reader   = resp.body.getReader();
    let webCardShown = false;
    const fullText = await _parseSseStream(
      reader,
      /* onResults */ (results) => {
        if (!webCardShown) {
          removeTyping();
          _renderWebCards(results);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const lastChild = msgWrap.lastElementChild;
              if (lastChild) scrollToMsg(lastChild);
            });
          });
          showTyping();
          webCardShown = true;
        } else {
          _renderWebCards(results);
        }
      },
      /* onDelta */ () => {
        // Reserved for future live-streaming text rendering.
        // Currently we batch the full text and render after the stream ends.
      }
    );
    _streamAbort = null;
    removeTyping();
    if (fullText) {
      pushHistory('assistant', fullText);
      const botEl    = document.createElement('div');
      botEl.className = 'msg bot';
      const bubbleEl  = document.createElement('div');
      bubbleEl.className = 'bubble';
      bubbleEl.innerHTML = renderMarkdown(fullText);
      botEl.appendChild(bubbleEl);
      msgWrap.appendChild(botEl);
      appendBotActions(botEl, fullText);
      // Inject carousel BELOW the bot bubble (picks up _pendingCarousel if any).
      _injectCarousel();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { scrollToMsg(botEl); });
      });
    } else {
      // No text response — still inject any pending carousel so it isn't lost.
      _injectCarousel();
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    removeTyping();
    addMsg('bot', 'Network error. Please try again.');
    _streamAbort = null;
  }
}
/* ════════════════════════════════
URL PARAM AUTO-SEND
════════════════════════════════ */
const _qParam = new URLSearchParams(location.search).get('q');
if (_qParam) { input.value = _qParam; pill.classList.add('has-text'); send(); }

===== END PART 5 =====
  
  
