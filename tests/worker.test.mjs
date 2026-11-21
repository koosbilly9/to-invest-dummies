import test from "node:test";
import assert from "node:assert/strict";
import worker, { buildMoneyMarketData } from "../cloudflare/worker.js";

test("buildMoneyMarketData computes trillions and percentage shares", () => {
  const now = new Date("2026-11-21T12:00:00.000Z");
  const result = buildMoneyMarketData(2.0, {}, now);
  assert.equal(result.updatedAt, "2026-11-21T12:00:00.000Z");
  assert.equal(result.totalTrillions, 132.8);
  assert.deepEqual(result.assets, [
    { name: "Global Fiat (M2)", valueTrillions: 103.9, sharePercent: 78.24, color: "#2563eb" },
    { name: "Gold", valueTrillions: 24.6, sharePercent: 18.52, color: "#eab308" },
    { name: "Silver", valueTrillions: 2.3, sharePercent: 1.73, color: "#94a3b8" },
    { name: "Cryptocurrencies", valueTrillions: 2.0, sharePercent: 1.51, color: "#10b981" },
  ]);
});

test("GET /api/money-market returns live CoinGecko total market cap and falls back to $2.0T on failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  console.error = () => {};
  try {
    globalThis.fetch = async (url) => {
      assert.equal(url, "https://api.coingecko.com/api/v3/global");
      return new Response(JSON.stringify({
        data: { total_market_cap: { usd: 3100000000000 } },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const req = new Request("https://to-invest-dummies.example/api/money-market", {
      headers: { Origin: "https://example.org" },
    });
    const res = await worker.fetch(req, {});
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(res.headers.get("Cache-Control"), "public, max-age=3600");
    const body = await res.json();
    assert.equal(body.totalTrillions, 133.9);
    assert.equal(body.assets[3].valueTrillions, 3.1);

    globalThis.fetch = async () => new Response("rate limited", { status: 429 });
    const fallbackRes = await worker.fetch(req, {});
    assert.equal(fallbackRes.status, 200);
    const fallbackBody = await fallbackRes.json();
    assert.equal(fallbackBody.totalTrillions, 132.8);
    assert.equal(fallbackBody.assets[3].valueTrillions, 2.0);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
