/* ═══════════════════════════════════════════════════════════════
   search.js — Atkyn Answer page only
   Chat rendering · stream handling · API · typing · copy · cards
   Requires: core.js (loaded before this)
   ═══════════════════════════════════════════════════════════════ */

/* ── DOM refs (chat-specific) ── */
const sendBtn   = document.getElementById('sendBtn');
const msgWrap   = document.getElementById('msgWrap');
const chatSpacer = document.getElementById('chatSpacer');

/* ── Chat state ── */
let _streamAbort    = null;
let _pendingCarousel = null;
let _typingEl        = null;

/* ── Conversation history: max 100 turns ── */
const MAX_HISTORY = 100;
const _history    = [];

/* ════════════════════════════════
   HELPERS
   ════════════════════════════════ */

function pushHistory(role, content) {
  _history.push({ role, content });
  if (_history.length > MAX_HISTORY) _history.splice(0, _history.length - MAX_HISTORY);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeLinkUrl(url) {
  try {
    const p = new URL(url);
    return (p.protocol === 'https:' || p.protocol === 'http:') ? url : '#';
  } catch (_) { return '#'; }
}

/* ════════════════════════════════
   TYPING INDICATOR
   ════════════════════════════════ */

function showTyping() {
  removeTyping();
  _typingEl = document.createElement('div');
  _typingEl.className = 'msg bot';
  _typingEl.innerHTML = '<div class="bubble typing"><span></span><span></span><span></span><span></span></div>';
  _typingEl.style.opacity    = '0';
  _typingEl.style.transform  = 'translateY(6px)';
  _typingEl.style.transition = 'opacity 0.22s ease-out, transform 0.22s ease-out';
  msgWrap.appendChild(_typingEl);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (_typingEl) { _typingEl.style.opacity = '1'; _typingEl.style.transform = ''; }
    });
  });
}

function removeTyping() {
  if (_typingEl) { _typingEl.remove(); _typingEl = null; }
}

/* ════════════════════════════════
   MESSAGE RENDERING
   ════════════════════════════════ */

function addMsg(role, text) {
  const d = document.createElement('div');
  d.className = `msg ${role}`;
  const html = role === 'bot' ? renderMarkdown(text) : escapeHtml(text);
  d.innerHTML = `<div class="bubble">${html}</div>`;
  d.style.opacity    = '0';
  d.style.transform  = 'translateY(6px)';
  d.style.transition = 'opacity 0.22s ease-out, transform 0.22s ease-out';
  msgWrap.appendChild(d);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { d.style.opacity = '1'; d.style.transform = ''; });
  });
  if (role === 'bot')  appendBotActions(d, text);
  if (role === 'user') { window._lastUserMsgEl = d; scrollToMsg(d); }
}

function appendBotActions(msgEl, fullText) {
  const bar = document.createElement('div');
  bar.className = 'bot-actions';

  const actions = [
    { key: 'copy',    label: 'Copy',    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' },
    { key: 'retry',   label: 'Retry',   svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>' },
    { key: 'like',    label: 'Like',    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/><path d="M7 10v12"/></svg>' },
    { key: 'dislike', label: 'Dislike', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>' },
    { key: 'refresh', label: 'Refresh', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M2.5 12a10 10 0 0 1 17.8-6.3L21.5 8"/><path d="M2.5 22v-6h6"/><path d="M21.5 12a10 10 0 0 1-17.8 6.3L2.5 16"/></svg>' },
  ];

  const btnRefs = {};
  actions.forEach(({ key, label, svg }) => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', label);
    btn.innerHTML = svg;
    btnRefs[key] = btn;
    bar.appendChild(btn);
  });

  Object.entries(btnRefs).forEach(([key, btn]) => {
    btn.addEventListener('click', () => {
      if (key === 'copy') {
        navigator.clipboard.writeText(msgEl.querySelector('.bubble')?.innerText || fullText).catch(() => {});
        btn.style.color = '#2da44e';
        setTimeout(() => { btn.style.color = ''; }, 1200);
      } else if (key === 'like') {
        btn.classList.toggle('active-like');
        btnRefs['dislike'].classList.remove('active-dislike');
      } else if (key === 'dislike') {
        btn.classList.toggle('active-dislike');
        btnRefs['like'].classList.remove('active-like');
      } else if (key === 'refresh' || key === 'retry') {
        btn.style.transition = 'transform 0.45s ease';
        btn.style.transform  = 'rotate(360deg)';
        setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 500);
      }
    });
  });

  msgEl.appendChild(bar);
}

/* ════════════════════════════════
   CODE COPY — delegated listener
   ════════════════════════════════ */

document.addEventListener('click', function(e) {
  const btn = e.target.closest('.code-copy-btn');
  if (!btn) return;
  const blockId = btn.getAttribute('data-target');
  const block   = document.getElementById(blockId);
  if (!block) return;

  const contentSpans = block.querySelectorAll('.code-line-content');
  let rawCode = '';
  contentSpans.forEach((span, i) => { rawCode += (i > 0 ? '\n' : '') + span.innerText; });
  if (!rawCode) rawCode = block.querySelector('pre')?.innerText || '';

  navigator.clipboard.writeText(rawCode).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
    }, 1800);
  }).catch(() => {});
});

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

  const href            = safeLinkUrl(r.url);
  const faviconSrc      = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`;
  const faviconFallback = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostname)}.ico`;

  const thumbHtml = r.image
    ? `<img class="web-card-thumb" src="${escapeHtml(r.image)}" width="92" height="92" loading="lazy" decoding="async" alt="" onerror="this.remove()">`
    : '';

  const a = document.createElement('a');
  a.className = 'web-card';
  a.href      = href;
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
        <img class="web-card-favicon" src="${escapeHtml(faviconSrc)}" width="16" height="16" loading="lazy" decoding="async" alt="">
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

  a.querySelector('.web-card-favicon').addEventListener('error', function() {
    if (this.src !== faviconFallback) {
      this.src = faviconFallback;
    } else {
      this.closest('.web-card-favicon-wrap').style.display = 'none';
    }
  }, { once: false, passive: true });

  return a;
}

function _renderWebCards(results) {
  const previewWrap    = document.createElement('div');
  previewWrap.className = 'msg bot';

  const previewOuter   = document.createElement('div');
  previewOuter.className = 'web-cards-shadow-wrap';

  const previewBubble  = document.createElement('div');
  previewBubble.className = 'bubble web-results-preview';

  const previewResults  = results.slice(0, 2);
  const carouselResults = results.slice(2);

  previewResults.forEach(r => previewBubble.appendChild(_buildWebCard(r)));
  previewOuter.appendChild(previewBubble);
  previewWrap.appendChild(previewOuter);
  previewWrap.style.opacity    = '0';
  previewWrap.style.transform  = 'translateY(6px)';
  previewWrap.style.transition = 'opacity 0.22s ease-out, transform 0.22s ease-out';
  msgWrap.appendChild(previewWrap);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { previewWrap.style.opacity = '1'; previewWrap.style.transform = ''; });
  });

  if (carouselResults.length > 0) {
    const carouselOuter = document.createElement('div');
    carouselOuter.className = 'web-cards-shadow-wrap';

    const carousel = document.createElement('div');
    carousel.className = 'web-results-carousel-wrap';
    carousel.setAttribute('data-atkyn-carousel', '1');

    carouselResults.forEach(r => carousel.appendChild(_buildWebCard(r)));
    carouselOuter.appendChild(carousel);
    carouselOuter.style.display = 'none';

    _pendingCarousel = carouselOuter;
  }
}

function _injectCarousel() {
  if (!_pendingCarousel) return;

  const carouselOuter = _pendingCarousel;
  _pendingCarousel = null;

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
  requestAnimationFrame(() => { halfWidth = track.scrollWidth / 2; });

  let rafId = 0, running = false, touchActive = false, resumeTimerId = 0;
  const startTimerId = setTimeout(startTicking, START_DELAY_MS);

  function tick() {
    if (!running || touchActive) { rafId = 0; return; }
    let sl = track.scrollLeft + SPEED_PX_FRAME;
    if (halfWidth > 0 && sl >= halfWidth) sl -= halfWidth;
    track.scrollLeft = sl;
    rafId = requestAnimationFrame(tick);
  }

  function startTicking() { if (rafId) return; running = true; rafId = requestAnimationFrame(tick); }
  function stopTicking()  { running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }
  function onTouchStart() { touchActive = true; clearTimeout(resumeTimerId); }
  function onTouchEnd()   { touchActive = false; clearTimeout(resumeTimerId); resumeTimerId = setTimeout(startTicking, RESUME_DELAY_MS); }

  track.addEventListener('touchstart',  onTouchStart, { passive: true });
  track.addEventListener('touchend',    onTouchEnd,   { passive: true });
  track.addEventListener('touchcancel', onTouchEnd,   { passive: true });
  track.addEventListener('mousedown',   onTouchStart, { passive: true });
  track.addEventListener('mouseup',     onTouchEnd,   { passive: true });

  const io = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) {
      stopTicking(); clearTimeout(resumeTimerId); clearTimeout(startTimerId); io.disconnect();
    }
  }, { threshold: 0 });
  io.observe(track);
}

/* ════════════════════════════════
   SSE STREAM PARSER
   ════════════════════════════════ */

async function _parseSseStream(reader, onResults, onDelta) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let sseBuffer = '', fullText = '', eventType = '', done = false;

  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    sseBuffer += done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });

    const lines = sseBuffer.split('\n');
    sseBuffer = done ? '' : lines.pop();

    for (const line of lines) {
      if (line.startsWith('event: ')) { eventType = line.slice(7).trim(); continue; }
      if (!line.startsWith('data: '))  { eventType = ''; continue; }

      const data = line.slice(6).trim();
      if (data === '[DONE]') { done = true; break; }

      if (eventType === 'results') {
        try { const r = JSON.parse(data); if (r.length) onResults(r); } catch (_) {}
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

/* ════════════════════════════════
   SEND / STREAM
   ════════════════════════════════ */

async function send() {
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  pill.classList.remove('has-text');
  /* Save query so modules (web, images, news) can use it on tab switch */
  sessionStorage.setItem('atkyn_last_query', q);
  addMsg('user', q);

  if (_streamAbort) { _streamAbort.abort(); _streamAbort = null; }
  showTyping();
  pushHistory('user', q);
  _streamAbort = new AbortController();

  try {
    const resp = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query: q, history: _history.slice(0, -1) }),
      signal:  _streamAbort.signal,
    });

    if (!resp.ok) {
      removeTyping();
      addMsg('bot', 'Something went wrong. Please try again.');
      _streamAbort = null;
      return;
    }

    const reader     = resp.body.getReader();
    let webCardShown = false;

    const fullText = await _parseSseStream(
      reader,
      (results) => {
        if (!webCardShown) {
          removeTyping();
          _renderWebCards(results);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const last = msgWrap.lastElementChild;
              if (last) scrollToMsg(last);
            });
          });
          showTyping();
          webCardShown = true;
        } else {
          _renderWebCards(results);
        }
      },
      () => {}
    );

    _streamAbort = null;
    removeTyping();

    if (fullText) {
      pushHistory('assistant', fullText);

      const botEl    = document.createElement('div');
      botEl.className = 'msg bot';
      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'bubble';
      bubbleEl.innerHTML = renderMarkdown(fullText);
      botEl.appendChild(bubbleEl);
      botEl.style.opacity    = '0';
      botEl.style.transform  = 'translateY(6px)';
      botEl.style.transition = 'opacity 0.22s ease-out, transform 0.22s ease-out';
      msgWrap.appendChild(botEl);
      appendBotActions(botEl, fullText);
      _injectCarousel();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          botEl.style.opacity   = '1';
          botEl.style.transform = '';
          scrollToMsg(botEl);
        });
      });
    } else {
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
   INPUT HANDLERS (chat-specific)
   ════════════════════════════════ */

input.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); send(); }
});

sendBtn.addEventListener('click', send);

/* ════════════════════════════════
   CHAT CACHE — sessionStorage
   Save chat HTML when leaving Answer tab.
   Restore instantly when coming back.
   ════════════════════════════════ */

const CACHE_HTML   = 'atkyn_chat_html';
const CACHE_SCROLL = 'atkyn_chat_scroll';
const CACHE_HIST   = 'atkyn_chat_history';

function _saveChat() {
  if (!msgWrap.innerHTML.trim()) return;
  try {
    sessionStorage.setItem(CACHE_HTML,   msgWrap.innerHTML);
    sessionStorage.setItem(CACHE_SCROLL, String(scrollHost.scrollTop));
    sessionStorage.setItem(CACHE_HIST,   JSON.stringify(_history));
  } catch (_) {}
}

function _restoreChat() {
  const html = sessionStorage.getItem(CACHE_HTML);
  if (!html) return false;
  try {
    msgWrap.innerHTML = html;
    const savedScroll = parseInt(sessionStorage.getItem(CACHE_SCROLL) || '0', 10);
    const savedHist   = sessionStorage.getItem(CACHE_HIST);
    if (savedHist) {
      const parsed = JSON.parse(savedHist);
      _history.push(...parsed);
    }
    /* Restore scroll after paint */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { scrollHost.scrollTop = savedScroll; });
    });
    /* Re-attach last user msg ref for keyboard scroll anchor */
    const userMsgs = msgWrap.querySelectorAll('.msg.user');
    if (userMsgs.length) window._lastUserMsgEl = userMsgs[userMsgs.length - 1];
    return true;
  } catch (_) {
    return false;
  }
}

/* Save before tab switch (core.js also calls this, belt-and-suspenders) */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') _saveChat();
});
window.addEventListener('pagehide', _saveChat);

/* ════════════════════════════════
   URL PARAM AUTO-SEND / RESTORE
   ════════════════════════════════ */

const _qParam = new URLSearchParams(location.search).get('q');
if (_qParam) {
  /* Fresh query from URL — clear any stale cache first */
  sessionStorage.removeItem(CACHE_HTML);
  sessionStorage.removeItem(CACHE_SCROLL);
  sessionStorage.removeItem(CACHE_HIST);
  input.value = _qParam;
  pill.classList.add('has-text');
  send();
} else {
  /* Try to restore cached chat (coming back from another tab) */
  _restoreChat();
}
