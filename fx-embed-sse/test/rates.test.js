import test from "node:test";
import assert from "node:assert/strict";
import { createRatesService, keyOf, parseSymbols } from "../src/rates.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("parseSymbols normalizes symbols and applies max", () => {
  const parsed = parseSymbols(" eur, usd, ,chf,gbp, dkk ");
  assert.deepEqual(parsed, ["EUR", "USD", "CHF", "GBP", "DKK"]);

  const capped = parseSymbols("a,b,c,d,e,f,g,h,i,j,k", 3);
  assert.deepEqual(capped, ["A", "B", "C"]);
});

test("keyOf normalizes base and sorts symbols", () => {
  assert.equal(keyOf("pln", ["USD", "EUR"]), "PLN__EUR,USD");
});

test("getRates returns fresh cache and avoids duplicate fetch", async () => {
  const logs = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      async json() {
        return { base: "PLN", rates: { EUR: 0.23 }, date: "2026-02-23" };
      },
    };
  };

  const service = createRatesService({
    fetchEveryMs: 60_000,
    logger: (event, fields) => logs.push({ event, fields }),
    fetchImpl,
  });

  const first = await service.getRates("PLN", ["EUR"]);
  const second = await service.getRates("PLN", ["EUR"]);

  assert.equal(first.stale, false);
  assert.equal(second.stale, false);
  assert.equal(calls, 1);
  assert.equal(logs.filter((x) => x.event === "upstream_fetch_success").length, 1);
});

test("getRates serves stale cache while refresh is inflight", async () => {
  const logs = [];
  let calls = 0;
  const d = deferred();

  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: true,
        async json() {
          return { base: "PLN", rates: { EUR: 0.25 }, date: "2026-02-23" };
        },
      };
    }

    await d.promise;
    return {
      ok: true,
      async json() {
        return { base: "PLN", rates: { EUR: 0.2 }, date: "2026-02-24" };
      },
    };
  };

  const service = createRatesService({
    fetchEveryMs: 1,
    logger: (event, fields) => logs.push({ event, fields }),
    fetchImpl,
  });

  const first = await service.getRates("PLN", ["EUR"]);
  await new Promise((r) => setTimeout(r, 5));
  const stale = await service.getRates("PLN", ["EUR"]);

  assert.equal(first.stale, false);
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.data.rates, first.data.rates);
  assert.equal(calls, 2);

  d.resolve();
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(logs.some((x) => x.event === "upstream_fetch_success"));
});

test("getRates logs upstream error", async () => {
  const logs = [];
  const service = createRatesService({
    fetchEveryMs: 1000,
    logger: (event, fields) => logs.push({ event, fields }),
    fetchImpl: async () => ({ ok: false, status: 500, async json() { return {}; } }),
  });

  await assert.rejects(service.getRates("PLN", ["EUR"]));
  assert.ok(logs.some((x) => x.event === "upstream_fetch_error"));
});
