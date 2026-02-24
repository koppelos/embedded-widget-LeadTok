import test from "node:test";
import assert from "node:assert/strict";
import { createSecurity } from "../src/security.js";

function makeReq({ origin = "", referer = "", host = "localhost:3000", protocol = "http" } = {}) {
  return {
    protocol,
    headers: {
      origin,
      referer,
    },
    socket: { remoteAddress: "127.0.0.1" },
    get(name) {
      if (name.toLowerCase() === "host") return host;
      return "";
    },
  };
}

function makeRes() {
  const headers = new Map();
  return {
    code: 200,
    body: "",
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    status(code) {
      this.code = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
  };
}

function buildSecurity(logs = []) {
  return createSecurity({
    embedOrigins: ["https://partner.example", "http://localhost:5173", "not-an-origin"],
    serverOrigin: "http://localhost:3000",
    logger: (event, fields) => logs.push({ event, fields }),
  });
}

test("forbidIfBlocked allows configured origin", () => {
  const logs = [];
  const security = buildSecurity(logs);
  const req = makeReq({ origin: "http://localhost:5173" });
  const res = makeRes();

  const blocked = security.forbidIfBlocked(req, res, { route: "/frame" });
  assert.equal(blocked, false);
  assert.equal(logs.length, 0);
});

test("forbidIfBlocked rejects spoofed referer prefix", () => {
  const logs = [];
  const security = buildSecurity(logs);
  const req = makeReq({ referer: "https://partner.example.evil.tld/page" });
  const res = makeRes();

  const blocked = security.forbidIfBlocked(req, res, { route: "/frame" });
  assert.equal(blocked, true);
  assert.equal(res.code, 403);
  assert.ok(logs.some((x) => x.event === "forbid_by_origin"));
});

test("forbidIfBlocked rejects malformed or null origin headers", () => {
  const logs = [];
  const security = buildSecurity(logs);

  const malformed = makeReq({ origin: "http://%%%" });
  const nullOrigin = makeReq({ origin: "null" });
  const malformedRes = makeRes();
  const nullRes = makeRes();

  assert.equal(security.forbidIfBlocked(malformed, malformedRes, { route: "/frame" }), true);
  assert.equal(security.forbidIfBlocked(nullOrigin, nullRes, { route: "/frame" }), true);
  assert.equal(malformedRes.code, 403);
  assert.equal(nullRes.code, 403);
  assert.ok(logs.length >= 2);
});

test("direct requests with no origin/referer are blocked by default", () => {
  const security = buildSecurity();
  const req = makeReq({ origin: "", referer: "" });
  const res = makeRes();

  const blocked = security.forbidIfBlocked(req, res, { route: "/frame" });
  assert.equal(blocked, true);
  assert.equal(res.code, 403);
});

test("allowSelf allows configured server origin only", () => {
  const security = buildSecurity();

  const selfReq = makeReq({ origin: "http://localhost:3000", host: "evil.example" });
  const nonSelfReq = makeReq({ origin: "http://attacker.example", host: "attacker.example" });
  const selfRes = makeRes();
  const nonSelfRes = makeRes();

  assert.equal(security.forbidIfBlocked(selfReq, selfRes, { route: "/sse/rates", allowSelf: true }), false);
  assert.equal(security.forbidIfBlocked(nonSelfReq, nonSelfRes, { route: "/sse/rates", allowSelf: true }), true);
});

test("setCorsIfAllowed sets CORS only for allowed origins", () => {
  const security = buildSecurity();

  const allowedReq = makeReq({ origin: "http://localhost:5173" });
  const deniedReq = makeReq({ origin: "http://localhost:9999" });
  const allowedRes = makeRes();
  const deniedRes = makeRes();

  security.setCorsIfAllowed(allowedReq, allowedRes, {});
  security.setCorsIfAllowed(deniedReq, deniedRes, {});

  assert.equal(allowedRes.getHeader("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(deniedRes.getHeader("access-control-allow-origin"), undefined);
});

test("setCorsIfAllowed supports allowSelf for server origin", () => {
  const security = buildSecurity();
  const req = makeReq({ origin: "http://localhost:3000", host: "fake-host.example" });
  const res = makeRes();

  security.setCorsIfAllowed(req, res, { allowSelf: true });
  assert.equal(res.getHeader("access-control-allow-origin"), "http://localhost:3000");
});

test("frameAncestorsDirective emits only normalized allowed origins", () => {
  const security = buildSecurity();
  const directive = security.frameAncestorsDirective();

  assert.match(directive, /^frame-ancestors /);
  assert.match(directive, /https:\/\/partner\.example/);
  assert.match(directive, /http:\/\/localhost:5173/);
  assert.doesNotMatch(directive, /not-an-origin/);
});
