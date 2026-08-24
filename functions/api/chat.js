import { SYSTEM_PROMPT } from './systemPrompt.js';

const CEREBRAS_URL =
  'https://api.cerebras.ai/v1/chat/completions';

const MODEL = 'gpt-oss-120b';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const WEB_SEARCH_TOOL = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web when the user needs current, recent, ' +
        'real-time, external, or specialized information. ' +
        'Do not use this tool for ordinary reasoning, mathematics, ' +
        'creative writing, or coding questions that do not require ' +
        'external information.',

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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function sse(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function normalizeUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function parseArgs(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function stripThinking(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trimStart();
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
      `SearXNG HTTP ${resp.status}`
    );
  }

  const data = await resp.json();

  const results = Array.isArray(data.results)
    ? data.results.slice(0, 6)
    : [];

  return await Promise.all(
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

async function writeError(writer, encoder, message) {
  await writer.write(
    encoder.encode(
      sse({
        error: String(message),
      })
    )
  );

  await writer.write(
    encoder.encode('data: [DONE]\n\n')
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { error: 'Invalid request body' },
      400
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
    return jsonResponse(
      { error: 'Empty query' },
      400
    );
  }

  if (!env?.CEREBRAS_API_KEY) {
    return jsonResponse(
      {
        error:
          'CEREBRAS_API_KEY is not configured.',
      },
      500
    );
  }

  if (!env?.SEARXNG_URL) {
    return jsonResponse(
      {
        error:
          'SEARXNG_URL is not configured.',
      },
      500
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

  (async () => {
    try {
      /*
       * ======================================================
       * CALL #1
       * ======================================================
       */

      const call1 =
        await fetch(CEREBRAS_URL, {
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

            tools: WEB_SEARCH_TOOL,

            tool_choice: 'auto',

            parallel_tool_calls: true,

            stream: false,

            max_completion_tokens: 2048,

            temperature: 0.6,
          }),
        });

      if (!call1.ok) {
        const errorText =
          await call1.text();

        console.error(
          'CEREBRAS CALL #1:',
          call1.status,
          errorText
        );

        await writeError(
          writer,
          encoder,
          `Cerebras Call #1 failed (${call1.status}): ${errorText}`
        );

        await writer.close();
        return;
      }

      const call1Data =
        await call1.json();

      const assistant =
        call1Data?.choices?.[0]?.message;

      if (!assistant) {
        await writeError(
          writer,
          encoder,
          'Cerebras returned no assistant message.'
        );

        await writer.close();
        return;
      }

      const toolCalls =
        Array.isArray(assistant.tool_calls)
          ? assistant.tool_calls
          : [];

      /*
       * ======================================================
       * DIRECT ANSWER
       * ======================================================
       */

      if (toolCalls.length === 0) {
        const answer =
          stripThinking(
            assistant.content || ''
          );

        const chunks =
          answer.match(/[\s\S]{1,64}/g) || [''];

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
       * ======================================================
       * EXECUTE ALL TOOL CALLS
       * ======================================================
       */

      const toolMessages = [];
      const frontendResults = [];

      for (const toolCall of toolCalls) {
        const functionName =
          toolCall?.function?.name || '';

        const toolCallId =
          toolCall?.id || '';

        const args =
          parseArgs(
            toolCall?.function?.arguments
          );

        if (
          functionName !==
          'web_search'
        ) {
          toolMessages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: 'Unknown tool.',
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
            tool_call_id: toolCallId,
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
            'SEARXNG ERROR:',
            err
          );
        }

        frontendResults.push(
          ...results
        );

        let toolContent =
          'No results found.';

        if (results.length > 0) {
          toolContent =
            results
              .map(
                (r, i) =>
                  `[${i + 1}] ${r.title}\n` +
                  `URL: ${r.url}\n` +
                  `${r.snippet}`
              )
              .join('\n\n');
        }

        /*
         * IMPORTANT:
         * Every tool_call gets exactly one
         * corresponding tool message.
         */

        toolMessages.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: toolContent,
        });
      }

      /*
       * Send search results to frontend.
       */

      if (frontendResults.length > 0) {
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
       * ======================================================
       * CALL #2
       * ======================================================
       *
       * EXACT ORDER:
       *
       * original messages
       * assistant tool-call message
       * tool result messages
       */

      const call2Messages = [
        ...messages,

        {
          role: 'assistant',

          /*
           * Keep content exactly as returned.
           * null is valid when assistant only emitted
           * tool calls.
           */
          content:
            assistant.content ?? null,

          tool_calls:
            toolCalls,
        },

        ...toolMessages,
      ];

      const call2 =
        await fetch(CEREBRAS_URL, {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${env.CEREBRAS_API_KEY}`,
          },

          body: JSON.stringify({
            model: MODEL,

            messages:
              call2Messages,

            stream: true,

            max_completion_tokens: 2048,

            temperature: 0.6,
          }),
        });

      if (!call2.ok) {
        const errorText =
          await call2.text();

        console.error(
          'CEREBRAS CALL #2:',
          call2.status,
          errorText
        );

        await writeError(
          writer,
          encoder,
          `Cerebras Call #2 failed (${call2.status}): ${errorText}`
        );

        await writer.close();
        return;
      }

      /*
       * ======================================================
       * STREAM CALL #2
       * ======================================================
       */

      const reader =
        call2.body.getReader();

      const decoder =
        new TextDecoder('utf-8');

      let buffer = '';

      let sentDone = false;

      while (true) {
        const {
          done,
          value,
        } = await reader.read();

        if (done) break;

        buffer += decoder.decode(
          value,
          { stream: true }
        );

        /*
         * SSE events are separated by
         * a blank line.
         */

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

            if (
              payload === '[DONE]'
            ) {
              if (!sentDone) {
                sentDone = true;

                await writer.write(
                  encoder.encode(
                    'data: [DONE]\n\n'
                  )
                );
              }

              continue;
            }

            let parsed;

            try {
              parsed =
                JSON.parse(payload);
            } catch {
              continue;
            }

            const choice =
              parsed?.choices?.[0];

            const delta =
              choice?.delta;

            const content =
              delta?.content;

            /*
             * Forward non-text metadata.
             */

            if (
              typeof content !==
              'string'
            ) {
              await writer.write(
                encoder.encode(
                  sse(parsed)
                )
              );

              continue;
            }

            const clean =
              stripThinking(
                content
              );

            if (!clean) {
              continue;
            }

            const output = {
              ...parsed,

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
        }
      }

      /*
       * Flush any remaining decoder bytes.
       */

      buffer += decoder.decode();

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
        'HANDLER ERROR:',
        err
      );

      try {
        await writeError(
          writer,
          encoder,
          err?.stack ||
            String(err)
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
