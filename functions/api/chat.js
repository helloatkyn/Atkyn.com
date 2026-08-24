import { SYSTEM_PROMPT } from './systemPrompt.js';

const CEREBRAS_URL =
  'https://api.cerebras.ai/v1/chat/completions';

const MODEL = 'gemma-4-31b';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization',
};

const WEB_SEARCH_TOOL = [
  {
    type: 'function',
    function: {
      name: 'web_search',

      description:
        'Search the web when the user needs current, recent, ' +
        'real-time, external, or specialized information. ' +
        'Do not use it for ordinary reasoning, mathematics, ' +
        'creative writing, or coding questions that can be answered ' +
        'without external information.',

      parameters: {
        type: 'object',

        properties: {
          query: {
            type: 'string',
            description:
              'The concise search query to use on the web.',
          },
        },

        required: ['query'],

        additionalProperties: false,
      },
    },
  },
];

function sse(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function errorSSE(message) {
  return sse({
    error: String(message || 'Unknown error'),
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
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },

      signal: AbortSignal.timeout(4000),
    });

    if (!resp.ok) return '';

    const html = await resp.text();

    return html
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
      .trim()
      .slice(0, 5000);
  } catch {
    return '';
  }
}

async function executeSearXNG(searchQuery, searxngUrl) {
  if (!searchQuery || !searxngUrl) {
    return [];
  }

  const base = normalizeUrl(searxngUrl);

  const url =
    `${base}/search` +
    `?q=${encodeURIComponent(searchQuery)}` +
    `&format=json` +
    `&categories=general` +
    `&language=en`;

  const resp = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },

    signal: AbortSignal.timeout(8000),
  });

  if (!resp.ok) {
    throw new Error(
      `SearXNG returned HTTP ${resp.status}`
    );
  }

  const data = await resp.json();

  const results = Array.isArray(data.results)
    ? data.results.slice(0, 6)
    : [];

  return Promise.all(
    results.map(async (r, i) => {
      let snippet = r.content || '';

      if (i < 5 && r.url) {
        const pageText =
          await fetchPageText(r.url);

        if (pageText) {
          snippet = pageText;
        }
      }

      return {
        title: r.title || '',
        url: r.url || '',
        snippet,
      };
    })
  );
}

function parseArguments(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function stripThinking(text) {
  return String(text || '')
    .replace(
      /<think>[\s\S]*?<\/think>/gi,
      ''
    )
    .trimStart();
}

/*
 * SSE parser.
 *
 * Network chunks are NOT guaranteed to equal SSE messages,
 * so we keep an internal buffer.
 */
async function consumeSSE(
  response,
  onData
) {
  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder('utf-8');

  let buffer = '';

  while (true) {
    const { done, value } =
      await reader.read();

    if (done) break;

    buffer += decoder.decode(
      value,
      { stream: true }
    );

    const events =
      buffer.split(/\r?\n\r?\n/);

    buffer =
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

        if (!payload) continue;

        if (payload === '[DONE]') {
          await onData({
            done: true,
          });

          continue;
        }

        try {
          const parsed =
            JSON.parse(payload);

          await onData({
            data: parsed,
            done: false,
          });
        } catch {
          // Ignore malformed SSE payloads.
        }
      }
    }
  }

  /*
   * Flush decoder.
   */
  buffer += decoder.decode();

  if (buffer.trim()) {
    const events =
      buffer.split(/\r?\n\r?\n/);

    for (const event of events) {
      const lines =
        event.split(/\r?\n/);

      for (const line of lines) {
        if (!line.startsWith('data:')) {
          continue;
        }

        const payload =
          line.slice(5).trim();

        if (!payload || payload === '[DONE]') {
          continue;
        }

        try {
          await onData({
            data: JSON.parse(payload),
            done: false,
          });
        } catch {}
      }
    }
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;

  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({
        error: 'Invalid request body',
      }),
      {
        status: 400,

        headers: {
          'Content-Type':
            'application/json',

          ...CORS_HEADERS,
        },
      }
    );
  }

  const query =
    typeof body?.query === 'string'
      ? body.query.trim()
      : '';

  const history =
    Array.isArray(body?.history)
      ? body.history
      : [];

  if (!query) {
    return new Response(
      JSON.stringify({
        error: 'Empty query',
      }),
      {
        status: 400,

        headers: {
          'Content-Type':
            'application/json',

          ...CORS_HEADERS,
        },
      }
    );
  }

  if (!env?.CEREBRAS_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          'CEREBRAS_API_KEY is missing.',
      }),
      {
        status: 500,

        headers: {
          'Content-Type':
            'application/json',

          ...CORS_HEADERS,
        },
      }
    );
  }

  if (!env?.SEARXNG_URL) {
    return new Response(
      JSON.stringify({
        error:
          'SEARXNG_URL is missing.',
      }),
      {
        status: 500,

        headers: {
          'Content-Type':
            'application/json',

          ...CORS_HEADERS,
        },
      }
    );
  }

  const messages = [
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

  const {
    readable,
    writable,
  } = new TransformStream();

  const writer =
    writable.getWriter();

  const encoder =
    new TextEncoder();

  /*
   * Run asynchronously so the Response can
   * immediately become an SSE stream.
   */
  (async () => {
    try {
      /*
       * =====================================================
       * CALL #1
       *
       * Gemma decides whether to use web_search.
       * =====================================================
       */

      const call1 =
        await fetch(
          CEREBRAS_URL,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',

              Authorization:
                `Bearer ${env.CEREBRAS_API_KEY}`,
            },

            body: JSON.stringify({
              model: MODEL,

              messages,

              tools:
                WEB_SEARCH_TOOL,

              tool_choice: 'auto',

              parallel_tool_calls: true,

              stream: false,

              max_completion_tokens: 2048,

              temperature: 0.6,
            }),
          }
        );

      if (!call1.ok) {
        const text =
          await call1.text();

        await writer.write(
          encoder.encode(
            errorSSE(
              `Cerebras Call #1 failed ` +
              `(${call1.status}): ${text}`
            )
          )
        );

        await writer.write(
          encoder.encode(
            'data: [DONE]\n\n'
          )
        );

        await writer.close();

        return;
      }

      const call1Data =
        await call1.json();

      const assistant =
        call1Data?.choices?.[0]?.message;

      if (!assistant) {
        await writer.write(
          encoder.encode(
            errorSSE(
              'Cerebras returned no assistant message.'
            )
          )
        );

        await writer.write(
          encoder.encode(
            'data: [DONE]\n\n'
          )
        );

        await writer.close();

        return;
      }

      const toolCalls =
        Array.isArray(
          assistant.tool_calls
        )
          ? assistant.tool_calls
          : [];

      /*
       * =====================================================
       * DIRECT ANSWER
       *
       * No tool was requested.
       * =====================================================
       */

      if (toolCalls.length === 0) {
        const answer =
          stripThinking(
            assistant.content || ''
          );

        /*
         * Emit it in small chunks so the frontend
         * receives a normal streaming-like response.
         */
        const chunks =
          answer.match(
            /[\s\S]{1,64}/g
          ) || [''];

        for (const chunk of chunks) {
          await writer.write(
            encoder.encode(
              sse({
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
          encoder.encode(
            'data: [DONE]\n\n'
          )
        );

        await writer.close();

        return;
      }

      /*
       * =====================================================
       * EXECUTE TOOLS
       * =====================================================
       */

      const toolMessages = [];

      const frontendResults = [];

      for (const toolCall of toolCalls) {
        const functionName =
          toolCall?.function?.name || '';

        const toolCallId =
          toolCall?.id || '';

        const args =
          parseArguments(
            toolCall?.function?.arguments
          );

        if (
          functionName !==
          'web_search'
        ) {
          toolMessages.push({
            role: 'tool',

            tool_call_id:
              toolCallId,

            content:
              'Unknown tool.',
          });

          continue;
        }

        const searchQuery =
          typeof args.query === 'string'
            ? args.query.trim()
            : '';

        if (!searchQuery) {
          toolMessages.push({
            role: 'tool',

            tool_call_id:
              toolCallId,

            content:
              'No search query was provided.',
          });

          continue;
        }

        let results = [];

        try {
          results =
            await executeSearXNG(
              searchQuery,
              env.SEARXNG_URL
            );
        } catch (err) {
          console.error(
            'SearXNG error:',
            err
          );
        }

        frontendResults.push(
          ...results
        );

        let resultText =
          'No results found.';

        if (results.length) {
          resultText =
            results
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

          tool_call_id:
            toolCallId,

          content:
            resultText,
        });
      }

      /*
       * Send raw search results to frontend.
       */
      if (frontendResults.length) {
        await writer.write(
          encoder.encode(
            `event: results\n` +
            `data: ${JSON.stringify(
              frontendResults
            )}\n\n`
          )
        );
      }

      /*
       * =====================================================
       * CALL #2
       *
       * Send:
       *   original messages
       *   assistant tool call
       *   tool results
       *
       * Then stream final answer.
       * =====================================================
       */

      const call2 =
        await fetch(
          CEREBRAS_URL,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',

              Authorization:
                `Bearer ${env.CEREBRAS_API_KEY}`,
            },

            body: JSON.stringify({
              model: MODEL,

              messages: [
                ...messages,

                {
                  role: 'assistant',

                  content:
                    assistant.content ??
                    null,

                  tool_calls:
                    toolCalls,
                },

                ...toolMessages,
              ],

              stream: true,

              max_completion_tokens:
                2048,

              temperature: 0.6,
            }),
          }
        );

      if (!call2.ok) {
        const text =
          await call2.text();

        await writer.write(
          encoder.encode(
            errorSSE(
              `Cerebras Call #2 failed ` +
              `(${call2.status}): ${text}`
            )
          )
        );

        await writer.write(
          encoder.encode(
            'data: [DONE]\n\n'
          )
        );

        await writer.close();

        return;
      }

      /*
       * =====================================================
       * STREAM FINAL ANSWER
       * =====================================================
       */

      let sentDone = false;

      await consumeSSE(
        call2,
        async ({ data, done }) => {
          if (done) {
            if (!sentDone) {
              sentDone = true;

              await writer.write(
                encoder.encode(
                  'data: [DONE]\n\n'
                )
              );
            }

            return;
          }

          const choice =
            data?.choices?.[0];

          const delta =
            choice?.delta;

          const content =
            delta?.content;

          /*
           * Forward metadata / finish events.
           */
          if (
            typeof content !==
            'string'
          ) {
            await writer.write(
              encoder.encode(
                sse(data)
              )
            );

            return;
          }

          const clean =
            stripThinking(
              content
            );

          if (!clean) {
            return;
          }

          const output = {
            ...data,

            choices: [
              {
                ...choice,

                delta: {
                  ...delta,

                  content: clean,
                },
              },
            ],
          };

          await writer.write(
            encoder.encode(
              sse(output)
            )
          );
        }
      );

      if (!sentDone) {
        await writer.write(
          encoder.encode(
            'data: [DONE]\n\n'
          )
        );
      }

      await writer.close();
    } catch (err) {
      console.error(
        'Cerebras handler error:',
        err
      );

      try {
        await writer.write(
          encoder.encode(
            errorSSE(
              err?.stack ||
              String(err)
            )
          )
        );

        await writer.write(
          encoder.encode(
            'data: [DONE]\n\n'
          )
        );

        await writer.close();
      } catch {}
    }
  })();

  return new Response(
    readable,
    {
      headers: {
        'Content-Type':
          'text/event-stream; charset=utf-8',

        'Cache-Control':
          'no-cache, no-transform',

        'X-Accel-Buffering':
          'no',

        ...CORS_HEADERS,
      },
    }
  );
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,

    headers: {
      ...CORS_HEADERS,

      'Access-Control-Max-Age':
        '86400',
    },
  });
}
