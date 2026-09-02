/* modules/images/images.js — Atkyn production image gallery
   One API call • up to 100 results • high-res first • stable geometry
   Random editorial gallery • no Wikipedia • no pagination • no title suffix
*/

let _imageCache = new Map();
let _seen = new Set();
let _gallery = null;
let _observer = null;
let _query = '';
let _warmQueue = [];
let _warmRunning = false;
let _warmGeneration = 0;

function _cleanTitle(value) {
  return String(value || '')
    .replace(/(?:\s*[.…]{2,}\s*)+$/u, '')
    .replace(/\s*[|•·–—-]\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(' ');
}

function _normalizeImage(item) {
  if (!item || typeof item !== 'object') return null;

  const src = String(item.img_src || item.imageUrl || '').trim();
  if (!src) return null;

  const width = Number(item.width || item.imageWidth || 0);
  const height = Number(item.height || item.imageHeight || 0);

  return {
    title: _cleanTitle(item.title),
    url: String(item.url || item.link || '').trim(),
    img_src: src,
    thumbnail_src: String(
      item.thumbnail_src || item.thumbnailUrl || ''
    ).trim(),
    width: width > 0 ? width : 1,
    height: height > 0 ? height : 1
  };
}

function _extractResults(data) {
  const source = Array.isArray(data)
    ? data
    : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data?.images)
        ? data.images
        : [];

  const results = [];
  const localSeen = new Set();

  for (const item of source) {
    const image = _normalizeImage(item);
    if (!image) continue;

    const key = image.img_src;
    if (localSeen.has(key)) continue;

    localSeen.add(key);
    results.push(image);
  }

  return results;
}

function _preloadImage(src) {
  if (!src) return Promise.reject(new Error('Missing image source'));

  if (_imageCache.has(src)) {
    return _imageCache.get(src);
  }

  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = 'high';

    image.onload = async () => {
      try {
        if (typeof image.decode === 'function') {
          await image.decode().catch(() => {});
        }
      } finally {
        resolve(image);
      }
    };

    image.onerror = () => reject(new Error('Image failed to load'));
    image.src = src;
  });

  _imageCache.set(src, promise);

  promise.catch(() => {
    if (_imageCache.get(src) === promise) {
      _imageCache.delete(src);
    }
  });

  return promise;
}

async function _loadTileImage(tile, item) {
  const image = tile.querySelector('.img-tile__spacer img');
  if (!image || !item) return;

  try {
    const loaded = await _preloadImage(item.img_src);

    if (!tile.isConnected) return;

    image.src = loaded.currentSrc || loaded.src || item.img_src;
    image.classList.add('img-loaded');
    tile.classList.add('is-loaded');
    return;
  } catch (_) {
    // Use the thumbnail only if the full-resolution source actually fails.
  }

  if (item.thumbnail_src && item.thumbnail_src !== item.img_src) {
    try {
      const fallback = await _preloadImage(item.thumbnail_src);

      if (!tile.isConnected) return;

      image.src =
        fallback.currentSrc || fallback.src || item.thumbnail_src;
      image.classList.add('img-loaded');
      tile.classList.add('is-loaded', 'is-fallback');
    } catch (_) {
      // Keep the reserved tile geometry intact.
    }
  }
}

function _createTile(item) {
  const tile = document.createElement('article');
  tile.className = 'img-tile';

  const ratio = item.width / item.height;
  const safeRatio =
    Number.isFinite(ratio) && ratio > 0
      ? Math.min(Math.max(ratio, 0.35), 3)
      : 1;

  tile.style.setProperty('--img-ratio', String(safeRatio));

  const spacer = document.createElement('div');
  spacer.className = 'img-tile__spacer';

  const image = document.createElement('img');
  image.alt = item.title || 'Image';
  image.loading = 'eager';
  image.decoding = 'async';
  image.fetchPriority = 'high';

  spacer.appendChild(image);
  tile.appendChild(spacer);

  const overlay = document.createElement('div');
  overlay.className = 'img-tile__overlay';

  if (item.title) {
    const title = document.createElement('div');
    title.className = 'img-tile__title';
    title.textContent = item.title;
    overlay.appendChild(title);
  }

  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'img-tile__menu';
  menu.setAttribute('aria-label', 'Image options');
  menu.textContent = '•••';

  menu.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();

    if (item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    }
  });

  overlay.appendChild(menu);
  tile.appendChild(overlay);

  return tile;
}

function _seededRandom(seed) {
  let value = seed >>> 0;

  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _shuffle(items, random) {
  const array = items.slice();

  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }

  return array;
}

function _buildGallery(results) {
  const container =
    document.querySelector('.images-grid') ||
    document.querySelector('#images-grid');

  if (!container) return;

  _gallery = container;
  _gallery.replaceChildren();

  const seed =
    Array.from(_query).reduce(
      (hash, char) => ((hash * 31 + char.charCodeAt(0)) >>> 0),
      2166136261
    );

  const random = _seededRandom(seed);
  const shuffled = _shuffle(results, random);

  const fragment = document.createDocumentFragment();

  if (shuffled.length > 0) {
    const hero = document.createElement('section');
    hero.className = 'gallery-hero';

    const heroTile = _createTile(shuffled[0]);
    hero.appendChild(heroTile);
    fragment.appendChild(hero);

    _gallery._items = [{ tile: heroTile, item: shuffled[0] }];
  } else {
    _gallery._items = [];
  }

  let index = 1;
  let makeHero = true;

  while (index < shuffled.length) {
    const useHero = makeHero && random() < 0.45;

    if (useHero) {
      const section = document.createElement('section');
      section.className = 'gallery-hero';

      const tile = _createTile(shuffled[index]);
      section.appendChild(tile);
      fragment.appendChild(section);

      _gallery._items.push({
        tile,
        item: shuffled[index]
      });

      index += 1;
      makeHero = false;
      continue;
    }

    const section = document.createElement('section');
    section.className = 'gallery-grid';

    const left = document.createElement('div');
    const right = document.createElement('div');

    left.className = 'gallery-col';
    right.className = 'gallery-col';

    const count = Math.min(
      shuffled.length - index,
      2 + Math.floor(random() * 3)
    );

    for (let i = 0; i < count; i++) {
      const item = shuffled[index++];
      const tile = _createTile(item);

      const target = i % 2 === 0 ? left : right;
      target.appendChild(tile);

      _gallery._items.push({ tile, item });
    }

    section.append(left, right);
    fragment.appendChild(section);

    makeHero = random() > 0.4;
  }

  _gallery.appendChild(fragment);
}

function _observeTiles() {
  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }

  if (!_gallery?._items?.length) return;

  _observer = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        const record = entry.target._galleryRecord;
        if (!record) continue;

        _loadTileImage(record.tile, record.item);
        _observer.unobserve(entry.target);
      }
    },
    {
      root: null,
      rootMargin: '2500px 0px',
      threshold: 0
    }
  );

  for (const record of _gallery._items) {
    record.tile._galleryRecord = record;
    _observer.observe(record.tile);
  }
}

async function _warmFirstImages(generation) {
  if (generation !== _warmGeneration) return;

  const records = (_gallery?._items || []).slice(0, 8);

  await Promise.all(
    records.map(record => _preloadImage(record.item.img_src).catch(() => {}))
  );
}

function _startIdleWarm(generation) {
  if (_warmRunning || generation !== _warmGeneration) return;

  _warmRunning = true;

  const run = async () => {
    while (_warmQueue.length && generation === _warmGeneration) {
      const item = _warmQueue.shift();

      if (item?.img_src) {
        await _preloadImage(item.img_src).catch(() => {});
      }

      if (_warmQueue.length) {
        await new Promise(resolve => {
          if ('requestIdleCallback' in window) {
            window.requestIdleCallback(
              () => resolve(),
              { timeout: 250 }
            );
          } else {
            setTimeout(resolve, 16);
          }
        });
      }
    }

    _warmRunning = false;
  };

  run();
}

async function _fetchImages(query) {
  const endpoint =
    '/api/images?q=' + encodeURIComponent(query);

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Image search failed: ${response.status}`);
  }

  return response.json();
}

export async function searchImages(query) {
  _query = String(query || '').trim();

  if (!_query) {
    if (_gallery) _gallery.replaceChildren();
    return [];
  }

  _warmGeneration += 1;
  const generation = _warmGeneration;

  _warmQueue = [];
  _seen.clear();

  try {
    const data = await _fetchImages(_query);
    const results = _extractResults(data);

    const uniqueResults = [];

    for (const item of results) {
      if (_seen.has(item.img_src)) continue;

      _seen.add(item.img_src);
      uniqueResults.push(item);
    }

    _buildGallery(uniqueResults);
    _observeTiles();

    _warmQueue = uniqueResults.slice(8);

    await _warmFirstImages(generation);
    _startIdleWarm(generation);

    return uniqueResults;
  } catch (error) {
    console.error('[Atkyn Images]', error);

    if (_gallery) {
      _gallery.replaceChildren();
    }

    return [];
  }
}

export async function loadImages(query) {
  return searchImages(query);
}

export default {
  searchImages,
  loadImages
};
