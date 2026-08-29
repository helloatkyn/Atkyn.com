/* ═══════════════════════════════════════════════════════════════
   maps-card.js — Atkyn Map Card (Answer Tab)
   Renders an inline map + place cards in the chat stream,
   exactly like _renderStockCard / _renderWebCards pattern.
   Requires: Leaflet loaded via CDN (added to index.html)
   ═══════════════════════════════════════════════════════════════ */

/* ── Detect if query is map-worthy ── */
function _isMapQuery(q) {
  if (!q) return false;
  return /near me|nearby|near |restaurants?|hotels?|cafes?|coffee|hospital|clinic|pharmacy|atm|bank|park|gym|petrol|fuel|shops?|mall|school|college|university|directions?|where is|located|location of|map of|places in|things to do in/i.test(q);
}

/* ── Main entry: called from send() after typing starts ── */
async function _tryRenderMapCard(query) {
  if (!_isMapQuery(query)) return;

  try {
    const resp = await fetch('/api/maps', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data.center && !data.places?.length) return;

    _renderMapCard(data, query);
  } catch (_) {}
}

/* ── Render the map card bubble ── */
function _renderMapCard(data, query) {
  const { center, places } = data;
  if (!center) return;

  /* Outer msg wrapper — same as stock/web cards */
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  wrap.style.cssText = 'opacity:0;transform:translateY(6px);transition:opacity 0.22s ease-out,transform 0.22s ease-out';

  const card = document.createElement('div');
  card.className = 'map-card';

  /* ── Map container ── */
  const mapEl = document.createElement('div');
  mapEl.className = 'map-container';
  const mapId = 'atkyn-map-' + Date.now();
  mapEl.id = mapId;
  card.appendChild(mapEl);

  /* ── Places list ── */
  if (places && places.length) {
    const list = document.createElement('div');
    list.className = 'map-places-list';
    places.forEach((p, i) => {
      const item = _buildPlaceItem(p, i);
      list.appendChild(item);
    });
    card.appendChild(list);
  }

  wrap.appendChild(card);

  /* Insert before typing indicator so it appears in flow */
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
      scrollToMsg(wrap);
    });
  });

  /* Init Leaflet map after DOM paint */
  requestAnimationFrame(() => {
    _initLeafletMap(mapId, center, places || []);
  });
}

/* ── Leaflet map init ── */
function _initLeafletMap(mapId, center, places) {
  if (!window.L) { console.warn('Leaflet not loaded'); return; }

  const map = L.map(mapId, {
    center:          [center.lat, center.lon],
    zoom:            14,
    zoomControl:     true,
    attributionControl: false,
    scrollWheelZoom: false,
  });

  /* Tile layer — CartoDB light (no API key, looks clean) */
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);

  /* Center marker */
  const centerIcon = L.divIcon({
    className: 'map-pin-center',
    html: `<div class="map-pin-dot"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
  L.marker([center.lat, center.lon], { icon: centerIcon })
   .addTo(map)
   .bindPopup(`<b>${_esc(center.label)}</b>`);

  /* Place markers */
  places.forEach((p, i) => {
    const icon = L.divIcon({
      className: 'map-pin-place',
      html: `<div class="map-pin-num">${i + 1}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    L.marker([p.lat, p.lon], { icon })
     .addTo(map)
     .bindPopup(`<b>${_esc(p.name)}</b><br><span style="font-size:12px;opacity:.7">${_esc(p.address)}</span>`);
  });

  /* Fit bounds to all markers */
  if (places.length > 0) {
    const allPoints = [[center.lat, center.lon], ...places.map(p => [p.lat, p.lon])];
    map.fitBounds(allPoints, { padding: [32, 32] });
  }

  /* Fix map rendering inside flex/hidden containers */
  setTimeout(() => map.invalidateSize(), 120);
}

/* ── Build one place row ── */
function _buildPlaceItem(place, index) {
  const item = document.createElement('div');
  item.className = 'map-place-item';

  const cat = _formatCategory(place.category);
  const dist = place.distance ? _formatDist(place.distance) : '';

  item.innerHTML = `
    <div class="map-place-num">${index + 1}</div>
    <div class="map-place-info">
      <div class="map-place-name">${_esc(place.name)}</div>
      <div class="map-place-meta">
        ${cat ? `<span class="map-place-cat">${_esc(cat)}</span>` : ''}
        ${dist ? `<span class="map-place-dist">${_esc(dist)}</span>` : ''}
      </div>
      ${place.address ? `<div class="map-place-addr">${_esc(place.address)}</div>` : ''}
    </div>
    ${place.website ? `<a class="map-place-link" href="${_esc(place.website)}" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
    </a>` : ''}
  `;

  return item;
}

/* ── Tiny utils ── */
function _esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

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
