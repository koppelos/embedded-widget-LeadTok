import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRouteHandlers, staticHeaders } from "../src/routes.js";

function makeReq({ query = {}, headers = {}, ip = "127.0.0.1" } = {}) {
  const req = new EventEmitter();
  req.query = query;
  req.headers = headers;
  req.socket = { remoteAddress: ip };
  return req;
}

function makeRes() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: undefined,
    jsonBody: undefined,
    sentFile: "",
    ended: false,
    flushed: false,
    writes: [],
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      this.ended = true;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
    flushHeaders() {
      this.flushed = true;
    },
    write(chunk) {
      this.writes.push(String(chunk));
    },
    sendFile(filePath) {
      this.sentFile = filePath;
      return this;
    },
  };
}

function buildDeps(overrides = {}) {
  const calls = {
    parseSymbolsInput: null,
    addClient: null,
    sendInitial: 0,
    sendError: 0,
    corsCalls: 0,
  };

  const security = overrides.security || {
    forbidIfBlocked() {
      return false;
    },
    frameAncestorsDirective() {
      return "frame-ancestors https://client.example";
    },
    setCorsIfAllowed() {
      calls.corsCalls += 1;
    },
  };

  const ratesService = overrides.ratesService || {
    parseSymbols(input) {
      calls.parseSymbolsInput = input;
      return ["EUR", "USD"];
    },
    keyOf(base, symbolsArr) {
      return `${base}__${symbolsArr.join(",")}`;
    },
  };

  const sseHub = overrides.sseHub || {
    canAccept() {
      return { ok: true };
    },
    addClient(payload) {
      calls.addClient = payload;
      return { key: payload.key };
    },
    async sendInitial() {
      calls.sendInitial += 1;
    },
    sendError() {
      calls.sendError += 1;
    },
  };

  const config = {
    defaultBase: "PLN",
    defaultSymbols: "EUR,USD,CHF,GBP,DKK",
  };

  const handlers = createRouteHandlers({
    publicDir: "/tmp/public",
    config,
    security,
    ratesService,
    sseHub,
  });

  return { handlers, calls };
}

test("frame route sets CSP and sends frame file", () => {
  const { handlers } = buildDeps();
  const req = makeReq();
  const res = makeRes();

  handlers.frame(req, res);

  assert.match(res.getHeader("content-security-policy"), /frame-ancestors https:\/\/client\.example/);
  assert.equal(res.getHeader("cross-origin-resource-policy"), "cross-origin");
  assert.equal(res.sentFile, "/tmp/public/frame.html");
});

test("frame route exits early when forbidden", () => {
  const { handlers } = buildDeps({
    security: {
      forbidIfBlocked() {
        return true;
      },
      frameAncestorsDirective() {
        return "frame-ancestors https://client.example";
      },
      setCorsIfAllowed() {},
    },
  });

  const req = makeReq();
  const res = makeRes();
  handlers.frame(req, res);

  assert.equal(res.sentFile, "");
});

test("sse options sets preflight headers", () => {
  const { handlers } = buildDeps();
  const req = makeReq();
  const res = makeRes();

  handlers.sseOptions(req, res);

  assert.equal(res.statusCode, 204);
  assert.equal(res.getHeader("access-control-allow-methods"), "GET,OPTIONS");
  assert.equal(res.getHeader("access-control-allow-headers"), "Content-Type");
  assert.equal(res.ended, true);
});

test("sse route uses defaults, sets SSE headers and initializes client", async () => {
  const { handlers, calls } = buildDeps();
  const req = makeReq({ query: {}, headers: {} });
  const res = makeRes();

  await handlers.sseRates(req, res);

  assert.equal(calls.parseSymbolsInput, "EUR,USD,CHF,GBP,DKK");
  assert.equal(calls.addClient.base, "PLN");
  assert.equal(res.getHeader("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(res.getHeader("cache-control"), "no-cache, no-transform");
  assert.equal(res.getHeader("connection"), "keep-alive");
  assert.equal(res.flushed, true);
  assert.equal(calls.sendInitial, 1);
});

test("sse route returns 400 when symbols are empty", async () => {
  const { handlers } = buildDeps({
    ratesService: {
      parseSymbols() {
        return [];
      },
      keyOf() {
        return "unused";
      },
    },
  });

  const req = makeReq({ query: {} });
  const res = makeRes();

  await handlers.sseRates(req, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.jsonBody, { error: "symbols required" });
});

test("sse route returns 429 when capacity guard fails", async () => {
  const { handlers } = buildDeps({
    sseHub: {
      canAccept() {
        return { ok: false, status: 429, message: "Too many SSE connections (ip)" };
      },
      addClient() {
        throw new Error("should not be called");
      },
      async sendInitial() {},
      sendError() {},
    },
  });

  const req = makeReq({ query: {} });
  const res = makeRes();

  await handlers.sseRates(req, res);

  assert.equal(res.statusCode, 429);
  assert.equal(res.body, "Too many SSE connections (ip)");
});

test("sse route forwards init errors to sseHub.sendError", async () => {
  const { handlers, calls } = buildDeps({
    sseHub: {
      canAccept() {
        return { ok: true };
      },
      addClient(payload) {
        return { key: payload.key };
      },
      async sendInitial() {
        throw new Error("boom");
      },
      sendError() {
        calls.sendError += 1;
      },
    },
  });

  const req = makeReq({ query: {} });
  const res = makeRes();

  await handlers.sseRates(req, res);

  assert.equal(calls.sendError, 1);
});

test("staticHeaders sets CORP only for widget.js", () => {
  const resA = makeRes();
  const resB = makeRes();

  staticHeaders(resA, "/any/path/widget.js");
  staticHeaders(resB, "/any/path/frame.js");

  assert.equal(resA.getHeader("cross-origin-resource-policy"), "cross-origin");
  assert.equal(resB.getHeader("cross-origin-resource-policy"), undefined);
});
