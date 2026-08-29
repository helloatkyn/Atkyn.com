/* ═══════════════════════════════════════════════════════════════
   functions/api/maps.js — Atkyn Maps API (Cloudflare Pages Function)
   Geocodes the query, fetches nearby places via Geoapify Places API
   Returns JSON: { center, places[] }
   ═══════════════════════════════════════════════════════════════ */

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { query } = await request.json();
    if (!query) return json({ error: 'No query' }, 400, corsHeaders);

    const GEO_KEY = env.GEOAPIFY_API_KEY;
    if (!GEO_KEY) return json({ error: 'Missing API key' }, 500, corsHeaders);

    /* ── Step 1: Geocode the query to get lat/lon ── */
    const geoUrl = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}&limit=1&apiKey=${GEO_KEY}`;
    const geoResp = await fetch(geoUrl);
    const geoData = await geoResp.json();

    let center = null;
    const firstFeature = geoData?.features?.[0];
    if (firstFeature) {
      const [lon, lat] = firstFeature.geometry.coordinates;
      center = { lat, lon, label: firstFeature.properties?.formatted || query };
    }

    /* ── Step 2: Fetch nearby places ── */
    let places = [];
    if (center) {
      const categories = detectCategories(query);
      const placesUrl = `https://api.geoapify.com/v2/places?categories=${categories}&filter=circle:${center.lon},${center.lat},2000&limit=10&apiKey=${GEO_KEY}`;
      const placesResp = await fetch(placesUrl);
      const placesData = await placesResp.json();

      places = (placesData?.features || []).map(f => {
        const p = f.properties;
        return {
          name:       p.name       || p.formatted || 'Unknown',
          address:    p.formatted  || '',
          category:   p.categories?.[0] || '',
          lat:        f.geometry.coordinates[1],
          lon:        f.geometry.coordinates[0],
          distance:   p.distance   || null,
          phone:      p.contact?.phone || null,
          website:    p.website    || null,
          opening:    p.opening_hours || null,
        };
      });
    }

    /* ── Fallback: if no geocoded center, just search places by text ── */
    if (!center && !places.length) {
      const textUrl = `https://api.geoapify.com/v2/places?text=${encodeURIComponent(query)}&limit=10&apiKey=${GEO_KEY}`;
      const textResp = await fetch(textUrl);
      const textData = await textResp.json();
      const features = textData?.features || [];
      if (features.length) {
        const first = features[0];
        center = {
          lat: first.geometry.coordinates[1],
          lon: first.geometry.coordinates[0],
          label: query,
        };
        places = features.map(f => {
          const p = f.properties;
          return {
            name:     p.name     || p.formatted || 'Unknown',
            address:  p.formatted || '',
            category: p.categories?.[0] || '',
            lat:      f.geometry.coordinates[1],
            lon:      f.geometry.coordinates[0],
            distance: p.distance || null,
            phone:    p.contact?.phone || null,
            website:  p.website  || null,
            opening:  p.opening_hours || null,
          };
        });
      }
    }

    return json({ center, places }, 200, corsHeaders);

  } catch (err) {
    return json({ error: err.message || 'Internal error' }, 500, corsHeaders);
  }
}

/* ── helpers ── */
function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

/* Map common query words to Geoapify category strings */
function detectCategories(query) {
  const q = query.toLowerCase();
  if (/restaurant|food|eat|dining|biryani|pizza|burger|cafe|coffee/.test(q))
    return 'catering.restaurant,catering.cafe,catering.fast_food';
  if (/hotel|stay|lodge|motel|hostel/.test(q))
    return 'accommodation.hotel,accommodation.hostel';
  if (/hospital|clinic|doctor|pharmacy|medical/.test(q))
    return 'healthcare.hospital,healthcare.clinic,healthcare.pharmacy';
  if (/petrol|fuel|gas station|cng/.test(q))
    return 'service.vehicle.fuel';
  if (/gym|fitness|workout/.test(q))
    return 'sport.fitness';
  if (/school|college|university/.test(q))
    return 'education.school,education.college,education.university';
  if (/bank|atm/.test(q))
    return 'financial.bank,financial.atm';
  if (/park|garden/.test(q))
    return 'leisure.park';
  if (/shop|store|mall|market/.test(q))
    return 'commercial.shopping_mall,commercial.supermarket';
  /* default: broad POI */
  return 'catering,accommodation,commercial,service,leisure';
}
