import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  build3dPieSvg,
  buildMoneyMarketPayload,
  calculateIndicators,
  parseMoneywebGraph,
  parseStooqCsv,
  parseYahooChart,
  percentClass,
  percentBelowHigh,
  currentPriceClass,
  ma200ValueClass,
  sentiment,
} = require("../app.js");

test("calculates five-year candle extremes and the completed 200-day cycle", () => {
  const points = Array.from({ length: 220 }, (_, index) => [
    Date.UTC(2025, 0, index + 1),
    index < 219 ? 100 + index : 50,
    index < 219 ? 101 + index : 51,
    index === 219 ? 49 : index === 0 ? 90 : 99 + index,
  ]);
  const result = calculateIndicators(points);
  assert.equal(result.current, 50);
  assert.equal(result.high, 319);
  assert.equal(result.low, 49);
  assert.equal(result.ma200, 218.155);
  assert.equal(result.cycle, "Bear");
});

test("calculates percentage below five-year high", () => {
  assert.equal(percentBelowHigh(80, 100), 20);
  assert.equal(percentBelowHigh(105, 100), 0);
  assert.equal(percentBelowHigh(null, 100), null);
});

test("colors the percentage below the five-year high by the specified bands", () => {
  assert.equal(percentClass(10), "percent-warning");
  assert.equal(percentClass(10.01), "");
  assert.equal(percentClass(40), "");
  assert.equal(percentClass(40.01), "percent-good");
  assert.equal(percentClass(41), "percent-good");
  assert.equal(percentClass(null), "");
});

test("colors only a current price below MA 200 Dy green", () => {
  assert.equal(currentPriceClass(95, 100), "positive");
  assert.equal(currentPriceClass(100, 100), "");
  assert.equal(currentPriceClass(105, 100), "");
  assert.equal(currentPriceClass(null, 100), "");
});

test("colors only an MA 200 Dy value above the current price green", () => {
  assert.equal(ma200ValueClass(95, 100), "positive");
  assert.equal(ma200ValueClass(100, 100), "");
  assert.equal(ma200ValueClass(105, 100), "");
  assert.equal(ma200ValueClass(95, null), "");
});

test("classifies RSI bands and validates malformed market history", () => {
  assert.equal(sentiment(29).text, "Oversold");
  assert.equal(sentiment(30).text, "Neutral");
  assert.equal(sentiment(70).text, "Neutral");
  assert.equal(sentiment(71).text, "Overbought");
  assert.equal(sentiment(undefined).text, "n/a");
  assert.equal(sentiment(null).text, "n/a");
  assert.throws(() => calculateIndicators([[1, 0]]), /Invalid price history/);
  assert.throws(() => calculateIndicators([[86400000, 1], [86400000, 2]]), /Invalid price history/);
});

test("parses Stooq CSV and Yahoo chart JSON history", () => {
  const csv = "Date,Open,High,Low,Close,Volume\n2026-11-18,5890,5910,5870,5900,100\n2026-11-19,5900,5950,5880,5920,100\n";
  const stooqPoints = parseStooqCsv(csv);
  assert.deepEqual(stooqPoints, [
    [Date.UTC(2026, 10, 18), 5900, 5910, 5870],
    [Date.UTC(2026, 10, 19), 5920, 5950, 5880],
  ]);

  const yahooPoints = parseYahooChart({
    chart: {
      result: [{
        timestamp: [Date.UTC(2026, 10, 19, 14, 30) / 1000],
        indicators: { quote: [{ close: [5920], high: [5950], low: [5880] }] },
      }],
    },
  });
  assert.deepEqual(yahooPoints, [[Date.UTC(2026, 10, 19), 5920, 5950, 5880]]);

  const mwPoints = parseMoneywebGraph({
    CNTF: [{ id: "CNTF", dt: "2026-11-19T00:00:00", c: "24711.00" }],
  }, "CNTF");
  assert.deepEqual(mwPoints, [[Date.UTC(2026, 10, 19), 247.11, 247.11, 247.11]]);
});

test("builds money market breakdown with live or fallback crypto market cap", () => {
  const payload = buildMoneyMarketPayload(2.0, Date.UTC(2026, 10, 21));
  assert.equal(payload.totalTrillions, 132.8);
  assert.equal(payload.assets.length, 4);
  assert.deepEqual(payload.assets[0], {
    name: "Global Fiat (M2)",
    valueTrillions: 103.9,
    sharePercent: 78.24,
    color: "#2563eb",
  });
  assert.deepEqual(payload.assets[3], {
    name: "Cryptocurrencies",
    valueTrillions: 2.0,
    sharePercent: 1.51,
    color: "#10b981",
  });

  const svg = build3dPieSvg(payload);
  assert.match(svg, /78\.2%/);
  assert.match(svg, /18\.5%/);
  assert.match(svg, /1\.73%/);
  assert.match(svg, /1\.51%/);
  assert.match(svg, /Global Fiat \(M2\) · \$103\.9T/);
});
