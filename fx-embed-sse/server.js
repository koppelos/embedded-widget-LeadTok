import express from "express";
import helmet from "helmet";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const EMBED_ORIGINS = String(process.env.EMBED_ORIGINS || "http://localhost:3000,http://localhost:5173")
  .split(",").map(s => s.trim()).filter(Boolean);

const MAX_SSE_CONNECTIONS_GLOBAL = Number(process.env.MAX_SSE_GLOBAL || 50);
const MAX_SSE_CONNECTIONS_PER_IP = Number(process.env.MAX_SSE_PER_IP || 3);

app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: false,
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.disable("x-powered-by");

// keep static for css/js
app.use(express.static(path.join(__dirname, "public"), { maxAge: "0" }));

function getClientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "");
  return xf.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
}

function isAllowedEmbed(req) {
  const origin = String(req.headers.origin || "").trim();
  const referer = String(req.headers.referer || "").trim();

  const byOrigin = origin && EMBED_ORIGINS.includes(origin);
  const byReferer = referer && EMBED_ORIGINS.some((o) => referer.startsWith(o));
  const direct = !origin && !referer;
  return byOrigin || byReferer || direct;
}

function setCorsIfAllowed(req, res) {
  const origin = String(req.headers.origin || "").trim();
  if (origin && EMBED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
}

function sseSend(res, event, obj) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function parseSymbols(s) {
  return String(s || "")
    .split(",")
    .map(x => x.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 10);
}

function keyOf(base, symbolsArr) {
  // stable cache key (symbols sorted)
  const syms = [...symbolsArr].sort().join(",");
  return `${base}__${syms}`;
}

// ---- Provider cache (PER KEY) ----
const fetchEveryMs = 60_000;
const ratesCache = new Map(); // key -> { last, lastFetchedAt, inflight }

async function fetchFrankfurter(base, symbolsArr) {
  const to = encodeURIComponent(symbolsArr.join(","));
  const from = encodeURIComponent(base);
  const url = `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`;

  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Frankfurter HTTP ${r.status}`);

  const j = await r.json();
  return { base: j.base, rates: j.rates, date: j.date, ts: Date.now(), source: "frankfurter" };
}

async function getRates(base, symbolsArr) {
  const key = keyOf(base, symbolsArr);
  const now = Date.now();

  let entry = ratesCache.get(key);
  if (!entry) {
    entry = { last: null, lastFetchedAt: 0, inflight: null };
    ratesCache.set(key, entry);
  }

  const stale = now - entry.lastFetchedAt > fetchEveryMs;

  if (entry.last && !stale) return { data: entry.last, stale: false, key };

  if (!entry.inflight) {
    entry.inflight = (async () => {
      try {
        const data = await fetchFrankfurter(base, symbolsArr);
        entry.last = data;
        entry.lastFetchedAt = Date.now();
        return data;
      } finally {
        entry.inflight = null;
      }
    })();
  }

  if (entry.last) return { data: entry.last, stale: true, key };
  const first = await entry.inflight;
  return { data: first, stale: false, key };
}

// ---- SSE ----
const clients = new Set(); // { res, ip, base, symbolsArr, key }
const activeSseByIp = new Map(); // ip -> count
const lastBroadcastTsByKey = new Map(); // key -> ts

function incSse(ip) {
  const n = activeSseByIp.get(ip) || 0;
  activeSseByIp.set(ip, n + 1);
  return n + 1;
}
function decSse(ip) {
  const n = activeSseByIp.get(ip) || 0;
  const next = Math.max(0, n - 1);
  if (next === 0) activeSseByIp.delete(ip);
  else activeSseByIp.set(ip, next);
  return next;
}

// ---- ROUTES ----
app.get("/demo", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "demo.html"));
});

// widget.js must be loadable cross-origin (Brave)
app.get("/widget.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.sendFile(path.join(__dirname, "public", "widget.js"));
});

app.get("/frame", (req, res) => {
  if (!isAllowedEmbed(req)) return res.status(403).send("Forbidden (origin)");

  const frameAncestors = EMBED_ORIGINS.length
    ? `frame-ancestors ${EMBED_ORIGINS.join(" ")}`
    : "frame-ancestors 'self'";

  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
    frameAncestors,
  ].join("; "));

  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.sendFile(path.join(__dirname, "public", "frame.html"));
});

app.options("/sse/rates", (req, res) => {
  setCorsIfAllowed(req, res);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.status(204).end();
});

app.get("/sse/rates", async (req, res) => {
  const ip = getClientIp(req);

  if (!isAllowedEmbed(req)) return res.status(403).send("Forbidden (origin)");
  if (clients.size >= MAX_SSE_CONNECTIONS_GLOBAL) return res.status(429).send("Too many SSE connections (global)");
  if ((activeSseByIp.get(ip) || 0) >= MAX_SSE_CONNECTIONS_PER_IP) return res.status(429).send("Too many SSE connections (ip)");

  const base = String(req.query.base || "PLN").toUpperCase();
  const symbolsArr = parseSymbols(req.query.symbols || "EUR,USD,CHF,GBP,DKK");
  if (!symbolsArr.length) return res.status(400).json({ error: "symbols required" });

  const key = keyOf(base, symbolsArr);

  setCorsIfAllowed(req, res);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  incSse(ip);
  const client = { res, ip, base, symbolsArr, key };
  clients.add(client);

  console.log("[SSE] connect", { ip, base, symbolsArr, key, clients: clients.size });

  try {
    const { data, stale } = await getRates(base, symbolsArr);
    sseSend(res, "status", { stage: "connected", stale, key, providerFetchEveryMs: fetchEveryMs, providerLastFetchAt: ratesCache.get(key)?.lastFetchedAt || 0 });
    sseSend(res, "rates", { ...data, stale, key });
  } catch (e) {
    sseSend(res, "status", { stage: "error", message: String(e?.message || e) });
  }

  const hb = setInterval(() => {
    sseSend(res, "status", { stage: "alive", ts: Date.now(), key, providerLastFetchAt: ratesCache.get(key)?.lastFetchedAt || 0 });
  }, 15_000);

  req.on("close", () => {
    clearInterval(hb);
    clients.delete(client);
    const left = decSse(ip);
    console.log("[SSE] close", { ip, key, clients: clients.size, ipActive: left });
  });
});

// broadcast per key (no mixing params)
setInterval(async () => {
  if (clients.size === 0) return;

  const keys = new Map(); // key -> { base, symbolsArr }
  for (const c of clients) {
    if (!keys.has(c.key)) keys.set(c.key, { base: c.base, symbolsArr: c.symbolsArr });
  }

  for (const [key, cfg] of keys.entries()) {
    try {
      const { data, stale } = await getRates(cfg.base, cfg.symbolsArr);
      const lastTs = lastBroadcastTsByKey.get(key) || 0;

      if (data.ts !== lastTs) {
        lastBroadcastTsByKey.set(key, data.ts);
        for (const c of clients) {
          if (c.key === key) sseSend(c.res, "rates", { ...data, stale, key });
        }
      }
    } catch (e) {
      for (const c of clients) {
        if (c.key === key) sseSend(c.res, "status", { stage: "error", message: String(e?.message || e), key });
      }
    }
  }
}, 2_000);

app.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}/demo`);
  console.log(`Allowed embed origins: ${EMBED_ORIGINS.join(", ")}`);
});