/* ═══════════════════════════════════════════════════════════════
search.js — Atkyn Answer page only
Chat rendering · stream handling · API · typing · copy · cards
Requires: core.js + renderer.js
═══════════════════════════════════════════════════════════════ */

/* ── DOM refs ── */
const msgWrap = document.getElementById('msgWrap');

/* ── Chat state ── */
let _streamAbort = null;
let _pendingCarousel = null;
let _typingEl = null;
let _currentSources = [];
let _isStreaming = false;

/* ── Conversation history ── */
const MAX_HISTORY = 100;
const _history = [];

/* ════════════════════════════════
HELPERS
════════════════════════════════ */
function pushHistory(role, content) {
  _history.push({ role, content });
  if (_history.length > MAX_HISTORY) {
    _history.splice(0, _history.length - MAX_HISTORY);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeLinkUrl(url) {
  try {
    const p = new URL(url);
    return (p.protocol === 'https:' || p.protocol === 'http:') ? url : '#';
  } catch (_) {
    return '#';
  }
}

function _renderContent(text) {
  if (typeof renderMarkdown === 'function') {
    return renderMarkdown(text);
  }
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function _isNearBottom(threshold = 140) {
  if (typeof scrollHost === 'undefined' || !scrollHost) return true;
  return scrollHost.scrollHeight - scrollHost.scrollTop - scrollHost.clientHeight < threshold;
}

function _maybeScroll(el, force = false) {
  if (!el) return;
  if (force || _isNearBottom()) {
    scrollToMsg(el);
  }
}

function _copyText(text) {
  if (!text) return Promise.resolve();

  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();

    try {
      document.execCommand('copy');
    } catch (_) {}

    ta.remove();
    resolve();
  });
}

/* ════════════════════════════════
TYPING INDICATOR
════════════════════════════════ */
function showTyping() {
  removeTyping();
  if (!msgWrap) return;

  _typingEl = document.createElement('div');
  _typingEl.className = 'msg bot';
  _typingEl.innerHTML = '<div class="bubble typing"><span></span><span></span><span></span><span></span></div>';

  _typingEl.style.opacity = '0';
  _typingEl.style.transform = 'translateY(6px)';
  _typingEl.style.transition = 'opacity 0.22s ease-out, transform 0.22s ease-out';

  msgWrap.appendChild(_typingEl);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (_typingEl) {
        _typingEl.style.opacity = '1';
        _typingEl.style.transform = '';
      }
    });
  });
}

function removeTyping() {
  if (_typingEl) {
    _typingEl.remove();
    _typingEl = null;
  }
}

/* ════════════════════════════════
BOT ACTIONS — delegated, restore-safe
════════════════════════════════ */
function appendBotActions(msgEl, fullText) {
  if (!msgEl || msgEl.querySelector('.bot-actions')) return;

  const bar = document.createElement('div');
  bar.className = 'bot-actions';

  const actions = [
    {
      key: 'copy', label: 'Copy',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`
    },
    {
      key: 'retry', label: 'Retry',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`
    },
    {
      key: 'like', label: 'Like',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" width="22" height="22"><path stroke-linecap="round" stroke-linejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V3a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H5.904m10.598-9.75H14.25M5.904 18.5c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 0 1-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 9.953 4.167 9.5 5 9.5h1.053c.472 0 .745.556.5.96a8.958 8.958 0 0 0-1.302 4.665c0 1.194.232 2.333.654 3.375Z"/></svg>`
    },
    {
      key: 'dislike', label: 'Dislike',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" width="22" height="22"><path stroke-linecap="round" stroke-linejoin="round" d="M7.498 15.25H4.372c-1.026 0-1.945-.694-2.054-1.715a12.137 12.137 0 0 1-.068-1.285c0-2.848.992-5.464 2.649-7.521C5.287 4.247 5.886 4 6.504 4h4.016a4.5 4.5 0 0 1 1.423.23l3.114 1.04a4.5 4.5 0 0 0 1.423.23h1.294M7.498 15.25c.618 0 .991.724.725 1.282A7.471 7.471 0 0 0 7.5 19.75 2.25 2.25 0 0 0 9.75 22a.75.75 0 0 0 .75-.75v-.633c0-.573.11-1.14.322-1.672.304-.76.93-1.33 1.653-1.715a9.04 9.04 0 0 0 2.86-2.4c.498-.634 1.226-1.08 2.032-1.08h.384m-10.253 1.5H9.7m8.075-9.75c.01.05.027.1.05.148.593 1.2.925 2.55.925 3.977 0 1.487-.36 2.89-.999 4.125m.023-8.25c-.076-.365.183-.75.575-.75h.908c.889 0 1.713.518 1.972 1.368.339 1.11.521 2.287.521 3.507 0 1.553-.295 3.036-.831 4.398-.306.774-1.086 1.227-1.918 1.227h-1.053c-.472 0-.745-.556-.5-.96a8.95 8.95 0 0 0 .303-.54"/></svg>`
    },
    {
      key: 'refresh', label: 'Refresh',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`
    }
  ];

  actions.forEach(({ key, label, svg }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('data-bot-action', key);
    btn.innerHTML = svg;
    bar.appendChild(btn);
  });

  msgEl.appendChild(bar);
}

/* ════════════════════════════════
   AI DISCLAIMER
   ════════════════════════════════ */
function appendDisclaimer(msgEl) {
  /* Remove disclaimer from all previous bot messages */
  msgWrap.querySelectorAll('.ai-disclaimer').forEach(el => el.remove());

  const disc = document.createElement('div');
  disc.className = 'ai-disclaimer';
  disc.innerHTML =
    '<img src="Logo.png" alt="Atkyn" class="ai-disclaimer-logo">' +
    '<span>Atkyn search and can make mistakes.<br>Please double-check responses.</span>';

  disc.style.opacity = '0';
  disc.style.transform = 'translateY(4px)';
  disc.style.transition = 'opacity 0.22s ease-out, transform 0.22s ease-out';

  msgEl.appendChild(disc);

  requestAnimationFrame(() => {
    disc.style.opacity = '1';
    disc.style.transform = '';
  });
}

document.addEventListener('click', function (e) {
  const btn = e.target.closest('.bot-actions button[data-bot-action]');
  if (!btn) return;

  const key = btn.getAttribute('data-bot-action');
  const msgEl = btn.closest('.msg.bot');
  const bar = btn.closest('.bot-actions');

  if (!msgEl || !bar) return;

  if (key === 'copy') {
    const bubble = msgEl.querySelector('.bubble');
    const text = bubble ? bubble.innerText : '';

    _copyText(text)
      .then(() => {
        btn.style.color = '#2da44e';
        setTimeout(() => {
          btn.style.color = '';
        }, 1200);
      })
      .catch(() => {});
  } else if (key === 'like') {
    const dislikeBtn = bar.querySelector('[data-bot-action="dislike"]');
    btn.classList.toggle('active-like');
    if (dislikeBtn) dislikeBtn.classList.remove('active-dislike');
  } else if (key === 'dislike') {
    const likeBtn = bar.querySelector('[data-bot-action="like"]');
    btn.classList.toggle('active-dislike');
    if (likeBtn) likeBtn.classList.remove('active-like');
  } else if (key === 'refresh' || key === 'retry') {
    btn.style.transition = 'transform 0.45s ease';
    btn.style.transform = 'rotate(360deg)';

    setTimeout(() => {
      btn.style.transform = '';
      btn.style.transition = '';
    }, 500);
  }
});

/* ════════════════════════════════
MESSAGE RENDERING
════════════════════════════════ */
function addMsg(role, text) {
  if (!msgWrap) return;

  const d = document.createElement('div');
  d.className = `msg ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = _renderContent(text);

  d.appendChild(bubble);

  d.style.opacity = '0';
  d.style.transform = 'translateY(6px)';
  d.style.transition = 'opacity 0.22s ease-out, transform 0.22s ease-out';

  msgWrap.appendChild(d);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      d.style.opacity = '1';
      d.style.transform = '';
    });
  });

  if (role === 'bot') {
    appendBotActions(d, text);
    appendDisclaimer(d);
  }

  if (role === 'user') {
    window._lastUserMsgEl = d;
    _maybeScroll(d, true);
  } else {
    _maybeScroll(d, false);
  }
}

/* ════════════════════════════════
CODE COPY — delegated listener
════════════════════════════════ */
document.addEventListener('click', function (e) {
  const btn = e.target.closest('.code-copy-btn');
  if (!btn) return;

  const blockId = btn.getAttribute('data-target');
  const block = document.getElementById(blockId);
  if (!block) return;

  const pre = block.querySelector('pre');
  const rawCode = pre ? pre.innerText : '';

  _copyText(rawCode)
    .then(() => {
      btn.classList.add('copied');
      btn.innerHTML = '<i class="ti ti-check"></i>';

      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '<i class="ti ti-copy"></i>';
      }, 1800);
    })
    .catch(() => {});
});

/* ════════════════════════════════
WEB RESULT CARDS
════════════════════════════════ */
function buildWebCard(r) {
  let hostname = r.url;
  let pathname = r.url;

  try {
    const u = new URL(r.url);
    hostname = u.hostname.replace(/^www\./, '');
    pathname = u.hostname.replace(/^www\./, '') + u.pathname;
  } catch (_) {}

  const href = safeLinkUrl(r.url);
  const faviconSrc = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`;
  const faviconFallback = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostname)}.ico`;

  const thumbHtml = r.image
    ? `<img class="web-card-thumb" src="${escapeHtml(r.image)}" width="92" height="92" loading="lazy" decoding="async" alt="" onerror="this.remove()">`
    : '';

  const a = document.createElement('a');
  a.className = 'web-card';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';

  a.innerHTML =
    `<div class="web-card-body">` +
      `<div class="web-card-text">` +
        `<div class="web-card-title">${escapeHtml(r.title || '')}</div>` +
        `<div class="web-card-snippet">${escapeHtml(r.snippet || '')}</div>` +
      `</div>` +
      thumbHtml +
    `</div>` +
    `<div class="web-card-meta">` +
      `<div class="web-card-favicon-wrap">` +
        `<img class="web-card-favicon" src="${escapeHtml(faviconSrc)}" width="16" height="16" loading="lazy" decoding="async" alt="">` +
      `</div>` +
      `<span class="web-card-domain">${escapeHtml(hostname)}</span>` +
      `<span class="web-card-sep">•</span>` +
      `<span class="web-card-url-text">${escapeHtml(pathname)}</span>` +
      `<span class="web-card-dots" aria-hidden="true">` +
        `<svg viewBox="0 0 4 16" xmlns="http://www.w3.org/2000/svg">` +
          `<circle cx="2" cy="2" r="1.5"/>` +
          `<circle cx="2" cy="8" r="1.5"/>` +
          `<circle cx="2" cy="14" r="1.5"/>` +
        `</svg>` +
      `</span>` +
    `</div>`;

  const favicon = a.querySelector('.web-card-favicon');

  if (favicon) {
    favicon.addEventListener('error', function () {
      if (!this.dataset.fb) {
        this.dataset.fb = '1';
        this.src = faviconFallback;
      } else {
        const wrap = this.closest('.web-card-favicon-wrap');
        if (wrap) wrap.style.display = 'none';
      }
    }, { once: false });
  }

  return a;
}

function _renderWebCards(results) {
  if (!msgWrap || !Array.isArray(results) || !results.length) return;

  const previewWrap = document.createElement('div');
  previewWrap.className = 'msg bot';

  const previewOuter = document.createElement('div');
  previewOuter.className = 'web-cards-shadow-wrap';

  const previewBubble = document.createElement('div');
  previewBubble.className = 'bubble web-results-preview';

  const previewResults = results.slice(0, 2);
  const carouselResults = results.slice(2);

  previewResults.forEach((r) => {
    previewBubble.appendChild(buildWebCard(r));
  });

  previewOuter.appendChild(previewBubble);
  previewWrap.appendChild(previewOuter);

  previewWrap.style.opacity = '0';
  previewWrap.style.transform = 'translateY(6px)';
  previewWrap.style.transition = 'opacity 0.22s ease-out, transform 0.22s ease-out';

  msgWrap.appendChild(previewWrap);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      previewWrap.style.opacity = '1';
      previewWrap.style.transform = '';
      _maybeScroll(previewWrap, false);
    });
  });

  if (carouselResults.length > 0) {
    const carouselOuter = document.createElement('div');
    carouselOuter.className = 'web-cards-shadow-wrap';
    carouselOuter.style.background = 'transparent';

    const carousel = document.createElement('div');
    carousel.className = 'web-results-carousel-wrap';
    carousel.setAttribute('data-atkyn-carousel', '1');
    carousel.style.background = 'transparent';

    carouselResults.forEach((r) => {
      carousel.appendChild(buildWebCard(r));
    });

    carouselOuter.appendChild(carousel);
    carouselOuter.style.display = 'none';

    _pendingCarousel = carouselOuter;
  }
}

function _injectCarousel() {
  if (!_pendingCarousel || !msgWrap) return;

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
    requestAnimationFrame(() => {
      _initCarouselMarquee(track);
    });
  }
}

function _initCarouselMarquee(track) {
  if (!track || track.dataset.atkynMarquee === '1') return;

  const START_DELAY_MS = 1800;
  const RESUME_DELAY_MS = 2000;
  const SPEED_PX_FRAME = 0.4;

  track.dataset.atkynMarquee = '1';

  const originals = Array.from(track.children);
  if (originals.length === 0) return;

  originals.forEach((card) => {
    const clone = card.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    clone.style.pointerEvents = 'none';
    track.appendChild(clone);
  });

  let halfWidth = 0;

  requestAnimationFrame(() => {
    halfWidth = track.scrollWidth / 2;
  });

  let rafId = 0;
  let running = false;
  let interacting = false;
  let resumeTimerId = 0;
  let startTimerId = 0;

  function tick() {
    if (!running || interacting) {
      rafId = 0;
      return;
    }

    if (!halfWidth) {
      halfWidth = track.scrollWidth / 2;
    }

    let sl = track.scrollLeft + SPEED_PX_FRAME;

    if (halfWidth > 0 && sl >= halfWidth) {
      sl -= halfWidth;
    }

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
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function scheduleStart(delay) {
    clearTimeout(startTimerId);
    startTimerId = setTimeout(startTicking, delay);
  }

  function onTouchStart() {
    interacting = true;
    clearTimeout(resumeTimerId);
    stopTicking();
  }

  function onTouchEnd() {
    interacting = false;
    clearTimeout(resumeTimerId);
    resumeTimerId = setTimeout(startTicking, RESUME_DELAY_MS);
  }

  track.addEventListener('touchstart', onTouchStart, { passive: true });
  track.addEventListener('touchend', onTouchEnd, { passive: true });
  track.addEventListener('touchcancel', onTouchEnd, { passive: true });
  track.addEventListener('mousedown', onTouchStart, { passive: true });
  track.addEventListener('mouseup', onTouchEnd, { passive: true });

  const io = new IntersectionObserver((entries) => {
    const visible = entries[0].isIntersecting;

    if (visible) {
      scheduleStart(START_DELAY_MS);
    } else {
      stopTicking();
      clearTimeout(resumeTimerId);
      clearTimeout(startTimerId);
    }
  }, { threshold: 0 });

  io.observe(track);
  scheduleStart(START_DELAY_MS);
}

/* ════════════════════════════════
STOCK CARD
════════════════════════════════ */
function _renderStockCard(data) {
  if (!msgWrap || !data) return;

  const isUp = data.change >= 0;
  const color = isUp ? '#1a9e4a' : '#d93025';
  const arrow = isUp ? '▲' : '▼';
  const changeStr = `${isUp ? '+' : ''}${Number(data.change || 0).toFixed(2)} (${isUp ? '+' : ''}${Number(data.changePct || 0).toFixed(2)}%)`;

  const wrap = document.createElement('div');
  wrap.className = 'msg bot';

  const card = document.createElement('div');
  card.className = 'stock-card';

  const header = document.createElement('div');
  header.className = 'stock-header';
  header.innerHTML =
    `<div class="stock-logo-wrap">` +
      (data.logo ? `<img class="stock-logo" src="${escapeHtml(data.logo)}" alt="" onerror="this.style.display='none'">` : '') +
    `</div>` +
    `<div class="stock-title-wrap">` +
      `<div class="stock-name">${escapeHtml(data.name || '')}</div>` +
      `<div class="stock-ticker-exchange">${escapeHtml(data.ticker || '')}${data.exchange ? ' · ' + escapeHtml(data.exchange) : ''}</div>` +
    `</div>`;

  const priceRow = document.createElement('div');
  priceRow.className = 'stock-price-row';
  priceRow.innerHTML =
    `<div class="stock-price">${data.currency === 'USD' ? '$' : ''}${Number(data.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>` +
    `<div class="stock-change" style="color:${color}">${arrow} ${changeStr}</div>`;

  const tabs = document.createElement('div');
  tabs.className = 'stock-tabs';

  const ranges = ['1D', '1W', '1M', '3M', '1Y'];

  ranges.forEach((r, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stock-tab' + (i === 0 ? ' active' : '');
    btn.textContent = r;

    btn.addEventListener('click', () => {
      tabs.querySelectorAll('.stock-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      _fetchAndUpdateChart(data.ticker, r, chartContainer, data);
    });

    tabs.appendChild(btn);
  });

  const chartContainer = document.createElement('div');
  chartContainer.className = 'stock-chart-container';

  const stats = document.createElement('div');
  stats.className = 'stock-stats';

  const statsData = [
    { label: 'Open', value: data.open ? (data.currency === 'USD' ? '$' : '') + Number(data.open).toFixed(2) : '—' },
    { label: 'High', value: data.high ? (data.currency === 'USD' ? '$' : '') + Number(data.high).toFixed(2) : '—' },
    { label: 'Low', value: data.low ? (data.currency === 'USD' ? '$' : '') + Number(data.low).toFixed(2) : '—' },
    { label: 'Prev.', value: data.prevClose ? (data.currency === 'USD' ? '$' : '') + Number(data.prevClose).toFixed(2) : '—' }
  ];

  statsData.forEach(({ label, value }) => {
    const item = document.createElement('div');
    item.className = 'stock-stat-item';
    item.innerHTML = `<span class="stock-stat-label">${label}</span><span class="stock-stat-value">${value}</span>`;
    stats.appendChild(item);
  });

  card.appendChild(header);
  card.appendChild(priceRow);
  card.appendChild(tabs);
  card.appendChild(chartContainer);
  card.appendChild(stats);

  wrap.appendChild(card);

  wrap.style.opacity = '0';
  wrap.style.transform = 'translateY(6px)';
  wrap.style.transition = 'opacity 0.22s ease-out, transform 0.22s ease-out';

  msgWrap.appendChild(wrap);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      wrap.style.opacity = '1';
      wrap.style.transform = '';

      _fetchAndUpdateChart(data.ticker, '1D', chartContainer, data);
      _maybeScroll(wrap, false);
    });
  });
}

function _resolutionFor(range) {
  switch (range) {
    case '1D': return { resolution: '5', days: 1 };
    case '1W': return { resolution: '15', days: 7 };
    case '1M': return { resolution: '60', days: 30 };
    case '3M': return { resolution: 'D', days: 90 };
    case '1Y': return { resolution: 'W', days: 365 };
    default: return { resolution: '5', days: 1 };
  }
}

async function _fetchAndUpdateChart(ticker, range, container, data) {
  if (!container) return;

  container.innerHTML = '<div class="stock-chart-loading"></div>';

  try {
    const { resolution, days } = _resolutionFor(range);
    const to = Math.floor(Date.now() / 1000);
    const fetchDays = range === '1D' ? 5 : days;
    const from = to - fetchDays * 86400;

    const resp = await fetch(`/api/stockcandle?symbol=${encodeURIComponent(ticker)}&resolution=${resolution}&from=${from}&to=${to}`);

    if (!resp.ok) throw new Error('fetch failed');

    const candle = await resp.json();

    if (candle.s !== 'ok' || !Array.isArray(candle.t)) {
      throw new Error('no data');
    }

    let series = candle.t.map((t, i) => ({
      t,
      o: candle.o[i],
      h: candle.h[i],
      l: candle.l[i],
      c: candle.c[i]
    }));

    if (range === '1D' && series.length > 0) {
      const lastTs = series[series.length - 1].t;
      const lastDay = new Date(lastTs * 1000);
      const dayKey = `${lastDay.getUTCFullYear()}-${lastDay.getUTCMonth()}-${lastDay.getUTCDate()}`;

      const filtered = series.filter((c) => {
        const d = new Date(c.t * 1000);
        return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}` === dayKey;
      });

      if (filtered.length > 0) series = filtered;
    }

    const lastPrice = series[series.length - 1]?.c ?? data.price;
    const firstPrice = series[0]?.c ?? data.prevClose;
    const up = lastPrice >= firstPrice;

    container.innerHTML = '';
    _initStockChart(container, series, up, data);
  } catch (_) {
    container.innerHTML = '';
    _initStockChart(container, data.series, data.change >= 0, data);
  }
}

function _destroyStockChart(container) {
  if (!container) return;

  if (container._stockChartRo) {
    try {
      container._stockChartRo.disconnect();
    } catch (_) {}
    delete container._stockChartRo;
  }

  if (container._stockChart) {
    try {
      container._stockChart.remove();
    } catch (_) {}
    delete container._stockChart;
  }
}

function _initStockChart(container, series, isUp, stockMeta) {
  if (!container) return;

  _destroyStockChart(container);

  const LW = window.LightweightCharts;

  if (!LW) {
    container.innerHTML = '<div class="stock-chart-nodata">Chart unavailable</div>';
    return;
  }

  if (!series || series.length === 0) {
    if (stockMeta && stockMeta.price && stockMeta.prevClose) {
      const now = Math.floor(Date.now() / 1000);
      series = [
        { t: now - 3600, c: stockMeta.prevClose },
        { t: now, c: stockMeta.price }
      ];
    } else {
      container.innerHTML = '<div class="stock-chart-nodata">No chart data</div>';
      return;
    }
  }

  const isDark = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;

  const upColor = '#1a9e4a';
  const downColor = '#d93025';
  const lineColor = isUp ? upColor : downColor;
  const topAlpha = isUp ? '0.20' : '0.18';
  const topFill = isUp ? `rgba(26,158,74,${topAlpha})` : `rgba(217,48,37,${topAlpha})`;
  const botFill = isUp ? 'rgba(26,158,74,0.00)' : 'rgba(217,48,37,0.00)';

  const chart = LW.createChart(container, {
    width: container.clientWidth || container.offsetWidth || 320,
    height: 180,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: isDark ? '#9e9e9e' : '#757575',
      fontSize: 11
    },
    grid: {
      vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
      horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }
    },
    crosshair: {
      mode: LW.CrosshairMode ? LW.CrosshairMode.Normal : 0,
      vertLine: {
        color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
        width: 1,
        style: 1
      },
      horzLine: {
        color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
        width: 1,
        style: 1
      }
    },
    rightPriceScale: {
      borderVisible: false,
      scaleMargins: { top: 0.12, bottom: 0.08 }
    },
    timeScale: {
      borderVisible: false,
      timeVisible: true,
      secondsVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true
    },
    handleScroll: {
      mouseWheel: false,
      pressedMouseMove: false,
      horzTouchDrag: false
    },
    handleScale: {
      mouseWheel: false,
      pinch: false,
      axisPressedMouseMove: false
    }
  });

  container.style.touchAction = 'pan-y';
  container.style.willChange = 'transform';

  if (!container._stockScrollGuard) {
    let _touchStartX = 0;
    let _touchStartY = 0;

    container.addEventListener('touchstart', (e) => {
      _touchStartX = e.touches[0].clientX;
      _touchStartY = e.touches[0].clientY;
    }, { passive: true, capture: true });

    container.addEventListener('touchmove', (e) => {
      const deltaX = Math.abs(e.touches[0].clientX - _touchStartX);
      const deltaY = Math.abs(e.touches[0].clientY - _touchStartY);

      if (deltaY > deltaX) {
        e.stopImmediatePropagation();
      }
    }, { passive: true, capture: true });

    container._stockScrollGuard = true;
  }

  const areaSeries = chart.addAreaSeries({
    lineColor,
    topColor: topFill,
    bottomColor: botFill,
    lineWidth: 1.8,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
    crosshairMarkerBorderColor: lineColor,
    crosshairMarkerBackgroundColor: lineColor
  });

  const chartData = series.map((p) => ({
    time: p.t,
    value: p.c
  }));

  areaSeries.setData(chartData);
  chart.timeScale().fitContent();

  if (window.ResizeObserver) {
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) chart.applyOptions({ width: w });
    });

    ro.observe(container);
    container._stockChartRo = ro;
  }

  container._stockChart = chart;
}

/* ════════════════════════════════
SSE STREAM PARSER
════════════════════════════════ */
async function _parseSseStream(reader, onResults, onDelta, onStock) {
  const decoder = new TextDecoder('utf-8', { fatal: false });

  let sseBuffer = '';
  let fullText = '';
  let eventType = '';
  let done = false;

  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;

    sseBuffer += done
      ? decoder.decode()
      : decoder.decode(chunk.value, { stream: true });

    const lines = sseBuffer.split('\n');
    sseBuffer = done ? '' : lines.pop();

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
        continue;
      }

      if (!line.startsWith('data: ')) {
        eventType = '';
        continue;
      }

      const data = line.slice(6).trim();

      if (data === '[DONE]') {
        done = true;
        break;
      }

      if (eventType === 'stock') {
        try {
          const s = JSON.parse(data);
          if (s) onStock(s);
        } catch (_) {}
        eventType = '';
        continue;
      }

      if (eventType === 'results') {
        try {
          const r = JSON.parse(data);
          if (Array.isArray(r) && r.length) onResults(r);
        } catch (_) {}
        eventType = '';
        continue;
      }

      if (eventType === 'searchquery') {
        try {
          const { query: sq } = JSON.parse(data);
          if (sq) sessionStorage.setItem('atkyn_last_query', sq);
        } catch (_) {}
        eventType = '';
        continue;
      }

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content || '';
        if (delta) {
          fullText += delta;
          onDelta(delta);
        }
      } catch (_) {}
    }
  }

  return fullText;
}

/* ════════════════════════════════
SEND / STREAM
════════════════════════════════ */
async function send() {
  if (!input || !pill) return;

  const q = input.value.trim();
  if (!q) return;

  input.value = '';
  pill.classList.remove('has-text');

  try {
    sessionStorage.setItem('atkyn_last_query', q);

    sessionStorage.removeItem('atkyn_web_results');
    sessionStorage.removeItem('atkyn_images_results');
    sessionStorage.removeItem('atkyn_news_results');
    sessionStorage.removeItem('atkyn_videos_results');
  } catch (_) {}

  if (window.AtkynQuery && typeof window.AtkynQuery.invalidate === 'function') {
    window.AtkynQuery.invalidate();
  }

  const activeTab = document.querySelector('.tab.active')?.getAttribute('data-tab');

  if (activeTab && activeTab !== 'ai') {
    const initFn = window[`_atkynInit_${activeTab}`];

    if (typeof initFn === 'function') {
      initFn();
      return;
    }

    if (window._atkynLoadTab) {
      window._atkynLoadTab(activeTab);
      return;
    }
  }

  addMsg('user', q);

  _currentSources = [];

  if (_streamAbort) {
    _streamAbort.abort();
    _streamAbort = null;
  }

  showTyping();
  pushHistory('user', q);

  const abort = new AbortController();
  _streamAbort = abort;
  _isStreaming = true;

  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: q,
        history: _history.slice(0, -1)
      }),
      signal: abort.signal
    });

    if (!resp.ok) {
      removeTyping();
      addMsg('bot', 'Something went wrong. Please try again.');
      return;
    }

    const reader = resp.body.getReader();

    let webCardShown = false;
    let stockShown = false;

    const fullText = await _parseSseStream(
      reader,
      (results) => {
        _currentSources = results.map((r) => ({
          url: r.url,
          title: r.title,
          snippet: r.snippet || ''
        }));

        window._atkynSources = _currentSources;

        if (!webCardShown) {
          removeTyping();
          _renderWebCards(results);
          showTyping();
          webCardShown = true;
        } else {
          _renderWebCards(results);
        }
      },
      () => {
        /* Preserved final-render behavior to avoid markdown/code flicker. */
      },
      (stockData) => {
        if (!stockShown) {
          removeTyping();
          _renderStockCard(stockData);
          showTyping();
          stockShown = true;
        }
      }
    );

    removeTyping();

    if (fullText) {
      pushHistory('assistant', fullText);

      const botEl = document.createElement('div');
      botEl.className = 'msg bot';

      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'bubble';

      let html = _renderContent(fullText);

      if (typeof injectCitationChips === 'function') {
        html = injectCitationChips(html, _currentSources);
      }

      bubbleEl.innerHTML = html;
      botEl.appendChild(bubbleEl);

      botEl.style.opacity = '0';
      botEl.style.transform = 'translateY(6px)';
      botEl.style.transition = 'opacity 0.22s ease-out, transform 0.22s ease-out';

      if (msgWrap) msgWrap.appendChild(botEl);

      appendBotActions(botEl, fullText);
      appendDisclaimer(botEl);
      _injectCarousel();

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          botEl.style.opacity = '1';
          botEl.style.transform = '';
          _maybeScroll(botEl, false);
        });
      });
    } else {
      _injectCarousel();
    }

    _scheduleSaveChat();
  } catch (err) {
    if (err && err.name === 'AbortError') return;

    removeTyping();
    addMsg('bot', 'Network error. Please try again.');
  } finally {
    if (_streamAbort === abort) {
      _streamAbort = null;
      _isStreaming = false;
    }
  }
}

/* ════════════════════════════════
INPUT HANDLERS
════════════════════════════════ */
if (input) {
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });
}

if (sendBtn) {
  sendBtn.addEventListener('click', () => {
    if (!sendBtn.classList.contains('cross-mode')) {
      send();
    }
  });
}

/* ════════════════════════════════
CHAT CACHE — sessionStorage
════════════════════════════════ */
const CACHE_HTML = 'atkyn_chat_html';
const CACHE_SCROLL = 'atkyn_chat_scroll';
const CACHE_HIST = 'atkyn_chat_history';

function _saveChat() {
  if (!msgWrap || _isStreaming) return;
  if (!msgWrap.innerHTML.trim()) return;

  try {
    sessionStorage.setItem(CACHE_HTML, msgWrap.innerHTML);
    sessionStorage.setItem(CACHE_SCROLL, String(scrollHost ? scrollHost.scrollTop : 0));
    sessionStorage.setItem(CACHE_HIST, JSON.stringify(_history));
  } catch (_) {}
}

function _scheduleSaveChat() {
  if (window.requestIdleCallback) {
    window.requestIdleCallback(_saveChat);
  } else {
    setTimeout(_saveChat, 120);
  }
}

function _hydrateRestoredMessages() {
  if (!msgWrap) return;

  msgWrap.querySelectorAll('.bubble.typing, .typing').forEach((el) => {
    const msg = el.closest('.msg');
    if (msg) msg.remove();
    else el.remove();
  });

  msgWrap.querySelectorAll('.msg.bot .bot-actions button:not([data-bot-action])').forEach((btn) => {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();

    if (['copy', 'retry', 'like', 'dislike', 'refresh'].includes(label)) {
      btn.setAttribute('data-bot-action', label);
    }
  });
}

function _restoreChat() {
  if (!msgWrap) return false;

  let html = null;

  try {
    html = sessionStorage.getItem(CACHE_HTML);
  } catch (_) {}

  if (!html) return false;

  try {
    msgWrap.innerHTML = html;
    _hydrateRestoredMessages();

    const savedScroll = parseInt(sessionStorage.getItem(CACHE_SCROLL) || '0', 10);
    const savedHist = sessionStorage.getItem(CACHE_HIST);

    if (savedHist) {
      const parsed = JSON.parse(savedHist);
      if (Array.isArray(parsed)) {
        _history.length = 0;
        _history.push(...parsed.slice(-MAX_HISTORY));
      }
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scrollHost) scrollHost.scrollTop = savedScroll;
      });
    });

    const userMsgs = msgWrap.querySelectorAll('.msg.user');
    if (userMsgs.length) {
      window._lastUserMsgEl = userMsgs[userMsgs.length - 1];
    }

    return true;
  } catch (_) {
    return false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    _saveChat();
  }
});

window.addEventListener('pagehide', _saveChat);

/* ════════════════════════════════
URL PARAM AUTO-SEND / RESTORE
════════════════════════════════ */
const _qParam = new URLSearchParams(location.search).get('q');

if (_qParam) {
  try {
    sessionStorage.removeItem(CACHE_HTML);
    sessionStorage.removeItem(CACHE_SCROLL);
    sessionStorage.removeItem(CACHE_HIST);
  } catch (_) {}

  if (input) input.value = _qParam;
  if (pill) pill.classList.add('has-text');

  send();
} else {
  _restoreChat();
}
