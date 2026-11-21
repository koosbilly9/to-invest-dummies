import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../cloudflare/worker.js", import.meta.url), "utf8");
const { default: worker } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

const SITE = "https://koosbilly9.github.io";
const OTHER = "https://example.com";
const env = {
  MARKET_RATE_LIMITER: {
    calls: [],
    async limit(input) {
      this.calls.push(input);
      return { success: true };
    },
  },
};

function request(path = "/listings", options = {}) {
  const headers = new Headers({ Origin: SITE, "CF-Connecting-IP": "192.0.2.10" });
  new Headers(options.headers).forEach((value, name) => headers.set(name, value));
  return new Request(`https://invest-dummies-data.example${path}`, { ...options, headers });
}

async function withFetch(mock, run) {
  const original = globalThis.fetch;
  const originalError = console.error;
  globalThis.fetch = mock;
  console.error = () => {};
  try {
    await run();
  } finally {
    globalThis.fetch = original;
    console.error = originalError;
  }
}

test("allows the configured origin and rejects unknown origins", async () => {
  await withFetch(async () => new Response('{"data":[]}'), async () => {
    const allowed = await worker.fetch(request(), env);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), SITE);

    const rejected = await worker.fetch(
      request("/listings", { headers: { Origin: OTHER } }),
      env,
    );
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(env.MARKET_RATE_LIMITER.calls.length, 1);
  });
});

test("serves only known routes and known index symbols", async () => {
  await withFetch(async (url) => {
    assert.match(url, /chart\/%5EGSPC\?range=5y&interval=1d$/);
    return new Response(JSON.stringify({
      chart: {
        result: [{
          meta: { currency: "USD" },
          timestamp: [1795132800],
          indicators: { quote: [{ close: [6000], high: [6010], low: [5990] }] },
        }],
      },
    }), { headers: { "Content-Type": "application/json" } });
  }, async () => {
    const response = await worker.fetch(request("/history?asset=sp500"), env);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).points, [[1795132800000, 6000, 6010, 5990]]);
    assert.equal((await worker.fetch(request("/history?asset=other"), env)).status, 400);
    assert.equal((await worker.fetch(request("/missing"), env)).status, 404);
  });
});

test("rejects methods and requires a working rate limiter", async () => {
  await withFetch(async () => {
    throw new Error("upstream must not be called");
  }, async () => {
    assert.equal((await worker.fetch(request("/listings", { method: "POST" }), env)).status, 405);
    assert.equal((await worker.fetch(request(), {})).status, 503);
  });
});

test("serves the global market endpoint through the public CMC route", async () => {
  await withFetch(async (url) => {
    assert.equal(
      url,
      "https://pro-api.coinmarketcap.com/public-api/v1/global-metrics/quotes/latest?convert=USD",
    );
    return new Response('{"data":{"quote":{"USD":{"total_market_cap":100}}}}');
  }, async () => {
    const response = await worker.fetch(request("/global"), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.quote.USD.total_market_cap, 100);
  });
});
