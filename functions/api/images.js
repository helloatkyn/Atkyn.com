/* functions/api/images.js
   Cloudflare Pages Function

   ONE upstream API call
   Maximum Serper Images results (100)
   Minimal production response
   No secondary web-search request
   No dead suggestion/source-card logic
*/

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim();

  if (!q) {
    return json(
      { error: 'Empty query' },
      400
    );
  }

  if (!env.SERPER_API_KEY) {
    return json(
      { error: 'SERPER_API_KEY is not configured' },
      500
    );
  }

  const controller = new AbortController();

  /*
    Protect the worker from hanging indefinitely.
    Serper normally returns quickly, but a hard timeout
    keeps the request lifecycle production-safe.
  */
  const timeout = setTimeout(
    () => controller.abort(),
    15000
  );

  try {
    /*
      ONE AND ONLY ONE upstream request.

      Serper Images supports 1–100 results per request.
      100 is therefore the maximum requested page size.
    */
    const response = await fetch(
      'https://google.serper.dev/images',
      {
        method: 'POST',

        headers: {
          'X-API-KEY': env.SERPER_API_KEY,
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          q,
          num: 100,

          /*
            India-focused results for Atkyn.
            Keep both locale signals explicit.
          */
          gl: 'in',
          hl: 'en',

          autocorrect: true
        }),

        signal: controller.signal
      }
    );


    if (!response.ok) {
      const message =
        await response.text().catch(
          () => ''
        );

      return json(
        {
          error:
            message ||
            `Serper request failed (${response.status})`
        },
        502
      );
    }


    const data =
      await response.json();


    /*
      Serper Images returns its image collection
      under `images`.
    */
    const images =
      Array.isArray(data.images)
        ? data.images
        : [];


    /*
      Normalize only the fields Atkyn actually needs.
      This keeps the response smaller and faster.
    */
    const results = images
      .map((img) => ({
        title:
          typeof img.title === 'string'
            ? img.title
            : '',

        url:
          typeof img.link === 'string'
            ? img.link
            : '',

        img_src:
          typeof img.imageUrl === 'string'
            ? img.imageUrl
            : '',

        thumbnail_src:
          typeof img.thumbnailUrl === 'string'
            ? img.thumbnailUrl
            : '',

        width:
          Number.isFinite(img.imageWidth)
            ? img.imageWidth
            : 0,

        height:
          Number.isFinite(img.imageHeight)
            ? img.imageHeight
            : 0
      }))
      .filter(
        (img) =>
          img.img_src
      );


    /*
      Remove duplicate image URLs while
      preserving Google's original ranking order.
    */
    const seen = new Set();

    const uniqueResults = [];

    for (const image of results) {
      if (seen.has(image.img_src)) {
        continue;
      }

      seen.add(image.img_src);
      uniqueResults.push(image);
    }


    return json({
      results: uniqueResults
    });

  } catch (error) {

    const message =
      error?.name === 'AbortError'
        ? 'Image search timed out'
        : 'Image search failed';

    return json(
      { error: message },
      502
    );

  } finally {
    clearTimeout(timeout);
  }
}


/*
  Small response helper.
  Same-origin frontend does not need the previous
  wildcard CORS implementation.
*/
function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        'Content-Type':
          'application/json; charset=utf-8',

        /*
          Search results should not be blindly
          persisted by intermediary caches.
        */
        'Cache-Control':
          'no-store'
      }
    }
  );
}
