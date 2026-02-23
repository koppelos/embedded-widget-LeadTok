import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("loadConfig uses safe defaults in non-production", () => {
  const cfg = loadConfig({});
  assert.equal(cfg.port, 3000);
  assert.equal(cfg.serverOrigin, "http://localhost:3000");
  assert.deepEqual(cfg.embedOrigins, ["http://localhost:3000"]);
  assert.equal(cfg.strictHttps, false);
});

test("loadConfig rejects wildcard origins", () => {
  assert.throws(
    () => loadConfig({ EMBED_ORIGINS: "https://*.client.example", SERVER_ORIGIN: "https://widget.example" }),
    /wildcard/i
  );
});

test("loadConfig rejects origins with path/query/hash", () => {
  assert.throws(
    () => loadConfig({ EMBED_ORIGINS: "https://client.example/path", SERVER_ORIGIN: "https://widget.example" }),
    /exact origin/i
  );
  assert.throws(
    () => loadConfig({ EMBED_ORIGINS: "https://client.example?x=1", SERVER_ORIGIN: "https://widget.example" }),
    /exact origin/i
  );
});

test("loadConfig enforces https in production", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        SERVER_ORIGIN: "http://widget.example",
        EMBED_ORIGINS: "https://client.example",
      }),
    /HTTPS required/i
  );

  const ok = loadConfig({
    NODE_ENV: "production",
    SERVER_ORIGIN: "https://widget.example",
    EMBED_ORIGINS: "https://client.example",
  });
  assert.equal(ok.strictHttps, true);
  assert.equal(ok.serverOrigin, "https://widget.example");
  assert.deepEqual(ok.embedOrigins, ["https://client.example"]);
});

test("loadConfig supports explicit REQUIRE_HTTPS", () => {
  assert.throws(
    () =>
      loadConfig({
        REQUIRE_HTTPS: "true",
        SERVER_ORIGIN: "http://widget.example",
        EMBED_ORIGINS: "http://client.example",
      }),
    /HTTPS required/i
  );
});
