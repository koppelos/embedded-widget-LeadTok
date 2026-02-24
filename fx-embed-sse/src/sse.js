function sseSend(res, event, obj) {
  // SSE framing helper
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
  if (typeof res.flush === "function") res.flush();
}

export function createSseHub({
  maxGlobalConnections,
  maxPerIpConnections,
  heartbeatMs,
  broadcastEveryMs,
  fetchEveryMs,
  ratesService,
  logger,
}) {
  const clients = new Set(); //  res, ip, base, symbolsArr, key, hb, closeHandler 
  const activeByIp = new Map(); // ip - count
  const lastBroadcastTsByKey = new Map(); // key - ts

  let broadcastTimer = null;
  let broadcastInFlight = false;

  function canAccept(ip) {
    // hard limits protect the process against connection abuse
    if (clients.size >= maxGlobalConnections) {
      return { ok: false, status: 429, message: "Too many SSE connections (global)" };
    }
    if ((activeByIp.get(ip) || 0) >= maxPerIpConnections) {
      return { ok: false, status: 429, message: "Too many SSE connections (ip)" };
    }
    return { ok: true };
  }

  function incIp(ip) {
    const next = (activeByIp.get(ip) || 0) + 1;
    activeByIp.set(ip, next);
    return next;
  }

  function decIp(ip) {
    const next = Math.max(0, (activeByIp.get(ip) || 0) - 1);
    if (next === 0) activeByIp.delete(ip);
    else activeByIp.set(ip, next);
    return next;
  }

  function addClient({ req, res, ip, base, symbolsArr, key }) {
    // register client and start heartbeat
    incIp(ip);
    const client = { req, res, ip, base, symbolsArr, key, hb: null, closeHandler: null };
    clients.add(client);

    logger("sse_connect", {
      ip,
      base,
      symbols: symbolsArr.join(","),
      key,
      clients: clients.size,
    });

    client.hb = setInterval(() => {
      sseSend(res, "status", {
        stage: "alive",
        ts: Date.now(),
        key,
        providerLastFetchAt: ratesService.getLastFetchedAt(key),
      });
    }, heartbeatMs);

    client.closeHandler = () => removeClient(client);
    req.on("close", client.closeHandler);

    return client;
  }

  function removeClient(client) {
    // cleanup path for socket close and manual removal
    if (!clients.has(client)) return;

    clearInterval(client.hb);
    clients.delete(client);
    if (client.closeHandler) client.req.off("close", client.closeHandler);

    const ipActive = decIp(client.ip);
    logger("sse_close", {
      ip: client.ip,
      key: client.key,
      clients: clients.size,
      ipActive,
    });
  }

  async function sendInitial(client) {
    // fast initial snapshot so the widget renders quick
    const { data, stale } = await ratesService.getRates(client.base, client.symbolsArr);
    sseSend(client.res, "status", {
      stage: "connected",
      stale,
      key: client.key,
      providerFetchEveryMs: fetchEveryMs,
      providerLastFetchAt: ratesService.getLastFetchedAt(client.key),
    });
    sseSend(client.res, "rates", { ...data, stale, key: client.key });
  }

  function sendError(client, error) {
    sseSend(client.res, "status", {
      stage: "error",
      message: String(error?.message || error),
      key: client.key,
    });
  }

  async function broadcastTick() {
    if (clients.size === 0) return;

    // group by cache key to avoid duplicate upstream calls for identical configs
    const byKey = new Map(); // key -  base, symbolsArr
    for (const client of clients) {
      if (!byKey.has(client.key)) {
        byKey.set(client.key, { base: client.base, symbolsArr: client.symbolsArr });
      }
    }

    for (const [key, cfg] of byKey.entries()) {
      try {
        const { data, stale } = await ratesService.getRates(cfg.base, cfg.symbolsArr);
        const lastTs = lastBroadcastTsByKey.get(key) || 0;
        if (data.ts === lastTs) continue;

        lastBroadcastTsByKey.set(key, data.ts);
        for (const client of clients) {
          if (client.key === key) {
            sseSend(client.res, "rates", { ...data, stale, key });
          }
        }
      } catch (error) {
        for (const client of clients) {
          if (client.key === key) sendError(client, error);
        }
      }
    }
  }

  function startBroadcast() {
    if (broadcastTimer) return;
    // overlap guard prevents piling up ticks on slow upstream calls
    broadcastTimer = setInterval(() => {
      if (broadcastInFlight) return;
      broadcastInFlight = true;
      void Promise.resolve(broadcastTick()).finally(() => {
        broadcastInFlight = false;
      });
    }, broadcastEveryMs);
  }

  function stopBroadcast() {
    if (!broadcastTimer) return;
    clearInterval(broadcastTimer);
    broadcastTimer = null;
    broadcastInFlight = false;
  }

  return {
    addClient,
    broadcastOnce: broadcastTick,
    canAccept,
    sendError,
    sendInitial,
    startBroadcast,
    stopBroadcast,
  };
}
