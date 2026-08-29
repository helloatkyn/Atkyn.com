/* ═══════════════════════════════════════════════════════════════
   maps-card.js — Atkyn Map Card (Answer Tab)
   Uses OpenStreetMap iframe embed — zero API key, zero dependencies.
   _renderMapCard(data, query) is called from search.js SSE onMap handler.
   ═══════════════════════════════════════════════════════════════ */

/* ── Render the map card bubble ── */
function _renderMapCard(data, query) {
  const { center, places } = data;
  if (!center) return;

  /* Outer msg wrapper */
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  wrap.style.cssText = 'opacity:0;transform:translateY(6px);transition:opacity 0.22s ease-out,transform 0.22s ease-out';

  const card = document.createElement('div');
  card.className = 'map-card';

  /* ── OSM iframe embed ── */
  const mapWrap = document.createElement('div');
  mapWrap.className = 'map-container';
  mapWrap.style.cssText = 'position:relative;width:100%;height:220px;border-radius:12px;overflow:hidden;background:#1a1a1a;';

  /* Build bbox around center (roughly 2km box) */
  const delta = 0.018;
  const bbox  = [
    center.lon - delta,
    center.lat - delta,
    center.lon + delta,
    center.lat + delta,
  ].join('%2C');

  /* Build marker list for OSM embed (up to 5 places) */
  const markerPlaces = (places || []).slice(0, 5);
  let markerParam = `&marker=${center.lat}%2C${center.lon}`;
  markerPlaces.forEach(p => {
    markerParam += `&marker=${p.lat}%2C${p.lon}`;
  });

  const osmSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik${markerParam}`;

  const iframe = document.createElement('iframe');
  iframe.src              = osmSrc;
  iframe.width            = '100%';
  iframe.height           = '220';
  iframe.frameBorder      = '0';
  iframe.scrolling        = 'no';
  iframe.marginHeight     = '0';
  iframe.marginWidth      = '0';
  iframe.loading          = 'lazy';
  iframe.style.cssText    = 'border:none;border-radius:12px;display:block;';
  iframe.setAttribute('title', 'Map');
  iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');

  /* OSM link overlay (bottom right) */
  const osmLink = document.createElement('a');
  osmLink.href        = `https://www.openstreetmap.org/?mlat=${center.lat}&mlon=${center.lon}#map=15/${center.lat}/${center.lon}`;
  osmLink.target      = '_blank';
  osmLink.rel         = 'noopener noreferrer';
  osmLink.textContent = '© OpenStreetMap';
  osmLink.style.cssText = 'position:absolute;bottom:4px;right:6px;font-size:10px;opacity:0.6;color:inherit;text-decoration:none;z-index:2;pointer-events:auto;';

  mapWrap.appendChild(iframe);
  mapWrap.appendChild(osmLink);
  card.appendChild(mapWrap);

  /* ── Places list ── */
  if (places && places.length) {
    const list = document.createElement('div');
    list.className = 'map-places-list';
    list.style.cssText = 'margin-top:10px;display:flex;flex-direction:column;gap:8px;';
    places.forEach((p, i) => {
      list.appendChild(_buildPlaceItem(p, i));
    });
    card.appendChild(list);
  }

  wrap.appendChild(card);

  /* Insert before typing indicator */
  const typingEl = msgWrap.querySelector('.bubble.typing')?.closest('.msg');
  if (typingEl) {
    msgWrap.insertBefore(wrap, typingEl);
  } else {
    msgWrap.appendChild(wrap);
  }

  /* Animate in */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      wrap.style.opacity   = '1';
      wrap.style.transform = '';
      if (typeof scrollToMsg === 'function') scrollToMsg(wrap);
    });
  });
}

/* ── Build one place row ── */
function _buildPlaceItem(place, index) {
  const item = document.createElement('div');
  item.className = 'map-place-item';
  item.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.04);';

  const num = document.createElement('div');
  num.className = 'map-place-num';
  num.textContent = index + 1;
  num.style.cssText = 'min-width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0;margin-top:1px;';

  const info = document.createElement('div');
  info.className = 'map-place-info';
  info.style.cssText = 'flex:1;min-width:0;';

  const cat  = _formatCategory(place.category);
  const dist = place.distance ? _formatDist(place.distance) : '';

  const name = document.createElement('div');
  name.className   = 'map-place-name';
  name.textContent = place.name || 'Unknown';
  name.style.cssText = 'font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

  const meta = document.createElement('div');
  meta.className = 'map-place-meta';
  meta.style.cssText = 'font-size:11px;opacity:0.55;margin-top:2px;display:flex;gap:6px;flex-wrap:wrap;';
  if (cat)  { const s = document.createElement('span'); s.textContent = cat;  meta.appendChild(s); }
  if (dist) { const s = document.createElement('span'); s.textContent = dist; meta.appendChild(s); }

  info.appendChild(name);
  if (cat || dist) info.appendChild(meta);

  if (place.address) {
    const addr = document.createElement('div');
    addr.className   = 'map-place-addr';
    addr.textContent = place.address;
    addr.style.cssText = 'font-size:11px;opacity:0.45;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    info.appendChild(addr);
  }

  item.appendChild(num);
  item.appendChild(info);

  if (place.website) {
    const link = document.createElement('a');
    link.href   = place.website;
    link.target = '_blank';
    link.rel    = 'noopener noreferrer';
    link.style.cssText = 'flex-shrink:0;opacity:0.5;display:flex;align-items:center;margin-top:2px;';
    link.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    item.appendChild(link);
  }

  return item;
}

/* ── Utils ── */
function _formatDist(meters) {
  return meters < 1000
    ? Math.round(meters) + ' m'
    : (meters / 1000).toFixed(1) + ' km';
}

function _formatCategory(cat) {
  if (!cat) return '';
  return cat
    .split('.').pop()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
