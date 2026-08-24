import { SYSTEM_PROMPT } from './systemPrompt.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip HTML to plain text and truncate.
 */
function cleanHtml(html, limit = 20000) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return { title: title.replace(/\s+/g, ' ').trim(), text: clean.slice(0, limit) };
}

/**
 * Validate that a URL is a safe http/https URL — no local/private addresses,
 * no other protocols.
 */
function validateUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'Malformed URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `Protocol "${parsed.protocol}" is not allowed. Only http and https are supported.` };
  }
  // Block localhost and private ranges (best-effort)
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.startsWith('192.168.') ||
    host.startsWith('10.') ||
    host.startsWith('172.') ||      // rough check — good enough for edge workers
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return { ok: false, error: 'Access to local/private addresses is not allowed.' };
  }
  return { ok: true, parsed };
}

/**
 * Fetch a single page (used internally by executeSearXNG for snippet enrichment).
 */
async function fetchPageText(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return '';
    const html = await resp.text();
    const { text } = cleanHtml(html, 5000);
    return text;
  } catch {
    return '';
  }
}

/**
 * Full fetch_url tool implementation.
 * Returns a structured result object — never invents metadata.
 */
async function executeFetchUrl(originalUrl) {
  const validation = validateUrl(originalUrl);
  if (!validation.ok) {
    return {
      url: originalUrl,
      finalUrl: '',
      fetched: false,
      httpStatus: null,
      contentType: '',
      error: validation.error,
    };
  }

  let resp;
  try {
    resp = await fetch(originalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FetchBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
  } catch (err) {
    return {
      url: originalUrl,
      finalUrl: '',
      fetched: false,
      httpStatus: null,
      contentType: '',
      error: String(err),
    };
  }

  const finalUrl = resp.url || originalUrl;
  const httpStatus = resp.status;
  const contentType = resp.headers.get('content-type') || '';

  if (!resp.ok) {
    return {
      url: originalUrl,
      finalUrl,
      fetched: false,
      httpStatus,
      contentType,
      error: `HTTP ${httpStatus}`,
    };
  }

  let rawText = '';
  try {
    rawText = await resp.text();
  } catch (err) {
    return {
      url: originalUrl,
      finalUrl,
      fetched: false,
      httpStatus,
      contentType,
      error: `Failed to read response body: ${String(err)}`,
    };
  }

  // Limit raw size before processing to prevent DoS
  if (rawText.length > 500000) {
    rawText = rawText.slice(0, 500000);
  }

  let title = '';
  let content = '';

  const ct = contentType.toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) {
    const cleaned = cleanHtml(rawText, 18000);
    title = cleaned.title;
    content = cleaned.text;
  } else if (
    ct.includes('application/json') ||
    ct.includes('text/plain') ||
    ct.includes('text/xml') ||
    ct.includes('application/xml') ||
    ct.includes('application/javascript')
  ) {
    content = rawText.slice(0, 18000);
  } else {
    // Binary or unsupported — return a notice
    content = `[Non-text content: ${contentType}. Cannot display.]`;
  }

  return {
    url: originalUrl,
    finalUrl,
    fetched: true,
    httpStatus,
    contentType,
    title,
    content,
  };
}

/**
 * SearXNG search + per-result page enrichment.
 */
async function executeSearXNG(searchQuery, searxngUrl) {
  const searxResp = await fetch(
    `${searxngUrl}/search?q=${encodeURIComponent(searchQuery)}&format=json&categories=general&language=en`,
    { headers: { 'Accept': 'application/json' } }
  );

  if (!searxResp.ok) return [];

  const data = await searxResp.json();
  const raw = (data.results || []).slice(0, 6);

  const enriched = await Promise.all(
    raw.map(async (r, i) => {
      let content = r.content || '';
      if (i < 5) {
        const pageText = await fetchPageText(r.url);
        if (pageText) content = pageText;
      }
      return {
        title:   r.title || '',
        url:     r.url   || '',
        snippet: content,
      };
    })
  );

  return enriched;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web for current, external, or specialized information. ' +
        'Call this tool when the user query requires up-to-date facts, recent events, ' +
        'real-time data, or any information that may not be in the model\'s training data. ' +
        'Do NOT call this tool when the user provides a specific URL — use fetch_url instead. ' +
        'Do NOT call this tool when the query can be answered directly from existing knowledge ' +
        '(e.g. general explanations, reasoning tasks, creative writing, math, or coding questions).',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to look up on the web.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description:
        'Fetch and read the actual content of a specific HTTP/HTTPS webpage. ' +
        'Use this when the user provides a URL or asks about the contents of a specific webpage. ' +
        'Do not guess the webpage contents from memory. ' +
        'Always use this tool when the user explicitly supplies a URL and wants its content.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full HTTP or HTTPS URL to fetch.',
          },
        },
        required: ['url'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executor — handles ALL tool calls and returns tool messages array
// ---------------------------------------------------------------------------

/**
 * Execute all tool calls the model requested.
 * Returns:
 *   toolMessages  – array of {role:'tool', ...} messages for Call #2
 *   searchResults – flat array of search result objects (for SSE event: results)
 *   fetchedPages  – flat array of fetch_url result objects (for SSE event: page)
 */
async function executeToolCalls(toolCalls, searxngUrl) {
  const toolMessages  = [];
  const searchResults = [];
  const fetchedPages  = [];

  await Promise.all(
    toolCalls.map(async (toolCall) => {
      const toolCallId   = toolCall.id;
      const functionName = toolCall.function?.name;

      let args = {};
      try {
        args = JSON.parse(toolCall.function?.arguments || '{}');
      } catch (_) {}

      let resultContent = '';

      if (functionName === 'web_search') {
        let results = [];
        try {
          results = await executeSearXNG(args.query || '', searxngUrl);
        } catch (_) {}

        if (results.length > 0) {
          searchResults.push(...results);
          resultContent = results
            .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
            .join('\n\n');
        } else {
          resultContent = 'No search results found.';
        }

      } else if (functionName === 'fetch_url') {
        const fetchResult = await executeFetchUrl(args.url || '');
        fetchedPages.push(fetchResult);

        if (fetchResult.fetched) {
          resultContent = [
            `IMPORTANT: Use this fetched content as the primary source. Never invent webpage contents or HTTP metadata.`,
            `If the requested information is not present in the fetched content, say that it was not found.`,
            ``,
            `url: ${fetchResult.url}`,
            `finalUrl: ${fetchResult.finalUrl}`,
            `httpStatus: ${fetchResult.httpStatus}`,
            `contentType: ${fetchResult.contentType}`,
            `title: ${fetchResult.title}`,
            `fetched: true`,
            ``,
            `--- PAGE CONTENT START ---`,
            fetchResult.content,
            `--- PAGE CONTENT END ---`,
          ].join('\n');
        } else {
          resultContent = [
            `IMPORTANT: The page could not be fetched. Report this to the user. Do not invent contents.`,
            ``,
            `url: ${fetchResult.url}`,
            `finalUrl: ${fetchResult.finalUrl || ''}`,
            `httpStatus: ${fetchResult.httpStatus ?? 'N/A'}`,
            `contentType: ${fetchResult.contentType || ''}`,
            `fetched: false`,
            `error: ${fetchResult.error}`,
          ].join('\n');
        }

      } else {
        resultContent = `Unknown tool: ${functionName}`;
      }

      // Each tool call gets exactly one tool message, keyed by tool_call_id
      toolMessages.push({
        toolCallId,
        functionName,
        content: resultContent,
      });
    })
  );

  // Re-order tool messages to match the original toolCalls order
  // (Mistral requires tool messages in the same order as the tool_calls array)
  const ordered = toolCalls.map((tc) =>
    toolMessages.find((tm) => tm.toolCallId === tc.id)
  );

  const formattedMessages = ordered.map((tm) => ({
    role:         'tool',
    name:         tm.functionName,
    content:      tm.content,
    tool_call_id: tm.toolCallId,
  }));

  return { toolMessages: formattedMessages, searchResults, fetchedPages };
}

// ---------------------------------------------------------------------------
// Cloudflare Pages Function entry points
// ---------------------------------------------------------------------------

export async function onRequestPost(context) {
  const { request, env } = context;

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
    ...(Array.isArray(history) ? history.slice(-100) : []),
    { role: 'user', content: query },
  ];

  // ---- Call #1: Model decides which tool to use (or none) ----
  const call1Resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model:       'ministral-8b-latest',
      messages:    baseMessages,
      tools:       TOOLS,
      tool_choice: 'auto',
      stream:      false,
      max_tokens:  2048,
      temperature: 0.6,
    }),
  });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();

  (async () => {
    try {
      if (!call1Resp.ok) {
        const errText = await call1Resp.text();
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: errText })}\n\n`));
        await writer.close();
        return;
      }

      const call1Data       = await call1Resp.json();
      const assistantMessage = call1Data.choices?.[0]?.message;
      const toolCalls        = assistantMessage?.tool_calls;

      // ---- No tool calls: stream direct answer ----
      if (!toolCalls || toolCalls.length === 0) {
        const directAnswer = assistantMessage?.content ?? '';
        const chunks = directAnswer.match(/.{1,64}/gs) || [''];
        for (const chunk of chunks) {
          const ssePayload = {
            choices: [{ delta: { content: chunk }, finish_reason: null }],
          };
          await writer.write(enc.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
        }
        await writer.write(enc.encode(`data: [DONE]\n\n`));
        await writer.close();
        return;
      }

      // ---- Execute ALL tool calls ----
      const { toolMessages, searchResults, fetchedPages } =
        await executeToolCalls(toolCalls, env.SEARXNG_URL);

      // Emit SSE events to frontend before the final answer stream

      if (searchResults.length > 0) {
        await writer.write(
          enc.encode(`event: results\ndata: ${JSON.stringify(searchResults)}\n\n`)
        );
      }

      for (const page of fetchedPages) {
        // Only emit metadata — never expose raw content or env vars
        const pageEvent = {
          url:         page.url,
          finalUrl:    page.finalUrl,
          httpStatus:  page.httpStatus,
          contentType: page.contentType,
          title:       page.title || '',
        };
        await writer.write(
          enc.encode(`event: page\ndata: ${JSON.stringify(pageEvent)}\n\n`)
        );
      }

      // ---- Call #2: Final streamed answer with all tool results ----
      const call2Resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model:       'ministral-8b-latest',
          messages: [
            ...baseMessages,
            // assistant message with all tool_calls intact
            {
              role:       'assistant',
              content:    assistantMessage.content ?? null,
              tool_calls: toolCalls,
            },
            // one tool message per tool call, in matching order
            ...toolMessages,
          ],
          stream:      true,
          max_tokens:  2048,
          temperature: 0.6,
        }),
      });

      if (!call2Resp.ok) {
        const errText = await call2Resp.text();
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: errText })}\n\n`));
        await writer.close();
        return;
      }

      const reader = call2Resp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }

      await writer.close();
    } catch (err) {
      try {
        await writer.write(enc.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`));
        await writer.close();
      } catch (_) {}
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type':    'text/event-stream',
      'Cache-Control':   'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
    }
  
