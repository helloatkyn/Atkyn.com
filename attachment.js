(function () {
if (window.AtkynAttach) return;

const pill = document.getElementById('pill');
const sendBtn = document.getElementById('sendBtn');
const plusMenu = document.getElementById('plusMenu');

const _reducedMotionMQ = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const _reduced = () => !!(_reducedMotionMQ && _reducedMotionMQ.matches);

const _scriptLoadPromises = {};
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

// Attachment limits and live-preview caps.
const ATTACH = {
  MAX_FILES: 4,
  IMAGE_MAX_BYTES: 20 * 1024 * 1024,
  IMAGE_MAX_DIM: 1600,
  IMAGE_QUALITY: 0.85,

  THUMB_DIM: 112,
  PREVIEW_MAX_W: 360,
  PREVIEW_MAX_H: 180,
  PDF_MAX_BYTES: 15 * 1024 * 1024,
  PDF_MAX_PAGES: 40,
  TEXT_MAX_BYTES: 1024 * 1024,
  TEXT_MAX_CHARS: 40000,
  TEXT_TOTAL_CHARS: 80000,
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

// Prefer the browser decoder; fall back to an <img> decode.
async function _decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => { if (bmp.close) bmp.close(); } };
    } catch (_) {  }
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

  ctx.fillStyle = '#fff';               
  ctx.fillRect(0, 0, dw, dh);
  ctx.drawImage(dec.src, sx, sy, sw, sh, 0, 0, dw, dh);

  const url = c.toDataURL('image/jpeg', quality);
  c.width = c.height = 0;               

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
    ctrl.dims = { w: dec.w, h: dec.h };   

    const dataUrl = _drawJpeg(dec, ATTACH.IMAGE_MAX_DIM, ATTACH.IMAGE_QUALITY, false);
    const thumb = _drawJpeg(dec, ATTACH.THUMB_DIM, 0.7, true);

    return { type: 'image', name: file.name || 'image', mime: 'image/jpeg', dataUrl, thumb };
  } finally {
    dec.done();
  }
}

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
    if (last >= 0xD800 && last <= 0xDBFF) t = t.slice(0, -1);   
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

    
    _showAttachNotice(
      `${_shortName(item.name)}: ${err instanceof AttachError ? err.message : "couldn't be read."}`
    );
    _removeAttachItem(item);
  } finally {
    _syncAttachUI();
  }
}

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

function _previewWidth() {
  if (attachList) {
    const cs = getComputedStyle(attachList);
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const width = attachList.clientWidth - pl - pr;
    if (width > 0) return width;
  }

  const pillWidth = pill ? pill.clientWidth : 0;
  return Math.max(1, pillWidth || window.innerWidth);
}

function _fitPreview(el, img, w, h) {
  if (!(w > 0 && h > 0)) return;

  const maxW = Math.min(_previewWidth(), ATTACH.PREVIEW_MAX_W);
  const scale = Math.min(1, ATTACH.PREVIEW_MAX_H / h, maxW / w);
  const width = Math.max(1, Math.round(w * scale));

  el.style.width = width + 'px';
  el.style.height = 'auto';
  el.style.aspectRatio = `${w} / ${h}`;

  img.style.width = width + 'px';
  img.style.height = 'auto';
  img.style.aspectRatio = `${w} / ${h}`;
}

function _styleImageChip(el, img) {
  Object.assign(el.style, {
    display: 'block',
    position: 'relative',
    flex: '0 0 auto',
    width: 'auto',
    height: 'auto',
    minWidth: '0',
    minHeight: '0',
    maxWidth: '100%',
    margin: '0',
    padding: '0',
    background: 'none',
    border: '0',
    boxShadow: 'none',
    borderRadius: '0',
    overflow: 'visible',
    lineHeight: '0'
  });

  Object.assign(img.style, {
    display: 'block',
    width: 'auto',
    height: 'auto',
    minWidth: '0',
    minHeight: '0',
    maxWidth: '100%',
    margin: '0',
    padding: '0',
    border: '0',
    background: 'none',
    borderRadius: '12px'
  });

  const rm = el.querySelector('.attach-remove');
  if (rm) {
    Object.assign(rm.style, {
      position: 'absolute',
      top: '5px',
      right: '5px',
      left: 'auto',
      bottom: 'auto',
      margin: '0',
      zIndex: '1'
    });
  }
}

function _resetImageChip(el) {
  el.style.cssText = '';
  const rm = el.querySelector('.attach-remove');
  if (rm) rm.style.cssText = '';
}

function _markChipReady(item) {
  const el = item.el;
  if (!el || !el.isConnected) return;

  el.classList.remove('is-loading');

  const spin = el.querySelector('.attach-spin');
  if (spin) spin.remove();

  if (item.kind !== 'image' || !item.data) return;

  const src = _previewFor(item);
  if (!src) return;

  const img = document.createElement('img');
  img.className = 'attach-preview-image';
  img.alt = item.name || 'Attached image';
  img.decoding = 'async';
  img.loading = 'eager';
  img.draggable = false;

  _styleImageChip(el, img);

  const dims = item.ctrl && item.ctrl.dims;
  if (dims && dims.w > 0 && dims.h > 0) {
    img.dataset.naturalWidth = String(dims.w);
    img.dataset.naturalHeight = String(dims.h);
    _fitPreview(el, img, dims.w, dims.h);
  }

  img.onerror = () => {
    const fallback = item.data && item.data.dataUrl;

    if (!fallback || img.dataset.fellBack === '1') {
      img.remove();
      _resetImageChip(el);
      return;
    }

    img.dataset.fellBack = '1';
    img.src = fallback;
  };

  img.onload = () => {
    if (!img.dataset.naturalWidth && img.naturalWidth) {
      img.dataset.naturalWidth = String(img.naturalWidth);
      img.dataset.naturalHeight = String(img.naturalHeight);
      _fitPreview(el, img, img.naturalWidth, img.naturalHeight);
    }
    el.classList.add('is-image-ready');
  };

  img.src = src;
  el.insertBefore(img, el.firstChild);
}

function _purgeStaleChips() {
  if (!attachList) return;

  Array.from(attachList.children).forEach((el) => {
    if (!_attachItems.some((it) => String(it.id) === el.dataset.id)) el.remove();
  });
}

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

  if (_reduced()) {
    done();
    return;
  }

  attachTray.addEventListener('transitionend', onEnd);
  timer = window.setTimeout(done, 380);   
}

function _removeAttachItem(item) {
  const i = _attachItems.indexOf(item);
  if (i === -1) return;

  item.ctrl.cancelled = true;           
  _attachItems.splice(i, 1);
  _revokePreview(item);

  
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
  _attachCleanupToken += 1;             

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

if (attachList) {
  
  const keepFocus = (e) => {
    if (e.target instanceof Element && e.target.closest('.attach-remove')) e.preventDefault();
  };

  attachList.addEventListener('pointerdown', keepFocus);
  attachList.addEventListener('mousedown', keepFocus);

  attachList.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;

    const chip = e.target.closest('.attach-chip');
    const item = chip ? _attachItems.find((it) => String(it.id) === chip.dataset.id) : null;
    if (!item) return;

    if (e.target.closest('.attach-remove')) {
      _removeAttachItem(item);
      return;
    }

    
    if (item.kind === 'image' && item.status === 'ready') _openImageViewer(_previewFor(item));
  });
}

if (attachList && typeof ResizeObserver === 'function') {
  let lastW = attachList.clientWidth;

  new ResizeObserver(() => {
    const w = attachList.clientWidth;
    if (w === lastW) return;
    lastW = w;

    attachList.querySelectorAll('.attach-preview-image').forEach((img) => {
      const nw = Number(img.dataset.naturalWidth);
      const nh = Number(img.dataset.naturalHeight);
      if (nw > 0 && nh > 0) _fitPreview(img.parentElement, img, nw, nh);
    });
  }).observe(attachList);
}

[['pmPhoto', 'fileInputPhoto'], ['pmCamera', 'fileInputCamera'], ['pmFile', 'fileInputFile']].forEach(([btnId, inputId]) => {
  const btn = document.getElementById(btnId);
  const fi = document.getElementById(inputId);
  if (!btn || !fi) return;

  btn.addEventListener('click', () => fi.click());

  fi.addEventListener('change', () => {
    const files = Array.from(fi.files || []);
    fi.value = '';                       
    _addAttachments(files);
  });
});

// Live composer uses the original image URL; HEIC/HEIF uses the prepared JPEG fallback.
function _previewFor(item) {
  if (item.kind !== 'image') return null;
  if (item.previewUrl) return item.previewUrl;

  const ext = String(item.name || '').toLowerCase().split('.').pop();
  const mime = String(item.file.type || '').toLowerCase();
  const heic = ext === 'heic' || ext === 'heif' || mime === 'image/heic' || mime === 'image/heif';

  if (heic) {
    const d = item.data && item.data.dataUrl;
    if (!d) return null;
    try {
      const bin = atob(d.slice(d.indexOf(',') + 1));
      const u8 = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
      item.previewUrl = URL.createObjectURL(new Blob([u8], { type: 'image/jpeg' }));
      return item.previewUrl;
    } catch (_) { return null; }
  }

  item.previewUrl = URL.createObjectURL(item.file);
  return item.previewUrl;
}

function _revokePreview(item) {
  if (item.previewUrl) {
    try { URL.revokeObjectURL(item.previewUrl); } catch (_) {}
    item.previewUrl = null;
  }
}

function _createImageAttachment(opts) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-att-image';

  if (opts.width && opts.height) {
    wrap.style.setProperty('--w', opts.width);
    wrap.style.setProperty('--h', opts.height);
  }

  const img = new Image();
  img.className = 'msg-att-img';
  img.alt = opts.alt || '';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.draggable = false;
  img.dataset.full = opts.fullSrc || opts.src;
  if (opts.thumb) img.dataset.thumb = opts.thumb;   

  img.onload = () => {
    if (!img.dataset.fellBack && !(opts.width && opts.height) && img.naturalWidth) {
      wrap.style.setProperty('--w', img.naturalWidth);
      wrap.style.setProperty('--h', img.naturalHeight);
    }
    wrap.classList.add('is-loaded');
  };

  img.onerror = () => {
    if (_useThumbFallback(img)) return;
    wrap.classList.add('is-error');
    wrap.textContent = 'Image unavailable';
  };

  img.src = opts.src;
  wrap.appendChild(img);
  return wrap;
}

function _useThumbFallback(img) {
  const wrap = img.closest('.msg-att-image');
  const t = img.dataset.thumb;
  if (!wrap || !t || img.dataset.fellBack === '1') return false;

  img.dataset.fellBack = '1';
  wrap.style.setProperty('--w', 1);
  wrap.style.setProperty('--h', 1);
  wrap.classList.remove('is-loaded');
  img.dataset.full = t;
  img.src = t;
  return true;
}

function _rehydrateImages(root) {
  (root || document).querySelectorAll('.msg-att-image .msg-att-img').forEach((img) => {
    const wrap = img.closest('.msg-att-image');

    img.onload = () => wrap.classList.add('is-loaded');
    img.onerror = () => {
      if (_useThumbFallback(img)) return;
      wrap.classList.add('is-error');
      wrap.textContent = 'Image unavailable';
    };

    if (img.complete && !img.naturalWidth && img.getAttribute('src')) img.onerror();
  });
}

let _viewer = null;

function _openImageViewer(src) {
  if (_viewer || !src) return;

  const root = document.createElement('div');
  root.id = 'imgViewer';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML =
    '<div class="iv-stage"><img alt="" draggable="false"></div>' +
    '<button class="iv-close" type="button" aria-label="Close">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';

  
  ['pointerdown', 'pointerup', 'mousedown', 'click', 'touchstart', 'touchend'].forEach((t) => {
    root.addEventListener(t, (e) => e.stopPropagation());
  });

  document.body.appendChild(root);

  const stage = root.querySelector('.iv-stage');
  const img = stage.querySelector('img');
  img.src = src;

  const MAX = 6;
  const ptrs = new Map();
  let s = 1, tx = 0, ty = 0;
  let pinch = null, pan = null, down = null, lastTap = null;

  const apply = () => { img.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; };

  const clamp = () => {
    if (s <= 1) { s = 1; tx = ty = 0; return; }
    const mx = Math.max(0, (img.offsetWidth * s - stage.clientWidth) / 2);
    const my = Math.max(0, (img.offsetHeight * s - stage.clientHeight) / 2);
    tx = Math.min(mx, Math.max(-mx, tx));
    ty = Math.min(my, Math.max(-my, ty));
  };

  const center = () => {
    const r = stage.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  
  const zoomAt = (newS, fx, fy) => {
    newS = Math.min(MAX, Math.max(1, newS));
    const c = center();
    const px = (fx - c.x - tx) / s;
    const py = (fy - c.y - ty) / s;
    s = newS;
    tx = fx - c.x - px * s;
    ty = fy - c.y - py * s;
    clamp();
    apply();
  };

  const onResize = () => { if (_viewer === root) { clamp(); apply(); } };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };

  function close() {
    if (_viewer !== root) return;
    _viewer = null;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    root.classList.remove('open');
    setTimeout(() => root.remove(), _reduced() ? 0 : 180);
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  stage.addEventListener('pointerdown', (e) => {
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (ptrs.size === 1) {
      down = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false, target: e.target };
      pan = { x: e.clientX, y: e.clientY, tx, ty };
    } else if (ptrs.size === 2) {
      const p = Array.from(ptrs.values());
      pinch = { d: dist(p[0], p[1]), s, tx, ty, m: mid(p[0], p[1]) };
      down = null; pan = null; lastTap = null;
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && ptrs.size >= 2) {
      const p = Array.from(ptrs.values());
      const d = dist(p[0], p[1]);
      const m = mid(p[0], p[1]);
      const c = center();
      const px = (pinch.m.x - c.x - pinch.tx) / pinch.s;
      const py = (pinch.m.y - c.y - pinch.ty) / pinch.s;
      s = Math.min(MAX, Math.max(1, pinch.s * d / pinch.d));
      tx = m.x - c.x - px * s;
      ty = m.y - c.y - py * s;
      clamp();
      apply();
    } else if (pan && ptrs.size === 1) {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) down.moved = true;
      if (s > 1) {
        tx = pan.tx + (e.clientX - pan.x);
        ty = pan.ty + (e.clientY - pan.y);
        clamp();
        apply();
      }
    }
  });

  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;

    if (ptrs.size === 1) {              
      const r = Array.from(ptrs.values())[0];
      pan = { x: r.x, y: r.y, tx, ty };
      down = null;
      return;
    }

    if (ptrs.size === 0) {
      pan = null;

      if (e.type === 'pointerup' && down && !down.moved && Date.now() - down.t < 300) {
        const onImg = down.target === img;
        const now = Date.now();

        if (onImg && lastTap && now - lastTap.t < 300 &&
            Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
          lastTap = null;
          zoomAt(s > 1.05 ? 1 : 2.5, e.clientX, e.clientY);      
        } else if (!onImg) {
          close();                                               
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
      }
      down = null;
    }
  };

  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(s * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });

  root.querySelector('.iv-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);

  _viewer = root;
  requestAnimationFrame(() => root.classList.add('open'));
}

// Sent-message image rendering remains on its existing path.
document.addEventListener('click', (e) => {
  const img = e.target instanceof Element ? e.target.closest('.msg-att-img') : null;
  if (!img || img.closest('.msg-att-image.is-error')) return;

  e.preventDefault();
  _openImageViewer(img.dataset.full || img.currentSrc || img.src);
});

function _debugImages() {
  const rows = Array.from(document.querySelectorAll('.msg img, .msg-attachments img'))
    .filter((i) => !i.closest('.attach-chip'))
    .map((i) => {
      const r = i.getBoundingClientRect();
      const cs = i.currentSrc || i.src || '';
      return {
        cls: i.className,
        rendered: Math.round(r.width) + '×' + Math.round(r.height),
        natural: i.naturalWidth + '×' + i.naturalHeight,
        attrWH: (i.getAttribute('width') || '-') + '×' + (i.getAttribute('height') || '-'),
        src: cs.indexOf('data:') === 0 ? 'data-url ' + Math.round(cs.length / 1024) + 'KB'
          : cs.indexOf('blob:') === 0 ? 'blob (original)' : 'url'
      };
    });

  if (window.console && console.table) console.table(rows);

  const last = rows[rows.length - 1];
  if (last) _showAttachNotice(`img natural ${last.natural}, shown ${last.rendered}, ${last.src}`);
  else _showAttachNotice('No message images found.');

  return rows;
}

window.AtkynAttach = {
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
  notify: _showAttachNotice,

  
  getReadyPreviews() {
    if (!_onAiTab()) return [];
    return _attachItems
      .filter((it) => it.status === 'ready' && it.data)
      .map((it) => {
        const d = it.ctrl.dims;
        return it.kind === 'image'
          ? { type: 'image', name: it.name, url: _previewFor(it), width: d ? d.w : 0, height: d ? d.h : 0 }
          : { type: it.data.type, name: it.name };
      });
  },
  createImageAttachment: _createImageAttachment,   
  openImage: _openImageViewer,
  rehydrateImages: _rehydrateImages,
  debugImages: _debugImages
};

if (pill && typeof MutationObserver === 'function') {
  let _lastOnAi = _onAiTab();

  new MutationObserver(() => {
    const now = _onAiTab();
    if (now === _lastOnAi) return;
    _lastOnAi = now;
    _syncAttachUI();
  }).observe(pill, { attributes: true, attributeFilter: ['class'] });
}

function _syncPlusMenuOffset() {
  if (!plusMenu || !pill) return;

  const ph = Math.round(pill.getBoundingClientRect().height);
  if (ph > 0) plusMenu.style.setProperty('--pill-h', ph + 'px');
}

if (pill && typeof ResizeObserver === 'function') {
  new ResizeObserver(_syncPlusMenuOffset).observe(pill);
}
_syncPlusMenuOffset();

if (attachTray) {
  attachTray.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
}

})();
