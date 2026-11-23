# Invest like a dummy

A static, single-page market snapshot for BTC, ZEC, ETH, SOL, the S&P 500, Nasdaq 100, and Coronation Top 20.

## Data and indicators

- Crypto prices: CoinMarketCap. Crypto history: Binance daily candles.
- Index history: Yahoo Finance (`^GSPC` and `^NDX` chart API and history page fallback) and Stooq (`^spx` and `^ndx` free daily CSV feed).
- Coronation Top 20 history: Moneyweb / ProfileData five-year daily unit trust NAV feed (`CNTF`, converted from South African cents per unit to `ZAR`).
- Global money vs. hard assets pie chart: `GET /api/money-market` on `cloudflare/worker.js` serves Global Fiat M2 (`$103.9T`), Gold (`$24.6T`), Silver (`$2.3T`), and live total cryptocurrency market cap from CoinGecko `/api/v3/global` (`$2.0T` fallback), cached for 1 hour via `caches.default` and rendered with Chart.js.
- Fear/greed: Alternative.me's crypto index, shown for crypto only.
- Oversold/overbought: RSI(14), under 30/over 70. Bull/bear: latest completed close above/below its 200-day simple moving average.
- Five-year high/low: highest daily candle high and lowest daily candle low over the available five-year history.
- MA200: the latest completed close's 200-day simple moving average. % below: the percentage current price is below the available five-year high.

## Deploy and refresh

The front end is static and can be hosted on GitHub Pages. It uses the `to-invest-dummies` Worker in `cloudflare/worker.js` for market-data requests. From this project root, run `bun x wrangler deploy`, then reload the page or press **Refresh data**. The Worker has its own `CMC_RATE_LIMITER` binding and supports an optional `CMC_KEY` secret.

The Worker permits the GitHub Pages origin and the opaque `null` origin used by local `file://` previews. It only returns public market data, and requests remain rate-limited; `null` is not an authentication mechanism. Market data is cached upstream and in each browser for one hour.

## Tests

Run `node --test tests/*.test.mjs`.
