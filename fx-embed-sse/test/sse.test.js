import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createSseHub } from "../src/sse.js";

function makeReq() {
  return new EventEmitter();
}

function makeRes() {
  return {
    writes: [],
    write(chunk) {
      this.writes.push(chunk);
    },
    flush() {},
  };
}

test("sse hub enforces per-ip limit and releases on close", () => {
  const logs = [];
  const hub = createSseHub({
    maxGlobalConnections: 2,
    maxPerIpConnections: 1,
    heartbeatMs: 10_000,
    broadcastEveryMs: 10_000,
    fetchEveryMs: 60_000,
    ratesService: {
      async getRates() {
        return { data: { ts: 1, rates: {} }, stale: false };
      },
      getLastFetchedAt() {
        return 0;
      },
    },
    logger: (event, fields) => logs.push({ event, fields }),
  });

  const req = makeReq();
  const res = makeRes();

  assert.equal(hub.canAccept("1.1.1.1").ok, true);
  hub.addClient({ req, res, ip: "1.1.1.1", base: "PLN", symbolsArr: ["EUR"], key: "PLN__EUR" });
  assert.equal(hub.canAccept("1.1.1.1").ok, false);

  req.emit("close");
  assert.equal(hub.canAccept("1.1.1.1").ok, true);

  assert.ok(logs.some((x) => x.event === "sse_connect"));
  assert.ok(logs.some((x) => x.event === "sse_close"));

  hub.stopBroadcast();
});

test("sendInitial sends status and rates events", async () => {
  const hub = createSseHub({
    maxGlobalConnections: 5,
    maxPerIpConnections: 5,
    heartbeatMs: 10_000,
    broadcastEveryMs: 10_000,
    fetchEveryMs: 60_000,
    ratesService: {
      async getRates() {
        return {
          data: { ts: 123, base: "PLN", rates: { EUR: 0.25 }, date: "2026-02-23", source: "frankfurter" },
          stale: false,
        };
      },
      getLastFetchedAt() {
        return 222;
      },
    },
    logger: () => {},
  });

  const req = makeReq();
  const res = makeRes();
  const client = hub.addClient({
    req,
    res,
    ip: "2.2.2.2",
    base: "PLN",
    symbolsArr: ["EUR"],
    key: "PLN__EUR",
  });

  await hub.sendInitial(client);
  const joined = res.writes.join("");
  assert.match(joined, /event: status/);
  assert.match(joined, /event: rates/);
  assert.match(joined, /"providerLastFetchAt":222/);

  req.emit("close");
  hub.stopBroadcast();
});

test("broadcastOnce isolates data per cache key", async () => {
  const calls = [];
  const hub = createSseHub({
    maxGlobalConnections: 10,
    maxPerIpConnections: 10,
    heartbeatMs: 10_000,
    broadcastEveryMs: 10_000,
    fetchEveryMs: 60_000,
    ratesService: {
      async getRates(base, symbolsArr) {
        const key = `${base}__${symbolsArr.join(",")}`;
        calls.push(key);
        if (key === "PLN__EUR") {
          return { data: { ts: 111, rates: { EUR: 1 } }, stale: false };
        }
        return { data: { ts: 222, rates: { USD: 2 } }, stale: false };
      },
      getLastFetchedAt() {
        return 0;
      },
    },
    logger: () => {},
  });

  const reqA = makeReq();
  const reqB = makeReq();
  const resA = makeRes();
  const resB = makeRes();

  hub.addClient({ req: reqA, res: resA, ip: "1.1.1.1", base: "PLN", symbolsArr: ["EUR"], key: "PLN__EUR" });
  hub.addClient({ req: reqB, res: resB, ip: "2.2.2.2", base: "PLN", symbolsArr: ["USD"], key: "PLN__USD" });

  await hub.broadcastOnce();

  const payloadA = resA.writes.join("");
  const payloadB = resB.writes.join("");
  assert.match(payloadA, /"EUR":1/);
  assert.doesNotMatch(payloadA, /"USD":2/);
  assert.match(payloadB, /"USD":2/);
  assert.doesNotMatch(payloadB, /"EUR":1/);
  assert.deepEqual(calls.sort(), ["PLN__EUR", "PLN__USD"]);

  reqA.emit("close");
  reqB.emit("close");
  hub.stopBroadcast();
});

test("broadcastOnce sends error only to affected key", async () => {
  const hub = createSseHub({
    maxGlobalConnections: 10,
    maxPerIpConnections: 10,
    heartbeatMs: 10_000,
    broadcastEveryMs: 10_000,
    fetchEveryMs: 60_000,
    ratesService: {
      async getRates(base, symbolsArr) {
        if (`${base}__${symbolsArr.join(",")}` === "PLN__EUR") {
          throw new Error("fetch failed");
        }
        return { data: { ts: 9, rates: { USD: 2 } }, stale: false };
      },
      getLastFetchedAt() {
        return 0;
      },
    },
    logger: () => {},
  });

  const reqA = makeReq();
  const reqB = makeReq();
  const resA = makeRes();
  const resB = makeRes();

  hub.addClient({ req: reqA, res: resA, ip: "1.1.1.1", base: "PLN", symbolsArr: ["EUR"], key: "PLN__EUR" });
  hub.addClient({ req: reqB, res: resB, ip: "2.2.2.2", base: "PLN", symbolsArr: ["USD"], key: "PLN__USD" });

  await hub.broadcastOnce();

  assert.match(resA.writes.join(""), /event: status/);
  assert.match(resA.writes.join(""), /fetch failed/);
  assert.doesNotMatch(resB.writes.join(""), /fetch failed/);
  assert.match(resB.writes.join(""), /"USD":2/);

  reqA.emit("close");
  reqB.emit("close");
  hub.stopBroadcast();
});
