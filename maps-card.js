/* ═══════════════════════════════════════════════════════════════
   maps-card.js — Atkyn Map Card (Answer Tab)
   Uses Leaflet (already loaded in index.html) — no API key needed.
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

  /* ── Map container — Leaflet renders here ── */
  const mapWrap = document.createElement('div');
  mapWrap.className = 'map-container';

  const mapDiv = document.createElement('div');
  /* Give it a unique ID so Leaflet doesn't conflict if multiple cards exist */
  mapDiv.id = 'atkyn-map-' + Date.now();
  mapDiv.style.cssText = 'width:100%;height:220px;border-radius:12px 12px 0 0;';
  mapWrap.appendChild(mapDiv);
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

  /* Animate in, then init Leaflet (must be in DOM first) */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      wrap.style.opacity   = '1';
      wrap.style.transform = '';
      if (typeof scrollToMsg === 'function') scrollToMsg(wrap);

      /* ── Init Leaflet map ── */
      if (typeof L === 'undefined') {
        /* Leaflet not loaded yet — show fallback link */
        mapDiv.innerHTML =
          `<a href="https://maps.google.com/maps?q=${encodeURIComponent(query || center.label || '')}"
              target="_blank" rel="noopener noreferrer"
              style="display:flex;align-items:center;justify-content:center;height:100%;
                     color:#4a90e2;font-size:14px;text-decoration:none;gap:6px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                 stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            Open in Google Maps
          </a>`;
        return;
      }

      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

      const map = L.map(mapDiv.id, {
        zoomControl:       true,
        attributionControl: true,
        scrollWheelZoom:   false,   /* don't hijack page scroll */
        dragging:          true,
        tap:               true,
      }).setView([center.lat, center.lon], 14);

      /* Tile layer — OSM, no API key, forever free */
      L.tileLayer(
        isDark
          ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
          : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
          subdomains:  'abcd',
          maxZoom:     19,
        }
      ).addTo(map);

      /* ── Markers ── */
      const bounds = [];

      if (places && places.length) {
        /* Numbered circle markers matching the places list */
        places.forEach((p, i) => {
          if (!p.lat || !p.lon) return;

          const icon = L.divIcon({
            className: '',
            html: `<div style="
              width:24px;height:24px;border-radius:50%;
              background:#ff4b4b;color:#fff;
              font-size:11px;font-weight:700;font-family:system-ui,sans-serif;
              display:flex;align-items:center;justify-content:center;
              box-shadow:0 2px 6px rgba(0,0,0,0.35);
              border:2px solid #fff;
            ">${i + 1}</div>`,
            iconSize:   [24, 24],
            iconAnchor: [12, 12],
            popupAnchor:[0, -14],
          });

          const popup = L.popup({ closeButton: false, offset: [0, -4] })
            .setContent(`
              <div style="font-family:system-ui,sans-serif;min-width:120px">
                <div style="font-weight:600;font-size:13px;margin-bottom:2px">${_esc(p.name || 'Unknown')}</div>
                ${p.address ? `<div style="font-size:11px;color:#888">${_esc(p.address)}</div>` : ''}
              </div>`);

          L.marker([p.lat, p.lon], { icon }).addTo(map).bindPopup(popup);
          bounds.push([p.lat, p.lon]);
        });

        /* Fit map to all markers with padding */
        if (bounds.length > 1) {
          map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
        }
      } else {
        /* No places — just show center with a pin */
        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:20px;height:20px;border-radius:50%;
            background:#4a90e2;
            box-shadow:0 2px 6px rgba(0,0,0,0.35);
            border:2.5px solid #fff;
          "></div>`,
          iconSize:   [20, 20],
          iconAnchor: [10, 10],
        });
        L.marker([center.lat, center.lon], { icon })
          .addTo(map)
          .bindPopup(`<div style="font-family:system-ui,sans-serif;font-weight:600;font-size:13px">${_esc(center.label || query || 'Location')}</div>`)
          .openPopup();
      }

      /* Invalidate size after animation completes so tiles render correctly */
      setTimeout(() => map.invalidateSize(), 300);
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
    if (cat)  {
      const s = document.createElement('span');
      s.className   = 'map-place-cat';
      s.textContent = cat;
      meta.appendChild(s);
    }
    if (dist) {
      const s = document.createElement('span');
      s.className   = 'map-place-dist';
      s.textContent = dist;
      meta.appendChild(s);
    }
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
  return meters < 1000
    ? Math.round(meters) + ' m'
    : (meters / 1000).toFixed(1) + ' km';
}

function _formatCategory(cat) {
  if (!cat) return '';
  return cat.split('.').pop().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
