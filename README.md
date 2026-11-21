# Invest like a dummy

A static, single-page market snapshot for BTC, ETH, SOL, the S&P 500, Nasdaq 100, and Coronation Top 20.

## Data and indicators

- Crypto prices: CoinMarketCap. Crypto history: Binance daily candles.
- Index history: Yahoo Finance (`^GSPC` and `^NDX` chart API and history page fallback) and Stooq (`^spx` and `^ndx` free daily CSV feed).
- Coronation Top 20 history: Moneyweb / ProfileData five-year daily unit trust NAV feed (`CNTF`, converted from South African cents per unit to `ZAR`).
- Fear/greed: Alternative.me's crypto index, shown for crypto only.
- Oversold/overbought: RSI(14), under 30/over 70. Bull/bear: latest completed close above/below its 200-day simple moving average.
- Five-year high/low: highest daily candle high and lowest daily candle low over the available five-year history.
- MA200: the latest completed close's 200-day simple moving average. % below: the percentage current price is below the available five-year high.

## Deploy and refresh

The front end is static and can be hosted on GitHub Pages. It reuses the existing `crypto-proxy` Worker from `../to-crypto-buy-sell-signals`; the Worker also needs its `/history` route. To publish those changes, run `npx wrangler deploy` from that sibling project, then reload the page or press **Refresh data**. The existing `CMC_RATE_LIMITER` binding and optional `CMC_KEY` secret are reused.

The Worker permits the GitHub Pages origin and the opaque `null` origin used by local `file://` previews. It only returns public market data, and requests remain rate-limited; `null` is not an authentication mechanism. Market data is cached upstream and in each browser for one hour.

## Tests

Run `node --test tests/*.test.mjs`.
