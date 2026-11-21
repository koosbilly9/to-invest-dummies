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

## Deploy and refresh

The front end is static and can be hosted on GitHub Pages. It reuses the existing `crypto-proxy` Worker from `../to-crypto-buy-sell-signals`; the Worker now also needs its `/global` and `/history` routes. To publish those changes, run `npx wrangler deploy` from that sibling project, then reload the page or press **Refresh data**. The existing `CMC_RATE_LIMITER` binding and optional `CMC_KEY` secret are reused.

The Worker permits the GitHub Pages origin and the opaque `null` origin used by local `file://` previews. It only returns public market data, and requests remain rate-limited; `null` is not an authentication mechanism. Market data is cached upstream and in each browser for one hour.

## Tests

Run `node --test tests/*.test.mjs`.
