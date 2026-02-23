function normalizeBase(value) {
  return String(value || "").trim().toUpperCase();
}

export function parseSymbols(value, maxSymbols = 10) {
  return String(value || "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, maxSymbols);
}

export function keyOf(base, symbolsArr) {
  const sorted = [...symbolsArr].sort().join(",");
  return `${normalizeBase(base)}__${sorted}`;
}

export function createRatesService({ fetchEveryMs, logger, fetchImpl = fetch }) {
  const cache = new Map(); // key -> { last, lastFetchedAt, inflight }

  async function fetchFrankfurter(base, symbolsArr) {
    const encodedBase = encodeURIComponent(base);
    const encodedSymbols = encodeURIComponent(symbolsArr.join(","));
    const url = `https://api.frankfurter.dev/v1/latest?base=${encodedBase}&symbols=${encodedSymbols}`;

    try {
      const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`Frankfurter HTTP ${response.status}`);
      }

      const payload = await response.json();
      const data = {
        base: payload.base,
        rates: payload.rates,
        date: payload.date,
        ts: Date.now(),
        source: "frankfurter",
      };

      logger("upstream_fetch_success", {
        provider: "frankfurter",
        base,
        symbols: symbolsArr.join(","),
        date: payload.date,
      });
      return data;
    } catch (error) {
      logger("upstream_fetch_error", {
        provider: "frankfurter",
        base,
        symbols: symbolsArr.join(","),
        message: String(error?.message || error),
      });
      throw error;
    }
  }

  async function getRates(base, symbolsArr) {
    const normalizedBase = normalizeBase(base);
    const key = keyOf(normalizedBase, symbolsArr);
    const now = Date.now();

    let entry = cache.get(key);
    if (!entry) {
      entry = { last: null, lastFetchedAt: 0, inflight: null };
      cache.set(key, entry);
    }

    const stale = now - entry.lastFetchedAt > fetchEveryMs;
    if (entry.last && !stale) return { data: entry.last, stale: false, key };

    if (!entry.inflight) {
      entry.inflight = (async () => {
        try {
          const fresh = await fetchFrankfurter(normalizedBase, symbolsArr);
          entry.last = fresh;
          entry.lastFetchedAt = Date.now();
          return fresh;
        } finally {
          entry.inflight = null;
        }
      })();
    }

    if (entry.last) return { data: entry.last, stale: true, key };
    const first = await entry.inflight;
    return { data: first, stale: false, key };
  }

  function getLastFetchedAt(key) {
    return cache.get(key)?.lastFetchedAt || 0;
  }

  return {
    parseSymbols,
    keyOf,
    getRates,
    getLastFetchedAt,
  };
}
