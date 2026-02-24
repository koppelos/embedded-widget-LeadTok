function toOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

export function createSecurity({ embedOrigins, serverOrigin, logger }) {
  // normalize once; runtime checks can then stay cheap and predictable
  const allowedOrigins = new Set(
    embedOrigins
      .map((origin) => toOrigin(origin))
      .filter(Boolean)
  );
  const trustedServerOrigin = toOrigin(serverOrigin);

  function resolveAllowed(allowSelf) {
    const resolved = new Set(allowedOrigins);
    if (allowSelf && trustedServerOrigin) resolved.add(trustedServerOrigin);
    return resolved;
  }

  function isAllowedEmbed(req, opts = {}) {
    // accept either origin or referer checks
    const allowSelf = !!opts.allowSelf;
    const rawOrigin = String(req.headers.origin || "").trim();
    const rawReferer = String(req.headers.referer || "").trim();
    const origin = toOrigin(rawOrigin);
    const refererOrigin = toOrigin(rawReferer);

    const allowed = resolveAllowed(allowSelf);
    const byOrigin = origin && allowed.has(origin);
    const byReferer = refererOrigin && allowed.has(refererOrigin);
    return byOrigin || byReferer;
  }

  function forbidIfBlocked(req, res, opts = {}) {
    // route level protection used by /frame and /sse endpoints.
    if (isAllowedEmbed(req, opts)) return false;

    logger("forbid_by_origin", {
      route: opts.route || "unknown",
      origin: String(req.headers.origin || ""),
      referer: String(req.headers.referer || ""),
      ip: req.socket.remoteAddress || "unknown",
    });
    res.status(403).send("Forbidden (origin)");
    return true;
  }

  function setCorsIfAllowed(req, res, opts = {}) {
    // reflect only allowlisted origins
    const allowSelf = !!opts.allowSelf;
    const origin = toOrigin(req.headers.origin);
    if (!origin) return;

    const allowed = resolveAllowed(allowSelf);
    if (!allowed.has(origin)) return;

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  function frameAncestorsDirective() {
    // used in CSP for iframe embedding restriction
    const list = [...allowedOrigins];
    return list.length ? `frame-ancestors ${list.join(" ")}` : "frame-ancestors 'self'";
  }

  return {
    frameAncestorsDirective,
    forbidIfBlocked,
    setCorsIfAllowed,
  };
}
