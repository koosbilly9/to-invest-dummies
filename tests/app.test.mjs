import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { calculateIndicators, percentBelowHigh, sentiment } = require("../app.js");

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
