/**
 * App-wide read cache — memory + sessionStorage, stale-while-revalidate.
 * Speeds tab switches and repeat visits; never caches auth tokens.
 */

const STORAGE_PREFIX = "bfm-cache:v1:";
const MAX_STORAGE_BYTES = 450_000;

/** @type {Map<string, { value: unknown, expiresAt: number }>} */
const memory = new Map();

export const CacheTTL = {
  SHOPPERS: 3 * 60 * 1000,
  SHOPPER: 5 * 60 * 1000,
  WISHLIST: 2 * 60 * 1000,
  CART: 2 * 60 * 1000,
  ORDERS: 45 * 1000,
  CONVERSATIONS: 30 * 1000,
};

function storageKey(key) {
  return `${STORAGE_PREFIX}${key}`;
}

function isFresh(entry) {
  return entry && entry.expiresAt > Date.now();
}

function readStorage(key) {
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!isFresh(entry)) {
      sessionStorage.removeItem(storageKey(key));
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function writeStorage(key, entry) {
  try {
    const raw = JSON.stringify(entry);
    if (raw.length > MAX_STORAGE_BYTES) return;
    sessionStorage.setItem(storageKey(key), raw);
  } catch {
    /* quota — memory cache still works */
  }
}

/** @returns {unknown|null} */
export function cacheGet(key) {
  const mem = memory.get(key);
  if (isFresh(mem)) return mem.value;

  const stored = readStorage(key);
  if (stored) {
    memory.set(key, stored);
    return stored.value;
  }
  return null;
}

export function cacheSet(key, value, ttlMs) {
  const entry = { value, expiresAt: Date.now() + ttlMs };
  memory.set(key, entry);
  writeStorage(key, entry);
}

/** @type {Map<string, number>} */
const cacheGeneration = new Map();

function bumpCacheGeneration(key) {
  cacheGeneration.set(key, (cacheGeneration.get(key) || 0) + 1);
}

function cacheGenerationMatches(key, gen) {
  return (cacheGeneration.get(key) || 0) === gen;
}

export function cacheInvalidate(key) {
  memory.delete(key);
  bumpCacheGeneration(key);
  try {
    sessionStorage.removeItem(storageKey(key));
  } catch {
    /* ignore */
  }
}

export function cacheInvalidatePrefix(prefix) {
  for (const key of [...memory.keys()]) {
    if (key.startsWith(prefix)) {
      memory.delete(key);
      bumpCacheGeneration(key);
    }
  }
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(STORAGE_PREFIX + prefix)) {
        const bareKey = k.slice(STORAGE_PREFIX.length);
        bumpCacheGeneration(bareKey);
        sessionStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore */
  }
}

export function clearAppCache() {
  memory.clear();
  cacheGeneration.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Return cached data instantly when available; refresh in background.
 * @template T
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<T>} fetcher
 * @param {{ onUpdate?: (data: T) => void, force?: boolean }} [opts]
 * @returns {Promise<T>}
 */
export async function cacheFetch(key, ttlMs, fetcher, opts = {}) {
  const cached = opts.force ? null : cacheGet(key);
  const genAtStart = cacheGeneration.get(key) || 0;

  const refresh = () => {
    const gen = cacheGeneration.get(key) || 0;
    return fetcher()
      .then((data) => {
        if (!cacheGenerationMatches(key, gen)) return data;
        cacheSet(key, data, ttlMs);
        return data;
      })
      .catch((err) => {
        if (cached != null) return cached;
        throw err;
      });
  };

  if (cached != null) {
    refresh().then((fresh) => {
      if (!cacheGenerationMatches(key, genAtStart)) return;
      if (opts.onUpdate && JSON.stringify(fresh) !== JSON.stringify(cached)) {
        opts.onUpdate(fresh);
      }
    });
    return /** @type {T} */ (cached);
  }

  const fresh = await refresh();
  return fresh;
}

/** Prefetch common buyer data after login / shell init. */
export function warmBuyerCache(uid) {
  if (!uid) return;

  const run = () => {
    import("./api/users.js")
      .then((m) => m.fetchAllPublicShoppers())
      .catch(() => {});

    import("./api/wishlist.js")
      .then((m) => m.fetchWishlist(uid))
      .catch(() => {});

    import("./api/cart.js")
      .then((m) => m.fetchCart(uid))
      .catch(() => {});

    import("./api/orders.js")
      .then((m) => m.fetchOrdersForBuyer(uid))
      .catch(() => {});

    import("./chat-local.js")
      .then((m) => m.getConversationSummaries(uid))
      .catch(() => {});
  };

  if ("requestIdleCallback" in window) {
    requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 400);
  }
}

/** Invalidate user-scoped lists after mutations. */
export function invalidateBuyerLists(uid) {
  if (!uid) return;
  cacheInvalidate(`wishlist:${uid}`);
  cacheInvalidate(`cart:${uid}`);
  cacheInvalidate(`orders:${uid}`);
  cacheInvalidate(`conversations:${uid}`);
}

document.addEventListener("bfm-buyer-badges", () => {
  /* Badge refresh often follows mutations — soft-invalidate short-TTL lists */
  const uid = window.__bfmCacheUid;
  if (uid) {
    cacheInvalidate(`orders:${uid}`);
    cacheInvalidate(`conversations:${uid}`);
  }
});

/** Set during shell init for badge invalidation hook. */
export function setCacheUserId(uid) {
  if (uid) window.__bfmCacheUid = String(uid);
  else delete window.__bfmCacheUid;
}
