/* ═══════════════════════════════════════════════════════════════
search.js — Atkyn Answer page only
[PRODUCTION READY: All Syntax Errors Fixed · Bing-Style Cards]
Chat rendering · stream handling · API · typing · copy · cards
Requires: core.js (loaded before this)
═══════════════════════════════════════════════════════════════ */

/* ── DOM refs (chat-specific) ── */
const msgWrap    = document.getElementById('msgWrap');
const chatSpacer = document.getElementById('chatSpacer');

/* ── Chat state ── */
let _streamAbort     = null;
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

// Single-RAF animate-in: 16ms vs 33ms double-RAF
function _animateIn(el) {
  el.getBoundingClientRect();
  requestAnimationFrame(() => {
    el.style.opacity   = '1';
    el.style.transform = '';
  });
}

// KaTeX deferred to idle time — non-blocking
function _applyKatexIdle(el) {
  if (typeof renderMathInElement !== 'function') return;
  const opts = {
    delimiters: [
      { left: '$$', right: '$$', display: true  },
      { left: '$',  right: '$',  display: false },
      { left: '\\(', right: '\\)', display: false },
      { left: '\\[', right: '\\]', display: true  },
    ],
    throwOnError: false,
  };
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => renderMathInElement(el, opts), { timeout: 200 });
  } else {
    requestAnimationFrame(() => renderMathInElement(el, opts));
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
  if (_typingEl) _animateIn(_typingEl);
}

function removeTyping() {
  if (_typingEl) { _typingEl.remove(); _typingEl = null; }
}

/* ═══════════════════════════════
MESSAGE RENDERING
════════════════════════════════ */

function addMsg(role, text) {
  const d = document.createElement('div');
  d.className = `msg ${role}`;
  const html = renderMarkdown(text);
  d.innerHTML = `<div class="bubble">${html}</div>`;
  d.style.opacity    = '0';
  d.style.transform  = 'translateY(6px)';
  d.style.transition = 'opacity 0.22s ease-out, transform 0.22s ease-out';
  msgWrap.appendChild(d);
  _animateIn(d);

  const bubble = d.querySelector('.bubble');
  if (bubble) _applyKatexIdle(bubble);

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
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    }, 1800);
  }).catch(() => {});
});

/* ════════════════════════════════
WEB RESULT CARDS — BING STYLE
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
        <div class="web-card-snippet" style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${escapeHtml(r.snippet)}</div>
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

  // Favicon error handler — 3-tier fallback
  const favImg = a.querySelector('.web-card-favicon');
  favImg.addEventListener('error', function() {
    if (this.src !== faviconFallback) {
      this.src = faviconFallback;
    } else {
      // Final fallback: create letter-based favicon
      const letter = hostname[0]?.toUpperCase() || '?';
      const colors = ['#007AFF','#34C759','#FF9500','#FF3B30','#AF52DE','#5856D6'];
      const bg = colors[letter.charCodeAt(0) % colors.length];
      this.src = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect width='16' height='16' rx='3' fill='${encodeURIComponent(bg)}'/><text x='8' y='12' font-family='system-ui' font-size='10' font-weight='600' fill='white' text-anchor='middle'>${letter}</text></svg>`;
    }
  }, { once: false, passive: true });

  return a;
}

function _renderWebCards(results) {
  const previewWrap     = document.createElement('div');
  previewWrap.className = 'msg bot';
  const previewOuter     = document.createElement('div');
  previewOuter.className = 'web-cards-shadow-wrap';
  const previewBubble     = document.createElement('div');
  previewBubble.className = 'bubble web-results-preview';
  
  // Show up to 10 results (Bing shows 8-10 upfront)
  const previewResults  = results.slice(0, 2);
  const carouselResults = results.slice(2);
  
  previewResults.forEach(r => previewBubble.appendChild(_buildWebCard(r)));
  previewOuter.appendChild(previewBubble);
  previewWrap.appendChild(previewOuter);
  previewWrap.style.opacity    = '0';
  previewWrap.style.transform  = 'translateY(6px)';
  previewWrap.style.transition = 'opacity 0.22s ease-out, transform 0.22s ease-out';
  msgWrap.appendChild(previewWrap);
  _animateIn(previewWrap);

  if (carouselResults.length > 0) {
    const carouselOuter     = document.createElement('div');
    carouselOuter.className = 'web-cards-shadow-wrap';
    const carousel     = document.createElement('div');
    carousel.className = 'web-results-carousel-wrap';
    carouselResults.forEach(r => carousel.appendChild(_buildWebCard(r)));
    carouselOuter.appendChild(carousel);
    carouselOuter.style.display = 'none';
    _pendingCarousel = carouselOuter;
  }
}

function _injectCarousel() {
  if (!_pendingCarousel) return;
  const carouselOuter = _pendingCarousel;
  _pendingCarousel    = null;
  const carouselWrap     = document.createElement('div');
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
  const SPEED_PX_SEC    = 24;
  
  const originals = Array.from(track.children);
  if (originals.length === 0) return;
  
  originals.forEach(card => {
    const clone = card.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    clone.style.pointerEvents = 'none';
    track.appendChild(clone);
  });

  // GPU layer promotion
  track.style.willChange = 'transform';
  track.style.transform  = 'translateZ(0)';

  let halfWidth = 0, offset = 0, lastTime = 0;
  let rafId = 0, running = false, touchActive = false, resumeTimerId = 0;
  
  requestAnimationFrame(() => { halfWidth = track.scrollWidth / 2; });
  const startTimerId = setTimeout(startTicking, START_DELAY_MS);

  // Time-based tick — smooth on 60/90/120Hz
  function tick(now) {
    if (!running || touchActive) { rafId = 0; return; }
    if (!lastTime) lastTime = now;
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    offset += SPEED_PX_SEC * dt;
    if (halfWidth > 0 && offset >= halfWidth) offset -= halfWidth;
    track.style.transform = `translate3d(${-offset}px, 0, 0)`;
    rafId = requestAnimationFrame(tick);
  }

  function startTicking() { if (rafId) return; running = true; lastTime = 0; rafId = requestAnimationFrame(tick); }
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
      stopTicking();
      clearTimeout(resumeTimerId);
      clearTimeout(startTimerId);
      track.style.willChange = 'auto';
      io.disconnect();
    }
  }, { threshold: 0 });
  io.observe(track);
}

/* ════════════════════════════════
STOCK CARD
════════════════════════════════ */
function _renderStockCard(data) {
  const isUp      = data.change >= 0;
  const color     = isUp ? '#1a9e4a' : '#d93025';
  const bgColor   = isUp ? 'rgba(26,158,74,0.08)' : 'rgba(217,48,37,0.08)';
  const arrow     = isUp ? '▲' : '▼';
  const changeStr = `${isUp ? '+' : ''}${data.change.toFixed(2)} (${isUp ? '+' : ''}${data.changePct.toFixed(2)}%)`;

  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  const card = document.createElement('div');
  card.className = 'stock-card';

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'stock-header';
  header.innerHTML = `
    <div class="stock-logo-wrap">
      ${data.logo ? `<img class="stock-logo" src="${escapeHtml(data.logo)}" alt="" onerror="this.style.display='none'">` : ''}
    </div>
    <div class="stock-title-wrap">
      <div class="stock-name">${escapeHtml(data.name)}</div>
      <div class="stock-ticker-exchange">${escapeHtml(data.ticker)}${data.exchange ? ' · ' + escapeHtml(data.exchange) : ''}</div>
    </div>`;

  // ── Price ──
  const priceRow = document.createElement('div');
  priceRow.className = 'stock-price-row';
  priceRow.innerHTML = `
    <div class="stock-price">${data.currency === 'USD' ? '$' : ''}${data.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
    <div class="stock-change" style="color:${color}">${arrow} ${changeStr}</div>`;

  // ── Time range tabs ──
  const tabs = document.createElement('div');
  tabs.className = 'stock-tabs';
  const ranges = ['1D','1W','1M','3M','1Y'];
  ranges.forEach((r, i) => {
    const btn = document.createElement('button');
    btn.className = 'stock-tab' + (i === 0 ? ' active' : '');
    btn.textContent = r;
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('.stock-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _fetchAndUpdateChart(data.ticker, r, chartContainer, data);
    });
    tabs.appendChild(btn);
  });

  // ── Chart container ─
  const chartContainer = document.createElement('div');
  chartContainer.className = 'stock-chart-container';

  // ── Stats row ──
  const stats = document.createElement('div');
  stats.className = 'stock-stats';
  const statsData = [
    { label: 'Open',  value: data.open  ? (data.currency === 'USD' ? '$' : '') + data.open.toFixed(2)  : '—' },
    { label: 'High',  value: data.high  ? (data.currency === 'USD' ? '$' : '') + data.high.toFixed(2)  : '—' },
    { label: 'Low',   value: data.low   ? (data.currency === 'USD' ? '$' : '') + data.low.toFixed(2)   : '—' },
    { label: 'Prev.', value: data.prevClose ? (data.currency === 'USD' ? '$' : '') + data.prevClose.toFixed(2) : '—' },
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

  wrap.style.opacity    = '0';
  wrap.style.transform  = 'translateY(6px)';
  wrap.style.transition = 'opacity 0.22s ease-out, transform 0.22s ease-out';
  msgWrap.appendChild(wrap);
  _animateIn(wrap);

  requestAnimationFrame(() => {
    _fetchAndUpdateChart(data.ticker, '1D', chartContainer, data);
    scrollToMsg(wrap);
  });
}

function _resolutionFor(range) {
  switch (range) {
    case '1D': return { resolution: '5',  days: 1   };
    case '1W': return { resolution: '15', days: 7   };
    case '1M': return { resolution: '60', days: 30  };
    case '3M': return { resolution: 'D',  days: 90  };
    case '1Y': return { resolution: 'W',  days: 365 };
    default:   return { resolution: '5',  days: 1   };
  }
}

async function _fetchAndUpdateChart(ticker, range, container, data) {
  container.innerHTML = '<div class="stock-chart-loading"></div>';
  try {
    const { resolution, days } = _resolutionFor(range);
    const to   = Math.floor(Date.now() / 1000);
    const fetchDays = range === '1D' ? 5 : days;
    const from = to - fetchDays * 86400;
    
    const resp = await fetch(`/api/stockcandle?symbol=${encodeURIComponent(ticker)}&resolution=${resolution}&from=${from}&to=${to}`);
    if (!resp.ok) throw new Error('fetch failed');
    
    const candle = await resp.json();
    if (candle.s !== 'ok' || !Array.isArray(candle.t)) throw new Error('no data');
    
    let series = candle.t.map((t, i) => ({
      t, o: candle.o[i], h: candle.h[i], l: candle.l[i], c: candle.c[i],
    }));
    
    if (range === '1D' && series.length > 0) {
      const lastTs  = series[series.length - 1].t;
      const lastDay = new Date(lastTs * 1000);
      const dayKey  = `${lastDay.getUTCFullYear()}-${lastDay.getUTCMonth()}-${lastDay.getUTCDate()}`;
      const filtered = series.filter(c => {
        const d = new Date(c.t * 1000);
        return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}` === dayKey;
      });
      if (filtered.length > 0) series = filtered;
    }
    
    const lastPrice  = series[series.length - 1]?.c ?? data.price;
    const firstPrice = series[0]?.c ?? data.prevClose;
    const up = lastPrice >= firstPrice;
    
    container.innerHTML = '';
    _initStockChart(container, series, up, data);
  } catch {
    container.innerHTML = '';
    _initStockChart(container, data.series, data.change >= 0, data);
  }
}

function _initStockChart(container, series, isUp, stockMeta) {
  const LW = window.LightweightCharts;
  if (!LW) {
    container.innerHTML = '<div class="stock-chart-nodata">Chart unavailable</div>';
    return;
  }

  if (!series || series.length === 0) {
    if (stockMeta?.price && stockMeta?.prevClose) {
      const now  = Math.floor(Date.now() / 1000);
      series = [
        { t: now - 3600, c: stockMeta.prevClose },
        { t: now,        c: stockMeta.price },
      ];
    } else {
      container.innerHTML = '<div class="stock-chart-nodata">No chart data</div>';
      return;
    }
  }

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const upColor   = '#1a9e4a';
  const downColor = '#d93025';
  const lineColor = isUp ? upColor : downColor;
  const topAlpha  = isUp ? '0.20' : '0.18';
  const topFill   = isUp ? `rgba(26,158,74,${topAlpha})`   : `rgba(217,48,37,${topAlpha})`;
  const botFill   = isUp ? 'rgba(26,158,74,0.00)'          : 'rgba(217,48,37,0.00)';

  const chart = LW.createChart(container, {
    width:  container.clientWidth || container.offsetWidth || 320,
    height: 180,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor:  isDark ? '#9e9e9e' : '#757575',
      fontSize:   11,
    },
    grid: {
      vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
      horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
    },
    crosshair: {
      mode: LW.CrosshairMode.Normal,
      vertLine: { color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)', width: 1, style: 1 },
      horzLine: { color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)', width: 1, style: 1 },
    },
    rightPriceScale: {
      borderVisible: false,
      scaleMargins: { top: 0.12, bottom: 0.08 },
    },
    timeScale: {
      borderVisible:      false,
      timeVisible:        true,
      secondsVisible:     false,
      fixLeftEdge:        true,
      fixRightEdge:       true,
    },
    handleScroll:  { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false },
    handleScale:   { mouseWheel: false, pinch: false, axisPressedMouseMove: false },
  });

  container.style.touchAction = 'pan-y';
  container.style.willChange  = 'transform';

  // Release GPU layer after chart is fully rendered
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(() => { container.style.willChange = 'auto'; }, 100);
    });
  });

  let _touchStartX = 0, _touchStartY = 0;
  container.addEventListener('touchstart', (e) => {
    _touchStartX = e.touches[0].clientX;
    _touchStartY = e.touches[0].clientY;
  }, { passive: true, capture: true });
  
  container.addEventListener('touchmove', (e) => {
    const deltaX = Math.abs(e.touches[0].clientX - _touchStartX);
    const deltaY = Math.abs(e.touches[0].clientY - _touchStartY);
    if (deltaY > deltaX) e.stopImmediatePropagation();
  }, { passive: true, capture: true });

  const areaSeries = chart.addAreaSeries({
    lineColor,
    topColor:       topFill,
    bottomColor:    botFill,
    lineWidth:      1.8,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius:  4,
    crosshairMarkerBorderColor: lineColor,
    crosshairMarkerBackgroundColor: lineColor,
  });

  const chartData = series.map(p => ({ time: p.t, value: p.c }));
  areaSeries.setData(chartData);
  chart.timeScale().fitContent();

  // RAF-debounced resize observer
  if (window.ResizeObserver) {
    let _chartResizeRaf = 0;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width;
      if (!w) return;
      if (_chartResizeRaf) cancelAnimationFrame(_chartResizeRaf);
      _chartResizeRaf = requestAnimationFrame(() => {
        _chartResizeRaf = 0;
        chart.applyOptions({ width: w });
      });
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
      
      if (eventType === 'stock') {
        try { const s = JSON.parse(data); if (s) onStock(s); } catch (_) {}
        eventType = '';
        continue;
      }
      if (eventType === 'results') {
        try { const r = JSON.parse(data); if (r.length) onResults(r); } catch (_) {}
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

  sessionStorage.setItem('atkyn_last_query', q);
  sessionStorage.removeItem('atkyn_web_results');
  sessionStorage.removeItem('atkyn_images_results');
  sessionStorage.removeItem('atkyn_news_results');
  sessionStorage.removeItem('atkyn_videos_results');
  
  if (window.AtkynQuery) window.AtkynQuery.invalidate();

  const activeTab = document.querySelector('.tab.active')?.getAttribute('data-tab');
  if (activeTab && activeTab !== 'ai') {
    const initFn = window[`_atkynInit_${activeTab}`];
    if (typeof initFn === 'function') { initFn(); return; }
    if (window._atkynLoadTab) { window._atkynLoadTab(activeTab); return; }
  }

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
    let stockShown   = false;

    const fullText = await _parseSseStream(
      reader,
      (results) => {
        if (!webCardShown) {
          removeTyping();
          _renderWebCards(results);
          requestAnimationFrame(() => {
            const last = msgWrap.lastElementChild;
            if (last) scrollToMsg(last);
          });
          showTyping();
          webCardShown = true;
        } else {
          _renderWebCards(results);
        }
      },
      () => {},
      (stockData) => {
        if (!stockShown) {
          removeTyping();
          _renderStockCard(stockData);
          showTyping();
          stockShown = true;
        }
      }
    );

    _streamAbort = null;
    removeTyping();

    if (fullText) {
      pushHistory('assistant', fullText);
      const botEl     = document.createElement('div');
      botEl.className = 'msg bot';
      const bubbleEl  = document.createElement('div');
      bubbleEl.className = 'bubble';
      bubbleEl.innerHTML = renderMarkdown(fullText);
      botEl.appendChild(bubbleEl);
      _applyKatexIdle(bubbleEl);

      botEl.style.opacity    = '0';
      botEl.style.transform  = 'translateY(6px)';
      botEl.style.transition = 'opacity 0.22s ease-out, transform 0.22s ease-out';
      msgWrap.appendChild(botEl);
      appendBotActions(botEl, fullText);
      _injectCarousel();
      _animateIn(botEl);
      requestAnimationFrame(() => { scrollToMsg(botEl); });
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

sendBtn.addEventListener('click', () => {
  if (!sendBtn.classList.contains('cross-mode')) send();
});

/* ═══════════════════════════════
CHAT CACHE — sessionStorage
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
    msgWrap.querySelectorAll('.bubble').forEach(bubble => _applyKatexIdle(bubble));
    const savedScroll = parseInt(sessionStorage.getItem(CACHE_SCROLL) || '0', 10);
    const savedHist   = sessionStorage.getItem(CACHE_HIST);
    if (savedHist) {
      const parsed = JSON.parse(savedHist);
      _history.push(...parsed);
    }
    requestAnimationFrame(() => { scrollHost.scrollTop = savedScroll; });
    const userMsgs = msgWrap.querySelectorAll('.msg.user');
    if (userMsgs.length) window._lastUserMsgEl = userMsgs[userMsgs.length - 1];
    return true;
  } catch (_) {
    return false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') _saveChat();
});

window.addEventListener('pagehide', _saveChat);

/* ════════════════════════════════
URL PARAM AUTO-SEND / RESTORE
════════════════════════════════ */
const _qParam = new URLSearchParams(location.search).get('q');
if (_qParam) {
  sessionStorage.removeItem(CACHE_HTML);
  sessionStorage.removeItem(CACHE_SCROLL);
  sessionStorage.removeItem(CACHE_HIST);
  input.value = _qParam;
  pill.classList.add('has-text');
  send();
} else {
  _restoreChat();
}
