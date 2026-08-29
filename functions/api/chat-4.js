import { SYSTEM_PROMPT } from './systemPrompt.js';

function validateToolArgs(toolName, rawArgs) {
  if (toolName === 'web_search') {
    if (!rawArgs.query || typeof rawArgs.query !== 'string') {
      throw new Error('Missing or invalid "query". Must be a string.');
    }
    const cleanQuery = rawArgs.query.trim();
    if (cleanQuery.length < 2) {
      throw new Error('Query is too short. Must be at least 2 characters.');
    }
    return { query: cleanQuery };
  }

  if (toolName === 'stock_data') {
    if (!rawArgs.symbol || typeof rawArgs.symbol !== 'string') {
      throw new Error('Missing or invalid "symbol". Must be a string.');
    }
    const cleanSymbol = rawArgs.symbol.trim().toUpperCase();
    if (cleanSymbol.length < 1 || cleanSymbol.length > 10) {
      throw new Error('Invalid stock symbol length. Must be 1-10 characters.');
    }
    for (let i = 0; i < cleanSymbol.length; i++) {
      const char = cleanSymbol.charCodeAt(i);
      const isAlpha = (char >= 65 && char <= 90);
      const isNum   = (char >= 48 && char <= 57);
      if (!isAlpha && !isNum) {
        throw new Error('Stock symbol must contain only letters and numbers.');
      }
    }
    return { symbol: cleanSymbol };
  }

  if (toolName === 'maps_search') {
    if (!rawArgs.query || typeof rawArgs.query !== 'string') {
      throw new Error('Missing or invalid "query". Must be a string.');
    }
    const cleanQuery = rawArgs.query.trim();
    if (cleanQuery.length < 2) {
      throw new Error('Query is too short. Must be at least 2 characters.');
    }
    return { query: cleanQuery };
  }

  throw new Error(`Unknown tool requested: ${toolName}`);
}

async function fetchPageText(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AtkynBot/1.0)' },
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok || !resp.headers.get('content-type')?.includes('text/html')) {
      return '';
    }
    const html = await resp.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
  } catch {
    return '';
  }
}

async function executeSearXNG(searchQuery, searxngUrl) {
  try {
    const searxResp = await fetch(
      `${searxngUrl}/search?q=${encodeURIComponent(searchQuery)}&format=json&categories=general&language=en`,
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(5000) }
    );

    if (!searxResp.ok) return [];
    const data = await searxResp.json();
    const raw  = (data.results || []).slice(0, 5);

    const enriched = await Promise.all(
      raw.map(async (r) => {
        let content = r.content || 'No snippet available.';
        const pageText = await fetchPageText(r.url);
        if (pageText && pageText.length > 100) content = pageText;
        return {
          title:   r.title || 'Untitled',
          url:     r.url   || '#',
          snippet: content,
        };
      })
    );
    return enriched.filter(r => r.url !== '#');
  } catch {
    return [];
  }
}

async function executeStockData(symbol, finnhubApiKey) {
  const base  = 'https://finnhub.io/api/v1';
  const token = `token=${finnhubApiKey}`;

  try {
    const [quoteResp, profileResp, metricResp] = await Promise.all([
      fetch(`${base}/quote?symbol=${symbol}&${token}`,                    { signal: AbortSignal.timeout(4000) }),
      fetch(`${base}/stock/profile2?symbol=${symbol}&${token}`,           { signal: AbortSignal.timeout(4000) }),
      fetch(`${base}/stock/metric?symbol=${symbol}&metric=all&${token}`,  { signal: AbortSignal.timeout(4000) }),
    ]);

    if (!quoteResp.ok) throw new Error('Quote API failed');

    const q = await quoteResp.json();
    const p = (await profileResp.json()) || {};
    const m = ((await metricResp.json()) || {}).metric || {};

    if (q.c === 0 && q.d === 0 && q.dp === 0) {
      throw new Error(`Symbol '${symbol}' not found or market is closed with no data.`);
    }

    const marketCapM = p.marketCapitalization || 0;
    let marketCapStr = 'N/A';
    if (marketCapM >= 1_000_000) marketCapStr = `$${(marketCapM / 1_000_000).toFixed(2)}T`;
    else if (marketCapM >= 1_000) marketCapStr = `$${(marketCapM / 1_000).toFixed(2)}B`;
    else if (marketCapM > 0)     marketCapStr = `$${marketCapM.toFixed(2)}M`;

    return {
      ticker:    symbol,
      name:      p.name     || symbol,
      exchange:  p.exchange || 'Unknown',
      logo:      p.logo     || '',
      currency:  p.currency || 'USD',
      marketCap: marketCapStr,
      price:     q.c  ?? 0,
      change:    q.d  ?? 0,
      changePct: q.dp ?? 0,
      open:      q.o  ?? 0,
      high:      q.h  ?? 0,
      low:       q.l  ?? 0,
      prevClose: q.pc ?? 0,
      pe:        m['peNormalizedAnnual'] ?? m['peTTM'] ?? null,
      eps:       m['epsNormalizedAnnual'] ?? m['epsTTM'] ?? null,
      series:    [],
    };
  } catch (err) {
    return { error: true, message: `Failed to fetch data for ${symbol}: ${err.message}` };
  }
}

/* ══════════════════════════════════════════════════════════════
   executeMapsSearch — Nominatim (geocoding) + Overpass (POIs)
   100% free · zero API key · no env var needed
   ══════════════════════════════════════════════════════════════ */
async function executeMapsSearch(query) {
  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  const OVERPASS  = 'https://overpass-api.de/api/interpreter';
  const UA        = 'Atkyn/1.0 (contact@canacot.com)';

  try {
    /* ── Step 1: Geocode query → lat/lon ── */
    const nomUrl  = `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
    const nomResp = await fetch(nomUrl, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(5000),
    });
    if (!nomResp.ok) throw new Error(`Nominatim HTTP ${nomResp.status}`);

    const nomData = await nomResp.json();
    if (!nomData.length) return { error: true, message: 'Location not found for: ' + query };

    const { lat, lon, display_name } = nomData[0];
    const center = { lat: parseFloat(lat), lon: parseFloat(lon), label: display_name };

    /* ── Step 2: Detect OSM tag ── */
    const osmTag = detectOsmTag(query);

    /* ── Step 3: Nearby POIs via Overpass ── */
    const overpassQuery = `
[out:json][timeout:10];
(
  node[${osmTag}](around:2000,${lat},${lon});
  way[${osmTag}](around:2000,${lat},${lon});
);
out center 10;
`.trim();

    const ovResp = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `data=${encodeURIComponent(overpassQuery)}`,
      signal:  AbortSignal.timeout(8000),
    });
    if (!ovResp.ok) throw new Error(`Overpass HTTP ${ovResp.status}`);

    const ovData   = await ovResp.json();
    const elements = ovData.elements || [];

    const places = elements
      .filter(e => e.tags?.name)
      .slice(0, 10)
      .map(e => {
        const eLat = e.lat ?? e.center?.lat;
        const eLon = e.lon ?? e.center?.lon;
        const tags = e.tags || {};

        const addrParts = [
          tags['addr:housenumber'],
          tags['addr:street'],
          tags['addr:suburb'] || tags['addr:neighbourhood'],
          tags['addr:city'],
        ].filter(Boolean);
        const address = addrParts.length ? addrParts.join(', ') : (tags['addr:full'] || '');

        return {
          name:     tags.name || 'Unknown',
          address,
          category: osmTag.replace('=', ':'),
          lat:      eLat,
          lon:      eLon,
          distance: haversineMeters(center.lat, center.lon, eLat, eLon),
          phone:    tags.phone || tags['contact:phone'] || null,
          website:  tags.website || tags['contact:website'] || null,
          opening:  tags.opening_hours || null,
        };
      })
      .sort((a, b) => a.distance - b.distance);

    return { center, places };

  } catch (err) {
    return { error: true, message: `Maps search failed: ${err.message}` };
  }
}

/* ── OSM tag detection ── */
function detectOsmTag(query) {
  const q = query.toLowerCase();
  if (/hospital/.test(q))                                         return 'amenity=hospital';
  if (/clinic|doctor|medical/.test(q))                            return 'amenity=clinic';
  if (/pharmacy|chemist/.test(q))                                  return 'amenity=pharmacy';
  if (/restaurant|food|eat|dining|biryani|pizza|burger/.test(q))  return 'amenity=restaurant';
  if (/cafe|coffee/.test(q))                                       return 'amenity=cafe';
  if (/hotel|stay|lodge|motel|hostel/.test(q))                     return 'tourism=hotel';
  if (/petrol|fuel|gas station|cng/.test(q))                       return 'amenity=fuel';
  if (/gym|fitness|workout/.test(q))                               return 'leisure=fitness_centre';
  if (/school/.test(q))                                            return 'amenity=school';
  if (/college|university/.test(q))                                return 'amenity=university';
  if (/atm/.test(q))                                               return 'amenity=atm';
  if (/bank/.test(q))                                              return 'amenity=bank';
  if (/park|garden/.test(q))                                       return 'leisure=park';
  if (/mall|shopping/.test(q))                                     return 'shop=mall';
  if (/supermarket|grocery/.test(q))                               return 'shop=supermarket';
  if (/temple|mandir/.test(q))                                     return 'amenity=place_of_worship';
  if (/police/.test(q))                                            return 'amenity=police';
  if (/bus stop|bus stand/.test(q))                                return 'highway=bus_stop';
  if (/metro|subway/.test(q))                                      return 'railway=station';
  return 'amenity=restaurant';
}

/* ── Haversine distance in meters ── */
function haversineMeters(lat1, lon1, lat2, lon2) {
  if (!lat2 || !lon2) return 99999;
  const R  = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function formatSearchResultsForLLM(results) {
  if (results.length === 0) return 'No search results found.';
  return results.map((r, i) =>
    `--- SOURCE ${i + 1} ---\nTitle: ${r.title}\nURL: ${r.url}\nContent: ${r.snippet}`
  ).join('\n\n');
}

function formatStockDataForLLM(data) {
  if (data.error) return `Error: ${data.message}`;
  return `Stock: ${data.name} (${data.ticker})\nExchange: ${data.exchange}\nPrice: ${data.currency === 'USD' ? '$' : ''}${data.price}\nChange: ${data.change >= 0 ? '+' : ''}${data.change} (${data.changePct}%)\nMarket Cap: ${data.marketCap}\nOpen: ${data.open} | High: ${data.high} | Low: ${data.low} | Prev Close: ${data.prevClose}`;
}

function formatMapsDataForLLM(data) {
  if (data.error) return `Error: ${data.message}`;
  const { center, places } = data;
  if (!places || places.length === 0) return `Location found: ${center.label}. No nearby places found.`;
  const placeLines = places.map((p, i) =>
    `${i + 1}. ${p.name}${p.address ? ' — ' + p.address : ''}${p.distance ? ' (' + Math.round(p.distance) + 'm away)' : ''}`
  ).join('\n');
  return `Location: ${center.label}\nNearby places:\n${placeLines}`;
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for real-time facts, recent events, or specific URLs. Do NOT use for general knowledge, math, or coding.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A concise, keyword-focused search query.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stock_data',
      description: 'Fetch real-time stock price, market cap, and valuation metrics for a given ticker symbol.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock ticker symbol only (e.g., AAPL, TSLA, RELIANCE.NS). Do not include company names.' },
        },
        required: ['symbol'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'maps_search',
      description: 'ALWAYS use this tool when the user asks about any place, business, or service with a location — restaurants, hotels, hospitals, cafes, ATMs, gyms, shops, pharmacies, petrol stations, parks, or anything with "near", "nearby", "close to", "in [city]", "around here", or "where can I find". Never answer location queries from memory. Always call this tool for any place discovery request.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Business type + location exactly as the user said it (e.g., "restaurants near Connaught Place Delhi", "hospitals near Bandra Mumbai", "coffee shops MG Road Bangalore").' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
];

export async function onRequestPost(context) {
  const { request, env } = context;
  const requestId = crypto.randomUUID();

  let query, history;
  try {
    ({ query, history } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!query?.trim()) {
    return new Response(JSON.stringify({ error: 'Empty query' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const baseMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(Array.isArray(history) ? history.slice(-10) : []),
    { role: 'user', content: query },
  ];

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  (async () => {
    try {
      /* ── Force maps_search if query is clearly location-based ── */
      const MAP_PATTERN = /near|nearby|close to|around here|restaurant|hotel|cafe|coffee shop|hospital|clinic|pharmacy|atm|bank|gym|petrol|fuel|park|mall|shop|market|school|college|directions|where is|located|location of|places in|things to do in/i;
      const isMapQuery  = MAP_PATTERN.test(query);

      let assistantMessage, toolCalls;

      if (isMapQuery) {
        console.log(`[${requestId}] Map query detected — forcing maps_search.`);
        assistantMessage = { content: null };
        toolCalls = [{
          id:       'forced_map',
          type:     'function',
          function: { name: 'maps_search', arguments: JSON.stringify({ query }) },
        }];
      } else {
        console.log(`[${requestId}] Calling Ministral for routing...`);

        const call1Resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
          },
          body: JSON.stringify({
            model:       'ministral-14b-2512',
            messages:    baseMessages,
            tools:       TOOLS,
            tool_choice: 'auto',
            stream:      false,
            max_tokens:  500,
            temperature: 0.1,
          }),
        });

        if (!call1Resp.ok) {
          throw new Error(`Mistral API Error: ${call1Resp.status} ${await call1Resp.text()}`);
        }

        const call1Data  = await call1Resp.json();
        assistantMessage = call1Data.choices?.[0]?.message;
        toolCalls        = assistantMessage?.tool_calls;
      }

      /* ── No tool call → stream direct answer ── */
      if (!toolCalls || toolCalls.length === 0) {
        console.log(`[${requestId}] No tool call. Streaming direct answer.`);
        const directAnswer = assistantMessage?.content ?? 'I could not process that request.';
        const chunks = directAnswer.match(/.{1,64}/gs) || [''];
        for (const chunk of chunks) {
          await writer.write(enc.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: chunk }, finish_reason: null }] })}\n\n`
          ));
        }
        await writer.write(enc.encode(`data: [DONE]\n\n`));
        await writer.close();
        return;
      }

      const toolCall     = toolCalls[0];
      const toolCallId   = toolCall.id;
      const functionName = toolCall.function?.name;

      console.log(`[${requestId}] Executing tool: ${functionName}`);

      let functionArgs = {};
      try {
        functionArgs = JSON.parse(toolCall.function?.arguments || '{}');
      } catch {
        throw new Error('LLM returned invalid JSON for tool arguments.');
      }

      let validatedArgs;
      try {
        validatedArgs = validateToolArgs(functionName, functionArgs);
      } catch (err) {
        console.error(`[${requestId}] Validation failed:`, err.message);
        const errorMsg = `Tool execution failed: ${err.message}. Please ask the user for clarification or try a different approach.`;
        await writer.write(enc.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: errorMsg }, finish_reason: 'stop' }] })}\n\n`
        ));
        await writer.write(enc.encode(`data: [DONE]\n\n`));
        await writer.close();
        return;
      }

      let toolResultContent = '';
      let frontendEvent     = null;
      let frontendData      = null;

      if (functionName === 'web_search') {
        const results    = await executeSearXNG(validatedArgs.query, env.SEARXNG_URL);
        toolResultContent = formatSearchResultsForLLM(results);
        if (results.length > 0) {
          frontendEvent = 'results';
          frontendData  = results;
        }
      } else if (functionName === 'stock_data') {
        const data        = await executeStockData(validatedArgs.symbol, env.FINNHUB_API_KEY);
        toolResultContent = formatStockDataForLLM(data);
        if (!data.error) {
          frontendEvent = 'stock';
          frontendData  = data;
        }
      } else if (functionName === 'maps_search') {
        /* No API key needed — Nominatim + Overpass */
        const data        = await executeMapsSearch(validatedArgs.query);
        toolResultContent = formatMapsDataForLLM(data);
        if (!data.error) {
          frontendEvent = 'map';
          frontendData  = data;
        }
      }

      /* ── Send frontend event (map / stock / results) ── */
      if (frontendEvent && frontendData) {
        await writer.write(enc.encode(
          `event: ${frontendEvent}\ndata: ${JSON.stringify(frontendData)}\n\n`
        ));
      }

      console.log(`[${requestId}] Calling Ministral for final answer...`);

      const call2Resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'ministral-14b-2512',
          messages: [
            ...baseMessages,
            {
              role:       'assistant',
              content:    assistantMessage.content ?? null,
              tool_calls: toolCalls,
            },
            {
              role:         'tool',
              content:      toolResultContent,
              tool_call_id: toolCallId,
            },
          ],
          stream:      true,
          max_tokens:  2048,
          temperature: 0.6,
        }),
      });

      if (!call2Resp.ok) {
        throw new Error(`Final generation API Error: ${call2Resp.status} ${await call2Resp.text()}`);
      }

      const reader = call2Resp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }

      console.log(`[${requestId}] Request completed successfully.`);
      await writer.close();

    } catch (err) {
      console.error(`[${requestId}] Fatal Error:`, err);
      try {
        await writer.write(enc.encode(
          `data: ${JSON.stringify({ error: 'An internal error occurred. Please try again.' })}\n\n`
        ));
        await writer.write(enc.encode(`data: [DONE]\n\n`));
        await writer.close();
      } catch (_) {}
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
