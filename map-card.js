/* ═══════════════════════════════════════════════════════════════
   maps-card.js — Atkyn Map Card (Answer Tab)
   Google Maps legacy embed — no API key, unlimited, free forever.
   _renderMapCard(data, query) called from search.js SSE onMap handler.
   ═══════════════════════════════════════════════════════════════ */

function _renderMapCard(data, query) {
  const { center, places } = data;
  if (!center) return;

  /* ── Outer wrapper ── */
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  wrap.style.cssText = 'opacity:0;transform:translateY(6px);transition:opacity 0.22s ease-out,transform 0.22s ease-out';

  const card = document.createElement('div');
  card.className = 'map-card';

  /* ── Google Maps legacy iframe — no API key needed ── */
  const mapWrap = document.createElement('div');
  mapWrap.className = 'map-container';

  /* Build search query: use first place name + center label for accuracy */
  const mapQuery = query
    ? encodeURIComponent(query)
    : encodeURIComponent(center.label || 'map');

  /* Legacy embed endpoint — free, unlimited, works since 2014 */
  const gmSrc = `https://maps.google.com/maps?q=${mapQuery}&t=m&z=15&output=embed&iwloc=near`;

  const iframe = document.createElement('iframe');
  iframe.src           = gmSrc;
  iframe.width         = '100%';
  iframe.height        = '220';
  iframe.style.cssText = 'border:none;display:block;width:100%;height:220px;border-radius:12px 12px 0 0;';
  iframe.loading       = 'lazy';
  iframe.allowFullscreen = true;
  iframe.setAttribute('title', 'Map');
  iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');

  mapWrap.appendChild(iframe);
  card.appendChild(mapWrap);

  /* ── Places list ── */
  if (places && places.length) {
    const list = document.createElement('div');
    list.className = 'map-places-list';
    places.forEach((p, i) => list.appendChild(_buildPlaceItem(p, i)));
    card.appendChild(list);
  }

  wrap.appendChild(card);

  /* Insert before typing indicator */
  const typingEl = msgWrap.querySelector('.bubble.typing')?.closest('.msg');
  if (typingEl) msgWrap.insertBefore(wrap, typingEl);
  else          msgWrap.appendChild(wrap);

  /* Animate in */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      wrap.style.opacity   = '1';
      wrap.style.transform = '';
      if (typeof scrollToMsg === 'function') scrollToMsg(wrap);
    });
  });
}

/* ── Single place row ── */
function _buildPlaceItem(place, index) {
  const item = document.createElement('div');
  item.className = 'map-place-item';

  const num = document.createElement('div');
  num.className   = 'map-place-num';
  num.textContent = index + 1;

  const info = document.createElement('div');
  info.className = 'map-place-info';

  const name = document.createElement('div');
  name.className   = 'map-place-name';
  name.textContent = place.name || 'Unknown';

  info.appendChild(name);

  const cat  = _formatCategory(place.category);
  const dist = place.distance ? _formatDist(place.distance) : '';
  if (cat || dist) {
    const meta = document.createElement('div');
    meta.className = 'map-place-meta';
    if (cat)  { const s = document.createElement('span'); s.className = 'map-place-cat';  s.textContent = cat;  meta.appendChild(s); }
    if (dist) { const s = document.createElement('span'); s.className = 'map-place-dist'; s.textContent = dist; meta.appendChild(s); }
    info.appendChild(meta);
  }

  if (place.address) {
    const addr = document.createElement('div');
    addr.className   = 'map-place-addr';
    addr.textContent = place.address;
    info.appendChild(addr);
  }

  item.appendChild(num);
  item.appendChild(info);

  if (place.website) {
    const link = document.createElement('a');
    link.href      = place.website;
    link.target    = '_blank';
    link.rel       = 'noopener noreferrer';
    link.className = 'map-place-link';
    link.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    item.appendChild(link);
  }

  return item;
}

/* ── Utils ── */
function _formatDist(meters) {
  return meters < 1000 ? Math.round(meters) + ' m' : (meters / 1000).toFixed(1) + ' km';
}

function _formatCategory(cat) {
  if (!cat) return '';
  return cat.split('.').pop().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
