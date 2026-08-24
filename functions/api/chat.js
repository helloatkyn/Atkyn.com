import { SYSTEM_PROMPT } from './systemPrompt.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// VERIFIED CURRENT OPENROUTER MODEL
const MODEL = 'z-ai/glm-5.2:free';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function normalizeUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

async function fetchPageText(url) {
  try {
    if (!url) return '';

    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!resp.ok) return '';

    const html = await resp.text();

    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();

    return clean.slice(0, 5000);
  } catch {
    return '';
  }
}

async function executeSearXNG(searchQuery, searxngUrl) {
  if (!searchQuery || !searxngUrl) return [];

  const baseUrl = normalizeUrl(searxngUrl);

  const searchUrl =
    `${baseUrl}/search` +
    `?q=${encodeURIComponent(searchQuery)}` +
    `&format=json` +
    `&categories=general` +
    `&language=en`;

  const searxResp = await fetch(searchUrl, {
    headers: {
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!searxResp.ok) return [];

  const data = await searxResp.json();

  const raw = Array.isArray(data.results)
    ? data.results.slice(0, 6)
    : [];

  const enriched = await Promise.all(
    raw.map(async (r, i) => {
      let content = r.content || '';

      // Fetch actual page content for first 5 results.
      if (i < 5 && r.url) {
        const pageText = await fetchPageText(r.url);

        if (pageText) {
          content = pageText;
        }
      }

      return {
        title: r.title || '',
        url: r.url || '',
        snippet: content || '',
      };
    })
  );

  return enriched;
}

const WEB_SEARCH_TOOL = [
  {
    type: 'function',
    function: {
      name: 'web_search',

      description:
        'Search the web for current, recent, external, real-time, ' +
        'specialized, or otherwise externally verifiable information. ' +
        'Use this when the user needs information that may have changed ' +
        'or cannot be reliably answered from existing knowledge. ' +
        'Do not use it for ordinary reasoning, mathematics, coding, ' +
        'creative writing, or general explanations that do not require ' +
        'external information.',

      parameters: {
        type: 'object',

        properties: {
          query: {
            type: 'string',
            description:
              'A concise web search query containing the information needed.',
          },
        },

        required: ['query'],

        additionalProperties: false,
      },
    },
  },
];

function stripThinking(text) {
  if (!text) return '';

  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trimStart();
}

/*
 * Removes <think>...</think> safely even when the tags
 * arrive across different streaming chunks.
 */
class ThinkingFilter {
  constructor() {
    this.buffer = '';
    this.insideThink = false;
  }

  push(text) {
    if (!text) return '';

    this.buffer += text;

    let output = '';

    while (true) {
      if (this.insideThink) {
        const closeIndex = this.buffer.indexOf('</think>');

        if (closeIndex === -1) {
          /*
           * Keep a small suffix because </think> itself
           * can be split across network chunks.
           */
          const keep = Math.min(this.buffer.length, 8);

          this.buffer = this.buffer.slice(
            Math.max(0, this.buffer.length - keep)
          );

          return output;
        }

        this.buffer = this.buffer.slice(closeIndex + 8);
        this.insideThink = false;
        continue;
      }

      const openIndex = this.buffer.indexOf('<think>');

      if (openIndex === -1) {
        /*
         * Don't immediately emit the final 6 characters because
         * "<think>" can be split between streaming chunks.
         */
        const keep = Math.min(this.buffer.length, 6);

        if (this.buffer.length > keep) {
          output += this.buffer.slice(0, -keep);
          this.buffer = this.buffer.slice(-keep);
        }

        return output;
      }

      output += this.buffer.slice(0, openIndex);

      this.buffer = this.buffer.slice(openIndex + 7);
      this.insideThink = true;
    }
  }

  flush() {
    if (this.insideThink) {
      this.buffer = '';
      return '';
    }

    const out = this.buffer;
    this.buffer = '';

    return out;
  }
}

function makeSSE(type, data) {
  if (type === 'data') {
    return `data: ${JSON.stringify(data)}\n\n`;
  }

  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function writeError(writer, enc, message) {
  try {
    await writer.write(
      enc.encode(
        makeSSE('data', {
          error: String(message || 'Unknown error'),
        })
      )
    );

    await writer.write(enc.encode('data: [DONE]\n\n'));
  } catch {
    // Ignore stream-write errors.
  }
}

function extractToolCalls(message) {
  return Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : [];
}

function safeParseArguments(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      {
        error: 'Invalid request body',
      },
      400
    );
  }

  const query =
    typeof body?.query === 'string'
      ? body.query.trim()
      : '';

  const history = Array.isArray(body?.history)
    ? body.history
    : [];

  if (!query) {
    return jsonResponse(
      {
        error: 'Empty query',
      },
      400
    );
  }

  if (!env?.OPENROUTER_API_KEY) {
    return jsonResponse(
      {
        error: 'OPENROUTER_API_KEY is not configured.',
      },
      500
    );
  }

  if (!env?.SEARXNG_URL) {
    return jsonResponse(
      {
        error: 'SEARXNG_URL is not configured.',
      },
      500
    );
  }

  const baseMessages = [
    {
      role: 'system',
      content: SYSTEM_PROMPT,
    },

    ...history.slice(-100),

    {
      role: 'user',
      content: query,
    },
  ];

  const authHeader = {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
  };

  /*
   * Create SSE stream immediately.
   */
  const { readable, writable } = new TransformStream();

  const writer = writable.getWriter();
  const enc = new TextEncoder();

  /*
   * Run the whole OpenRouter flow in background.
   */
  (async () => {
    try {
      /*
       * =========================================================
       * CALL #1
       * Model decides:
       *   - answer directly
       *   - OR call web_search
       * =========================================================
       */

      const call1Resp = await fetch(OPENROUTER_URL, {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },

        body: JSON.stringify({
          model: MODEL,

          messages: baseMessages,

          tools: WEB_SEARCH_TOOL,

          tool_choice: 'auto',

          stream: false,

          max_tokens: 2048,

          temperature: 0.6,
        }),
      });

      if (!call1Resp.ok) {
        const errText = await call1Resp.text();

        await writeError(
          writer,
          enc,
          `OpenRouter Call #1 failed (${call1Resp.status}): ${errText}`
        );

        await writer.close();
        return;
      }

      const call1Data = await call1Resp.json();

      const assistantMessage =
        call1Data?.choices?.[0]?.message;

      if (!assistantMessage) {
        await writeError(
          writer,
          enc,
          'OpenRouter returned no assistant message.'
        );

        await writer.close();
        return;
      }

      const toolCalls = extractToolCalls(assistantMessage);

      /*
       * =========================================================
       * NO TOOL CALL
       * =========================================================
       */

      if (toolCalls.length === 0) {
        const directAnswer = stripThinking(
          assistantMessage.content || ''
        );

        /*
         * Send answer as SSE chunks so frontend can consume
         * it using the same streaming parser.
         */
        const chunks =
          directAnswer.match(/[\s\S]{1,64}/g) || [''];

        for (const chunk of chunks) {
          await writer.write(
            enc.encode(
              makeSSE('data', {
                choices: [
                  {
                    delta: {
                      content: chunk,
                    },
                    finish_reason: null,
                  },
                ],
              })
            )
          );
        }

        await writer.write(
          enc.encode('data: [DONE]\n\n')
        );

        await writer.close();
        return;
      }

      /*
       * =========================================================
       * TOOL CALL
       * =========================================================
       */

      const toolMessages = [];

      let allSearchResults = [];

      for (const toolCall of toolCalls) {
        const functionName =
          toolCall?.function?.name || '';

        const toolCallId =
          toolCall?.id || '';

        const functionArgs =
          safeParseArguments(
            toolCall?.function?.arguments
          );

        /*
         * Unknown tool
         */
        if (functionName !== 'web_search') {
          toolMessages.push({
            role: 'tool',
            name: functionName || 'unknown',
            tool_call_id: toolCallId,
            content: 'Unknown tool.',
          });

          continue;
        }

        const searchQuery =
          typeof functionArgs?.query === 'string'
            ? functionArgs.query.trim()
            : '';

        if (!searchQuery) {
          toolMessages.push({
            role: 'tool',
            name: 'web_search',
            tool_call_id: toolCallId,
            content: 'No search query was provided.',
          });

          continue;
        }

        let searchResults = [];

        try {
          searchResults = await executeSearXNG(
            searchQuery,
            env.SEARXNG_URL
          );
        } catch (err) {
          searchResults = [];

          console.error(
            'SearXNG error:',
            err
          );
        }

        allSearchResults.push(...searchResults);

        let toolResultContent =
          'No results found.';

        if (searchResults.length > 0) {
          toolResultContent = searchResults
            .map(
              (r, i) =>
                `[${i + 1}] ${r.title}\n` +
                `URL: ${r.url}\n` +
                `${r.snippet}`
            )
            .join('\n\n');
        }

        toolMessages.push({
          role: 'tool',
          name: 'web_search',
          tool_call_id: toolCallId,
          content: toolResultContent,
        });
      }

      /*
       * Send search results to frontend.
       */
      if (allSearchResults.length > 0) {
        await writer.write(
          enc.encode(
            makeSSE(
              'results',
              allSearchResults
            )
          )
        );
      }

      /*
       * =========================================================
       * CALL #2
       * Model receives:
       *
       * original conversation
       * assistant tool call
       * actual web results
       *
       * and produces final answer.
       * =========================================================
       */

      const call2Resp = await fetch(
        OPENROUTER_URL,
        {
          method: 'POST',

          headers: {
            'Content-Type': 'application/json',
            ...authHeader,
          },

          body: JSON.stringify({
            model: MODEL,

            messages: [
              ...baseMessages,

              {
                role: 'assistant',
                content:
                  assistantMessage.content ?? null,
                tool_calls: toolCalls,
              },

              ...toolMessages,
            ],

            stream: true,

            max_tokens: 2048,

            temperature: 0.6,
          }),
        }
      );

      if (!call2Resp.ok) {
        const errText = await call2Resp.text();

        await writeError(
          writer,
          enc,
          `OpenRouter Call #2 failed (${call2Resp.status}): ${errText}`
        );

        await writer.close();
        return;
      }

      /*
       * =========================================================
       * ROBUST SSE READER
       *
       * IMPORTANT:
       * A network chunk is NOT necessarily an SSE event.
       * Therefore we keep a persistent buffer.
       * =========================================================
       */

      const reader =
        call2Resp.body.getReader();

      const dec =
        new TextDecoder('utf-8');

      let sseBuffer = '';

      const thinkingFilter =
        new ThinkingFilter();

      while (true) {
        const { done, value } =
          await reader.read();

        if (done) break;

        sseBuffer += dec.decode(
          value,
          {
            stream: true,
          }
        );

        /*
         * SSE events are separated by blank lines.
         */
        const events =
          sseBuffer.split(/\r?\n\r?\n/);

        /*
         * Keep incomplete event for next network chunk.
         */
        sseBuffer =
          events.pop() || '';

        for (const event of events) {
          const lines =
            event.split(/\r?\n/);

          for (const line of lines) {
            if (!line.startsWith('data:')) {
              continue;
            }

            const payload =
              line.slice(5).trim();

            if (!payload) {
              continue;
            }

            if (payload === '[DONE]') {
              await writer.write(
                enc.encode(
                  'data: [DONE]\n\n'
                )
              );

              continue;
            }

            let parsed;

            try {
              parsed =
                JSON.parse(payload);
            } catch {
              /*
               * Don't kill the stream if a provider sends
               * malformed/non-JSON SSE data.
               */
              continue;
            }

            const choice =
              parsed?.choices?.[0];

            const delta =
              choice?.delta;

            const content =
              delta?.content || '';

            /*
             * Nothing textual in this delta.
             * Forward finish/tool metadata normally.
             */
            if (!content) {
              await writer.write(
                enc.encode(
                  makeSSE(
                    'data',
                    parsed
                  )
                )
              );

              continue;
            }

            /*
             * Strip Qwen/GLM style thinking blocks safely.
             */
            const visibleText =
              thinkingFilter.push(content);

            if (!visibleText) {
              continue;
            }

            const output = {
              ...parsed,

              choices: [
                {
                  ...choice,

                  delta: {
                    ...delta,

                    content:
                      visibleText,
                  },
                },
              ],
            };

            await writer.write(
              enc.encode(
                makeSSE(
                  'data',
                  output
                )
              )
            );
          }
        }
      }

      /*
       * Flush remaining decoder bytes.
       */
      sseBuffer += dec.decode();

      /*
       * Flush remaining visible text from thinking filter.
       */
      const finalText =
        thinkingFilter.flush();

      if (finalText) {
        await writer.write(
          enc.encode(
            makeSSE(
              'data',
              {
                choices: [
                  {
                    delta: {
                      content: finalText,
                    },
                    finish_reason: null,
                  },
                ],
              }
            )
          )
        );
      }

      /*
       * Ensure frontend always receives DONE.
       */
      await writer.write(
        enc.encode(
          'data: [DONE]\n\n'
        )
      );

      await writer.close();
    } catch (err) {
      console.error(
        'Request handler error:',
        err
      );

      await writeError(
        writer,
        enc,
        err?.stack || String(err)
      );

      try {
        await writer.close();
      } catch {
        // Already closed.
      }
    }
  })();

  /*
   * IMPORTANT:
   * CORS headers must also be present on the actual POST
   * response, not only OPTIONS.
   */
  return new Response(
    readable,
    {
      headers: {
        'Content-Type':
          'text/event-stream; charset=utf-8',

        'Cache-Control':
          'no-cache, no-transform',

        'Connection':
          'keep-alive',

        'X-Accel-Buffering':
          'no',

        ...CORS_HEADERS,
      },
    }
  );
}

export async function onRequestOptions() {
  return new Response(
    null,
    {
      status: 204,

      headers: {
        ...CORS_HEADERS,

        'Access-Control-Max-Age':
          '86400',
      },
    }
  );
                }
