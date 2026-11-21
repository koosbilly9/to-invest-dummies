# Invest like a dummy

A static, single-page market snapshot for BTC, ETH, SOL, the S&P 500, Nasdaq 100, and Coronation Top 20.

## Data and indicators

- Crypto prices and market caps: CoinMarketCap. Crypto history: Binance daily candles.
- Index history: Yahoo Finance daily candles for `^GSPC` and `^NDX`.
- Fear/greed: Alternative.me's crypto index, shown for crypto only.
- Oversold/overbought: RSI(14), under 30/over 70. Bull/bear: latest completed close above/below its 200-day simple moving average.
- Five-year high/low: highest daily candle high and lowest daily candle low over the available five-year history.
- Market-cap share: each crypto's CoinMarketCap market cap divided by CoinMarketCap's total market cap. It does not apply to equity indexes or the fund.

The Coronation Top 20 unit trust is not a listed index. This project has no verified public daily NAV/history feed for it, so the row is present but its values are explicitly unavailable. Do not treat it as the FTSE/JSE Top 20 or Top 40 index.

## Deploy

The front end is static and can be hosted on GitHub Pages. Deploy the proxy from this directory with Wrangler 4.36.0 or later:

1. Choose a positive, unique rate-limit `namespace_id` in `wrangler.toml`.
2. Add the deployed website origin to `ALLOWED_ORIGINS` in `cloudflare/worker.js`.
3. Set `WORKER` in `app.js` to the deployed Worker URL.
4. Run `npx wrangler deploy`.
5. Optionally add a CoinMarketCap key with `npx wrangler secret put CMC_KEY`; without it, the Worker uses public CoinMarketCap endpoints.

The Worker rate limiter is per Cloudflare location and is approximate, not a global quota. Market data is cached by the upstream cache and in the visitor's browser. The browser cache lasts one hour.

## Tests

Run `node --test tests/*.test.mjs`.
