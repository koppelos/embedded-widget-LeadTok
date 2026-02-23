import path from "path";

export function getClientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "");
  return xff.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
}

export function staticHeaders(res, filePath) {
  if (path.basename(filePath) === "widget.js") {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  }
}

export function createRouteHandlers({ publicDir, config, security, ratesService, sseHub }) {
  function demo(req, res) {
    res.sendFile(path.join(publicDir, "demo.html"));
  }

  function frame(req, res) {
    if (security.forbidIfBlocked(req, res, { route: "/frame" })) return;

    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        "img-src 'self' data:",
        security.frameAncestorsDirective(),
      ].join("; ")
    );
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.sendFile(path.join(publicDir, "frame.html"));
  }

  function sseOptions(req, res) {
    security.setCorsIfAllowed(req, res, { allowSelf: true });
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
  }

  async function sseRates(req, res) {
    if (security.forbidIfBlocked(req, res, { allowSelf: true, route: "/sse/rates" })) return;

    const ip = getClientIp(req);
    const guard = sseHub.canAccept(ip);
    if (!guard.ok) return res.status(guard.status).send(guard.message);

    const base = String(req.query.base || config.defaultBase).toUpperCase();
    const symbolsArr = ratesService.parseSymbols(req.query.symbols || config.defaultSymbols);
    if (!symbolsArr.length) return res.status(400).json({ error: "symbols required" });

    const key = ratesService.keyOf(base, symbolsArr);

    security.setCorsIfAllowed(req, res, { allowSelf: true });
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const client = sseHub.addClient({ req, res, ip, base, symbolsArr, key });

    try {
      await sseHub.sendInitial(client);
    } catch (error) {
      sseHub.sendError(client, error);
    }
  }

  return {
    demo,
    frame,
    sseOptions,
    sseRates,
  };
}
