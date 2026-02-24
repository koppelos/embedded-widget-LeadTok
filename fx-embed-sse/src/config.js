function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseExactOrigin(raw, label) {
  const value = String(raw || "").trim();
  if (!value) throw new Error(`${label} cannot be empty`);
  if (value.includes("*")) throw new Error(`${label} cannot contain wildcard (*)`);

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute origin`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} must use http or https`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} cannot contain credentials`);
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${label} must be an exact origin without path/query/hash`);
  }
  return parsed.origin;
}

function isTrue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseTrustProxy(value, fallback) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  if (isTrue(raw)) return true;
  if (["0", "false", "no"].includes(raw.toLowerCase())) return false;

  const maybeNum = Number(raw);
  if (Number.isInteger(maybeNum) && maybeNum >= 0) return maybeNum;

  // Express also supports string forms like "loopback, linklocal, uniquelocal".
  return raw;
}

function assertHttpsOrigins(serverOrigin, embedOrigins) {
  const targets = [serverOrigin, ...embedOrigins];
  for (const origin of targets) {
    const protocol = new URL(origin).protocol;
    if (protocol !== "https:") {
      throw new Error(`HTTPS required, got non-https origin: ${origin}`);
    }
  }
}

export function loadConfig(env = process.env) {
  const port = toPositiveInt(env.PORT, 3000);
  const defaultServerOrigin = `http://localhost:${port}`;
  const isProduction = String(env.NODE_ENV || "").trim() === "production";

  const strictHttps = isTrue(env.REQUIRE_HTTPS) || isProduction;
  const serverOrigin = parseExactOrigin(env.SERVER_ORIGIN || defaultServerOrigin, "SERVER_ORIGIN");
  const embedOrigins = splitCsv(env.EMBED_ORIGINS || serverOrigin)
    .map((value, idx) => parseExactOrigin(value, `EMBED_ORIGINS[${idx}]`));

  if (strictHttps) assertHttpsOrigins(serverOrigin, embedOrigins);

  return {
    port,
    embedOrigins,
    serverOrigin,
    strictHttps,
    trustProxy: parseTrustProxy(env.TRUST_PROXY, isProduction ? 1 : false),
    fetchEveryMs: toPositiveInt(env.FETCH_EVERY_MS, 60_000),
    broadcastEveryMs: toPositiveInt(env.BROADCAST_EVERY_MS, 2_000),
    heartbeatMs: toPositiveInt(env.HEARTBEAT_MS, 15_000),
    maxSseGlobal: toPositiveInt(env.MAX_SSE_GLOBAL, 50),
    maxSsePerIp: toPositiveInt(env.MAX_SSE_PER_IP, 3),
    defaultBase: String(env.DEFAULT_BASE || "PLN").toUpperCase(),
    defaultSymbols: String(env.DEFAULT_SYMBOLS || "EUR,USD,CHF,GBP,DKK"),
  };
}
