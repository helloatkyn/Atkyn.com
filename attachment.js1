/* attachment.js — Atkyn attachment subsystem (independent module)
 *
 * Extracted verbatim from the attachment block of "core.js With Attachment".
 * Owns: attachment state, file pickers wiring, validation, image / PDF / text
 * preparation, chip tray UI, notices, cleanup.
 * Does NOT own: keyboard, VisualViewport, chatbar geometry, theme, scroll,
 * header, tabs. It never touches core.js internals; it reads the DOM only.
 *
 * Public API (unchanged, consumed by search.js): window.AtkynAttach
 *   getReady() / isBusy() / clear() / notify(msg)
 *
 * Load order in search.html:  renderer.js -> core.js -> attachment.js -> search.js
 */
(function () {
if (window.AtkynAttach) return;   /* load-once guard: no duplicate state / listeners */

/* ── Local stand-ins for the 4 core globals the original block used ── */
const pill = document.getElementById('pill');
const sendBtn = document.getElementById('sendBtn');
const plusMenu = document.getElementById('plusMenu');

const _reducedMotionMQ = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
/* read live, like core's own _prefersReducedMotion (which tracks the same query) */
const _rm = { get v() { return !!(_reducedMotionMQ && _reducedMotionMQ.matches); } };

const _scriptLoadPromises = {};
function _loadScript(src) {   /* same logic as core.js _loadScript */
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

/* ════════════════════════════════
   ATTACHMENTS
   Single owner of attachment state, tray UI and file preparation.
   search.js talks to it only through window.AtkynAttach.
   Limits below are mirrored server-side in functions/api/chat.js.
   ════════════════════════════════ */

const ATTACH = {
  MAX_FILES: 4,
  IMAGE_MAX_BYTES: 20 * 1024 * 1024,   /* raw input; re-encoded smaller before sending */
  IMAGE_MAX_DIM: 1600,
  IMAGE_QUALITY: 0.85,
  THUMB_DIM: 112,
  PDF_MAX_BYTES: 15 * 1024 * 1024,
  PDF_MAX_PAGES: 40,
  TEXT_MAX_BYTES: 1024 * 1024,
  TEXT_MAX_CHARS: 40000,               /* per file */
  TEXT_TOTAL_CHARS: 80000,             /* across all text/PDF attachments */
  NOTICE_MS: 4500
};

const _ATTACH_TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'html', 'htm', 'css',
  'js', 'mjs', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb',
  'php', 'sh', 'sql', 'kt', 'swift', 'dart', 'log', 'ini', 'toml'
]);
const _ATTACH_IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif', 'bmp']);

const PDFJS_VERSION = '3.11.174';
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/`;

const SVG_ATTACH_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const SVG_ATTACH_DOC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

const attachTray = document.getElementById('attachTray');
const attachList = document.getElementById('attachList');
const attachNotice = document.getElementById('attachNotice');

/* User-facing failure vs. silent cancellation */
class AttachError extends Error {}
class AttachCancelled extends Error {}

const _attachItems = [];
let _attachSeq = 0;
let _attachNoticeTimer = 0;
let _attachCleanupToken = 0;
let _pdfjsPromise = null;

function _alive(ctrl) {
  if (ctrl.cancelled) throw new AttachCancelled();
}

function _onAiTab() {
  return !(pill && pill.classList.contains('non-ai-tab'));
}

function _fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

function _shortName(name) {
  const n = String(name || 'file');
  return n.length > 28 ? n.slice(0, 25) + '…' : n;
}

function _attachKind(file) {
  const name = String(file.name || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const mime = String(file.type || '').toLowerCase();

  if (mime === 'image/svg+xml' || ext === 'svg') return null;
  if (mime.startsWith('image/') || _ATTACH_IMAGE_EXT.has(ext)) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('text/') || mime === 'application/json' || _ATTACH_TEXT_EXT.has(ext)) return 'text';
  return null;
}

/* ── Preparation: image ── */

async function _decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => { if (bmp.close) bmp.close(); } };
    } catch (_) { /* fall through to <img> */ }
  }

  const url = URL.createObjectURL(file);

  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function _drawJpeg(dec, maxDim, quality, square) {
  let sx = 0, sy = 0, sw = dec.w, sh = dec.h, dw, dh;

  if (square) {
    const m = Math.min(sw, sh);
    sx = (sw - m) / 2;
    sy = (sh - m) / 2;
    sw = m;
    sh = m;
    dw = dh = Math.min(maxDim, m);
  } else {
    const k = Math.min(1, maxDim / Math.max(sw, sh));
    dw = Math.max(1, Math.round(sw * k));
    dh = Math.max(1, Math.round(sh * k));
  }

  const c = document.createElement('canvas');
  c.width = dw;
  c.height = dh;

  const ctx = c.getContext('2d');
  if (!ctx) throw new AttachError("This image couldn't be processed.");

  ctx.fillStyle = '#fff';               /* JPEG has no alpha */
  ctx.fillRect(0, 0, dw, dh);
  ctx.drawImage(dec.src, sx, sy, sw, sh, 0, 0, dw, dh);

  const url = c.toDataURL('image/jpeg', quality);
  c.width = c.height = 0;               /* release backing store (iOS canvas memory cap) */

  if (url.indexOf('data:image/jpeg') !== 0) throw new AttachError("This image couldn't be processed.");
  return url;
}

async function _processImage(file, ctrl) {
  let dec;

  try {
    dec = await _decodeImage(file);
  } catch (_) {
    throw new AttachError("This image couldn't be read.");
  }

  try {
    _alive(ctrl);
    if (!dec.w || !dec.h) throw new AttachError("This image couldn't be read.");

    const dataUrl = _drawJpeg(dec, ATTACH.IMAGE_MAX_DIM, ATTACH.IMAGE_QUALITY, false);
    const thumb = _drawJpeg(dec, ATTACH.THUMB_DIM, 0.7, true);

    return { type: 'image', name: file.name || 'image', mime: 'image/jpeg', dataUrl, thumb };
  } finally {
    dec.done();
  }
}

/* ── Preparation: text / code ── */

async function _processText(file, ctrl) {
  const raw = await file.text();
  _alive(ctrl);

  const head = raw.slice(0, 8000);
  const bad = (head.match(/\uFFFD/g) || []).length;

  if (head.indexOf('\u0000') !== -1 || (head.length && bad / head.length > 0.02)) {
    throw new AttachError("This doesn't look like a text file.");
  }

  const text = raw.replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new AttachError('This file is empty.');

  return { type: 'text', name: file.name || 'file', mime: file.type || 'text/plain', text, truncated: false };
}

/* ── Preparation: PDF (pdf.js loaded on first use; reuses the shared script loader) ── */

function _loadPdfjs() {
  if (_pdfjsPromise) return _pdfjsPromise;

  _pdfjsPromise = _loadScript(PDFJS_BASE + 'pdf.min.js')
    .then(() => fetch(PDFJS_BASE + 'pdf.worker.min.js'))
    .then((res) => {
      if (!res.ok) throw new Error('pdf worker');
      return res.blob();
    })
    .then((blob) => {
      const lib = window.pdfjsLib;
      if (!lib) throw new Error('pdfjs missing');

      /* Cross-origin Workers are blocked; a same-origin blob URL is the supported route */
      lib.GlobalWorkerOptions.workerSrc =
        URL.createObjectURL(new Blob([blob], { type: 'text/javascript' }));

      return lib;
    })
    .catch((err) => {
      _pdfjsPromise = null;
      throw err;
    });

  return _pdfjsPromise;
}

async function _processPdf(file, ctrl) {
  let lib;

  try {
    lib = await _loadPdfjs();
  } catch (_) {
    throw new AttachError('PDF reader could not load. Check your connection and try again.');
  }

  _alive(ctrl);

  const buf = await file.arrayBuffer();
  _alive(ctrl);

  let doc;

  try {
    doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  } catch (err) {
    if (err && err.name === 'PasswordException') throw new AttachError('This PDF is password protected.');
    throw new AttachError("This PDF couldn't be read.");
  }

  try {
    const total = doc.numPages;
    const limit = Math.min(total, ATTACH.PDF_MAX_PAGES);
    const parts = [];
    let chars = 0;
    let pagesRead = 0;

    for (let i = 1; i <= limit; i++) {
      _alive(ctrl);

      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      page.cleanup();

      const pageText = content.items
        .map((it) => (it.str || '') + (it.hasEOL ? '\n' : ' '))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      pagesRead = i;

      if (pageText) {
        parts.push(`--- Page ${i} ---\n${pageText}`);
        chars += pageText.length;
      }

      if (chars >= ATTACH.TEXT_MAX_CHARS) break;
    }

    const text = parts.join('\n\n');

    if (!text.trim()) {
      throw new AttachError('No selectable text found (it may be a scanned PDF).');
    }

    return {
      type: 'text',
      name: file.name || 'document.pdf',
      mime: 'application/pdf',
      text,
      truncated: pagesRead < total
    };
  } finally {
    try { doc.destroy(); } catch (_) {}
  }
}

/* Applies per-file and total text budgets at the moment an item becomes ready */
function _fitTextBudget(data, self) {
  if (data.type !== 'text') return data;

  let used = 0;
  for (const it of _attachItems) {
    if (it !== self && it.status === 'ready' && it.data && it.data.type === 'text') {
      used += it.data.text.length;
    }
  }

  const cap = Math.min(ATTACH.TEXT_MAX_CHARS, ATTACH.TEXT_TOTAL_CHARS - used);

  if (cap < 200) {
    throw new AttachError('Text limit for this message reached. Remove a file first.');
  }

  if (data.text.length > cap) {
    let t = data.text.slice(0, cap);
    const last = t.charCodeAt(t.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) t = t.slice(0, -1);   /* never split a surrogate pair */
    data.text = t;
    data.truncated = true;
  }

  return data;
}

async function _processAttachment(item) {
  try {
    let data;

    if (item.kind === 'image') data = await _processImage(item.file, item.ctrl);
    else if (item.kind === 'pdf') data = await _processPdf(item.file, item.ctrl);
    else data = await _processText(item.file, item.ctrl);

    _alive(item.ctrl);

    item.data = _fitTextBudget(data, item);
    item.status = 'ready';
    _markChipReady(item);
  } catch (err) {
    if (item.ctrl.cancelled || err instanceof AttachCancelled) return;

    /* Notice first: while it is visible the tray stays open, so the failed chip can go at once */
    _showAttachNotice(
      `${_shortName(item.name)}: ${err instanceof AttachError ? err.message : "couldn't be read."}`
    );
    _removeAttachItem(item);
  } finally {
    _syncAttachUI();
  }
}

/* ── Chip rendering ── */

function _buildChip(item) {
  const el = document.createElement('div');
  el.className = 'attach-chip is-loading ' + (item.kind === 'image' ? 'is-image' : 'is-file') +
    (item.kind === 'pdf' ? ' is-pdf' : '');
  el.setAttribute('role', 'listitem');
  el.dataset.id = String(item.id);

  if (item.kind !== 'image') {
    const ico = document.createElement('span');
    ico.className = 'attach-file-ico';
    ico.innerHTML = SVG_ATTACH_DOC;

    const txt = document.createElement('span');
    txt.className = 'attach-file-text';

    const nm = document.createElement('span');
    nm.className = 'attach-file-name';
    nm.textContent = item.name;

    const meta = document.createElement('span');
    meta.className = 'attach-file-meta';
    const ext = item.name.includes('.') ? item.name.split('.').pop().toUpperCase().slice(0, 5) : 'FILE';
    meta.textContent = `${ext} · ${_fmtSize(item.file.size)}`;

    txt.appendChild(nm);
    txt.appendChild(meta);
    el.appendChild(ico);
    el.appendChild(txt);
  }

  const spin = document.createElement('span');
  spin.className = 'attach-spin';
  spin.setAttribute('aria-hidden', 'true');
  el.appendChild(spin);

  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'attach-remove';
  rm.setAttribute('aria-label', 'Remove ' + item.name);
  rm.innerHTML = SVG_ATTACH_X;
  el.appendChild(rm);

  return el;
}

function _markChipReady(item) {
  const el = item.el;
  if (!el || !el.isConnected) return;

  el.classList.remove('is-loading');

  const spin = el.querySelector('.attach-spin');
  if (spin) spin.remove();

  if (item.kind === 'image' && item.data && item.data.thumb) {
    const img = document.createElement('img');
    img.alt = item.name;
    img.src = item.data.thumb;
    el.insertBefore(img, el.firstChild);
  }
}

/* Drops chip elements of items that already left the list (kept only to animate the collapse) */
function _purgeStaleChips() {
  if (!attachList) return;

  Array.from(attachList.children).forEach((el) => {
    if (!_attachItems.some((it) => String(it.id) === el.dataset.id)) el.remove();
  });
}

/* When the last chip goes, keep its element until the tray finished collapsing */
function _scheduleListCleanup() {
  if (!attachTray || !attachList) return;

  const token = ++_attachCleanupToken;
  let timer = 0;

  const done = () => {
    attachTray.removeEventListener('transitionend', onEnd);
    clearTimeout(timer);
    if (token === _attachCleanupToken && !_attachItems.length) attachList.textContent = '';
  };

  const onEnd = (e) => {
    if (e.target === attachTray && e.propertyName === 'grid-template-rows') done();
  };

  if (_rm.v) {
    done();
    return;
  }

  attachTray.addEventListener('transitionend', onEnd);
  timer = window.setTimeout(done, 380);   /* watchdog: same pattern as the plus menu */
}

/* ── State transitions ── */

function _removeAttachItem(item) {
  const i = _attachItems.indexOf(item);
  if (i === -1) return;

  item.ctrl.cancelled = true;           /* aborts any in-flight preparation */
  _attachItems.splice(i, 1);

  /* Keep the last chip on screen only when the tray is really about to collapse */
  if (_attachItems.length || (pill && pill.classList.contains('has-notice'))) {
    if (item.el) item.el.remove();
  } else {
    _scheduleListCleanup();
  }

  _syncAttachUI();
}

function _clearAttachments() {
  if (!_attachItems.length) return;

  _attachItems.forEach((it) => { it.ctrl.cancelled = true; });
  _attachItems.length = 0;

  _scheduleListCleanup();
  _syncAttachUI();
}

function _syncAttachUI() {
  if (!pill) return;

  const onAi = _onAiTab();
  const has = onAi && _attachItems.length > 0;
  const busy = onAi && _attachItems.some((it) => it.status === 'processing');

  pill.classList.toggle('has-attach', has);

  if (sendBtn) {
    sendBtn.classList.toggle('is-busy', busy);
    if (busy) sendBtn.setAttribute('aria-busy', 'true');
    else sendBtn.removeAttribute('aria-busy');
  }
}

function _showAttachNotice(msg) {
  if (!attachNotice || !pill) return;

  clearTimeout(_attachNoticeTimer);

  attachNotice.textContent = msg;
  attachNotice.hidden = false;
  pill.classList.add('has-notice');

  _attachNoticeTimer = window.setTimeout(_hideAttachNotice, ATTACH.NOTICE_MS);
}

/* Text stays in the DOM while the tray collapses; the collapsed tray is visibility:hidden */
function _hideAttachNotice() {
  clearTimeout(_attachNoticeTimer);
  _attachNoticeTimer = 0;
  if (pill) pill.classList.remove('has-notice');
}

function _addAttachments(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  if (!_onAiTab()) {
    _showAttachNotice('Attachments are available in the Answer tab.');
    return;
  }

  _purgeStaleChips();
  _attachCleanupToken += 1;             /* a pending collapse-cleanup must not wipe new chips */

  const problems = [];
  let added = 0;

  for (const file of files) {
    if (_attachItems.length >= ATTACH.MAX_FILES) {
      problems.push(`You can attach up to ${ATTACH.MAX_FILES} files per message.`);
      break;
    }

    const name = file.name || 'file';
    const kind = _attachKind(file);

    if (!kind) {
      problems.push(`${_shortName(name)}: unsupported file type.`);
      continue;
    }

    if (!file.size) {
      problems.push(`${_shortName(name)}: file is empty.`);
      continue;
    }

    const maxBytes = kind === 'image' ? ATTACH.IMAGE_MAX_BYTES
      : kind === 'pdf' ? ATTACH.PDF_MAX_BYTES
      : ATTACH.TEXT_MAX_BYTES;

    if (file.size > maxBytes) {
      problems.push(`${_shortName(name)}: too large (max ${_fmtSize(maxBytes)}).`);
      continue;
    }

    if (_attachItems.some((it) =>
      it.file.name === file.name && it.file.size === file.size && it.file.lastModified === file.lastModified)) {
      problems.push(`${_shortName(name)} is already attached.`);
      continue;
    }

    const item = {
      id: ++_attachSeq,
      file,
      name,
      kind,
      status: 'processing',
      ctrl: { cancelled: false },
      data: null,
      el: null
    };

    item.el = _buildChip(item);
    _attachItems.push(item);
    attachList.appendChild(item.el);
    added += 1;

    _processAttachment(item);
  }

  _syncAttachUI();

  if (added) {
    requestAnimationFrame(() => { attachList.scrollLeft = attachList.scrollWidth; });
  }

  if (problems.length) {
    _showAttachNotice(problems.length === 1 ? problems[0] : `${problems[0]} (+${problems.length - 1} more skipped)`);
  } else if (added) {
    _hideAttachNotice();
  }
}

/* ── Wiring ── */

if (attachList) {
  /* Removing a chip must not steal focus (would open/close the keyboard) */
  const keepFocus = (e) => {
    if (e.target instanceof Element && e.target.closest('.attach-remove')) e.preventDefault();
  };

  attachList.addEventListener('pointerdown', keepFocus);
  attachList.addEventListener('mousedown', keepFocus);

  attachList.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('.attach-remove') : null;
    if (!btn) return;

    const chip = btn.closest('.attach-chip');
    const item = chip ? _attachItems.find((it) => String(it.id) === chip.dataset.id) : null;
    if (item) _removeAttachItem(item);
  });
}

[['pmPhoto', 'fileInputPhoto'], ['pmCamera', 'fileInputCamera'], ['pmFile', 'fileInputFile']].forEach(([btnId, inputId]) => {
  const btn = document.getElementById(btnId);
  const fi = document.getElementById(inputId);
  if (!btn || !fi) return;

  btn.addEventListener('click', () => fi.click());

  fi.addEventListener('change', () => {
    const files = Array.from(fi.files || []);
    fi.value = '';                       /* allow re-picking the same file */
    _addAttachments(files);
  });
});

window.AtkynAttach = {
  /* Prepared attachments in attach order; [] when none, none ready, or off the Answer tab */
  getReady() {
    if (!_onAiTab()) return [];
    return _attachItems
      .filter((it) => it.status === 'ready' && it.data)
      .map((it) => Object.assign({}, it.data));
  },
  isBusy() {
    return _onAiTab() && _attachItems.some((it) => it.status === 'processing');
  },
  clear: _clearAttachments,
  notify: _showAttachNotice
};

/* ════════════════════════════════
   INTEGRATION HOOKS
   Replace the 3 lines that used to live inside core.js, without touching it.
   ════════════════════════════════ */

/* (1) was: core tab handler -> _syncAttachUI().
   Core toggles 'non-ai-tab' on the pill when the tab changes; mirror that. */
if (pill && typeof MutationObserver === 'function') {
  let _lastOnAi = _onAiTab();

  new MutationObserver(() => {
    const now = _onAiTab();
    if (now === _lastOnAi) return;
    _lastOnAi = now;
    _syncAttachUI();
  }).observe(pill, { attributes: true, attributeFilter: ['class'] });
}

/* (2) was: core _syncPlusMenuOffset() inside _onBarResize().
   The plus menu sits above the pill; the tray changes the pill height. */
function _syncPlusMenuOffset() {
  if (!plusMenu || !pill) return;

  const ph = Math.round(pill.getBoundingClientRect().height);
  if (ph > 0) plusMenu.style.setProperty('--pill-h', ph + 'px');
}

if (pill && typeof ResizeObserver === 'function') {
  new ResizeObserver(_syncPlusMenuOffset).observe(pill);
}
_syncPlusMenuOffset();

/* (3) was: core pill pointerdown guard  `if (target.closest('.attach-tray')) return;`
   Stops tray taps (chip remove button) from reaching core's pill handler,
   which would otherwise focus the input / open the keyboard. */
if (attachTray) {
  attachTray.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
}

})();
