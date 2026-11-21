// Cloudflare Worker: CORS proxy for CoinMarketCap top-50 listings.
// Optional secret: CMC_KEY (your free CoinMarketCap Basic API key). Without it the keyless route is used.

const ALLOWED_ORIGINS = [
  "https://koosbilly9.github.io",
  "null",
  // "https://signals.to-web.co.za",   // add your own domain here when you use it
];

const QS = "start=1&limit=50&convert=USD&sort=market_cap&sort_dir=desc";
const CMC_BASE = "https://pro-api.coinmarketcap.com";
const YAHOO_SYMBOLS = {
  sp500: "^GSPC",
  nasdaq100: "^NDX",
};
const STOOQ_SYMBOLS = {
  sp500: "^spx",
  nasdaq100: "^ndx",
};
const MONEYWEB_FUNDS = {
  coronation: {
    code: "CNTF",
    title: "Coronation Top 20 Fund (A)",
    currency: "ZAR",
    referer: "https://www.moneyweb.co.za/tools-and-data/click-a-unit-trust/CNTF/",
  },
};
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FIVE_YEARS_MS = 5 * 365.25 * 86400000;
const COINGECKO_GLOBAL_URL = "https://api.coingecko.com/api/v3/global";
const MONEY_MARKET_DEFAULTS = {
  fiatTrillions: 103.9,
  goldTrillions: 24.6,
  silverTrillions: 2.3,
  cryptoFallbackTrillions: 2.0,
};
const UPSTREAM_CACHE = {
  cacheEverything: true,
  cacheTtlByStatus: {
    "200-299": 600,
    "300-599": -1,
  },
};

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function normalizePoints(rawPoints, currentUtcDay) {
  const cutoff = currentUtcDay - FIVE_YEARS_MS;
  const byDay = new Map();
  for (const [rawTime, rawClose, rawHigh, rawLow] of rawPoints) {
    const close = Number(rawClose);
    const high = rawHigh != null ? Number(rawHigh) : close;
    const low = rawLow != null ? Number(rawLow) : close;
    if (!Number.isSafeInteger(rawTime) || rawTime < cutoff || rawTime >= currentUtcDay ||
        !Number.isFinite(close) || close <= 0 ||
        !Number.isFinite(high) || !Number.isFinite(low) ||
        high < close || low > close || high < low || low <= 0) {
      continue;
    }
    byDay.set(rawTime, [rawTime, close, high, low]);
  }
  return [...byDay.values()].sort((a, b) => a[0] - b[0]);
}

function parseYahooChartJson(payload, currentUtcDay) {
  const result = payload && payload.chart && Array.isArray(payload.chart.result) && payload.chart.result[0];
  const timestamps = result && result.timestamp;
  const quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
  const closes = quote && quote.close;
  const highs = quote && quote.high;
  const lows = quote && quote.low;
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length !== closes.length) {
    return null;
  }
  const raw = [];
  for (let i = 0; i < timestamps.length; i++) {
    raw.push([
      timestamps[i] * 1000,
      closes[i],
      Array.isArray(highs) ? highs[i] : closes[i],
      Array.isArray(lows) ? lows[i] : closes[i],
    ]);
  }
  const points = normalizePoints(raw, currentUtcDay);
  return points.length ? { currency: (result.meta && result.meta.currency) || "USD", points } : null;
}

function parseStooqCsv(csv, currentUtcDay) {
  if (typeof csv !== "string" || !csv.trim()) return null;
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const raw = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 5) continue;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cols[0].trim());
    if (!match) continue;
    const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    raw.push([time, Number(cols[4]), Number(cols[2]), Number(cols[3])]);
  }
  const points = normalizePoints(raw, currentUtcDay);
  return points.length ? { currency: "USD", points } : null;
}

function parseYahooHistoryHtml(html, currentUtcDay) {
  if (typeof html !== "string" || !html.trim()) return null;
  const raw = [];

  const pricesMatch = /"prices"\s*:\s*(\[\{[\s\S]*?\}\])/.exec(html);
  if (pricesMatch) {
    try {
      const prices = JSON.parse(pricesMatch[1]);
      for (const item of prices) {
        if (item && Number.isFinite(item.date) && Number.isFinite(item.close)) {
          raw.push([item.date * 1000, item.close, item.high ?? item.close, item.low ?? item.close]);
        }
      }
    } catch {
      // Fall through to HTML table parsing.
    }
  }

  if (!raw.length) {
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const cells = [];
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
      }
      if (cells.length < 5) continue;
      const parsedDate = Date.parse(`${cells[0]} UTC`);
      if (!Number.isFinite(parsedDate)) continue;
      const d = new Date(parsedDate);
      const time = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      const high = Number(cells[2].replace(/,/g, ""));
      const low = Number(cells[3].replace(/,/g, ""));
      const close = Number(cells[4].replace(/,/g, ""));
      raw.push([time, close, high, low]);
    }
  }

  const points = normalizePoints(raw, currentUtcDay);
  return points.length ? { currency: "USD", points } : null;
}

function parseMoneywebGraphJson(payload, code, currentUtcDay, currency = "ZAR") {
  const rows = payload && Array.isArray(payload[code]) ? payload[code] : null;
  if (!rows || !rows.length) return null;
  const raw = [];
  for (const item of rows) {
    if (!item || typeof item.dt !== "string") continue;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(item.dt.trim());
    if (!match) continue;
    const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const cents = item.c != null ? Number(item.c) : NaN;
    const rands = item.i != null ? Number(item.i) : NaN;
    const value = Number.isFinite(cents) && cents > 0 ? cents / 100 : rands;
    raw.push([time, value, value, value]);
  }
  const points = normalizePoints(raw, currentUtcDay);
  return points.length ? { currency, points } : null;
}

async function fetchWithTimeout(url, accept, extraOptions = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(url, {
      method: extraOptions.method || "GET",
      headers: {
        Accept: accept,
        "User-Agent": BROWSER_UA,
        ...extraOptions.headers,
      },
      body: extraOptions.body,
      redirect: "manual",
      cf: UPSTREAM_CACHE,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function proxyHistory(asset, cors) {
  const symbol = YAHOO_SYMBOLS[asset];
  const stooqSymbol = STOOQ_SYMBOLS[asset];
  const moneyweb = MONEYWEB_FUNDS[asset];
  if (!symbol && !moneyweb) {
    return jsonResponse({ error: "Unsupported market history asset" }, 400, cors);
  }

  const now = new Date();
  const currentUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const sources = [];
  if (moneyweb) {
    const form = new URLSearchParams({
      action: "mny_load_graphs",
      "instruments[0][code]": moneyweb.code,
      "instruments[0][title]": moneyweb.title,
      "instruments[0][type]": "fund",
      graphType: "fund",
      graphAction: "hist",
      graphPeriod: "60",
    });
    sources.push({
      name: "Moneyweb ProfileData API",
      url: "https://cache.moneyweb.co.za/mny-graphs.php",
      accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Origin: "https://www.moneyweb.co.za",
          Referer: moneyweb.referer,
        },
        body: form.toString(),
      },
      parse: async (res) => parseMoneywebGraphJson(await res.json(), moneyweb.code, currentUtcDay, moneyweb.currency),
    });
  }
  if (symbol) {
    sources.push({
      name: "Yahoo Finance API",
      url: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`,
      accept: "application/json",
      parse: async (res) => parseYahooChartJson(await res.json(), currentUtcDay),
    });
  }
  if (stooqSymbol) {
    sources.push({
      name: "Stooq CSV API",
      url: `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`,
      accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
      parse: async (res) => parseStooqCsv(await res.text(), currentUtcDay),
    });
  }
  if (symbol) {
    sources.push({
      name: "Yahoo Finance HTML",
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/history/`,
      accept: "text/html,application/xhtml+xml",
      parse: async (res) => parseYahooHistoryHtml(await res.text(), currentUtcDay),
    });
  }

  let sawUpstreamOk = false;
  for (const source of sources) {
    let upstream;
    try {
      upstream = await fetchWithTimeout(source.url, source.accept, source.options);
    } catch (error) {
      console.error(`${source.name} request failed:`, error);
      continue;
    }
    if (!upstream.ok) {
      console.error(`${source.name} returned HTTP`, upstream.status);
      continue;
    }
    sawUpstreamOk = true;
    try {
      const parsed = await source.parse(upstream);
      if (parsed && parsed.points.length) {
        return jsonResponse(
          { symbol: symbol || moneyweb.code, currency: parsed.currency, source: source.name, points: parsed.points },
          200,
          {
            ...cors,
            "Cache-Control": "public, max-age=900",
          },
        );
      }
    } catch (error) {
      console.error(`${source.name} parse failed:`, error);
    }
  }

  return jsonResponse(
    { error: sawUpstreamOk ? "Market history response was invalid" : "Market history request failed" },
    502,
    cors,
  );
}

function positiveBaseline(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

export function buildMoneyMarketData(cryptoTrillions, env = {}, now = new Date()) {
  const fiat = positiveBaseline(env.FIAT_M2_TRILLIONS, MONEY_MARKET_DEFAULTS.fiatTrillions);
  const gold = positiveBaseline(env.GOLD_TRILLIONS, MONEY_MARKET_DEFAULTS.goldTrillions);
  const silver = positiveBaseline(env.SILVER_TRILLIONS, MONEY_MARKET_DEFAULTS.silverTrillions);
  const cryptoFallback = positiveBaseline(
    env.CRYPTO_FALLBACK_TRILLIONS,
    MONEY_MARKET_DEFAULTS.cryptoFallbackTrillions,
  );
  const crypto = Number.isFinite(cryptoTrillions) && cryptoTrillions > 0 ? cryptoTrillions : cryptoFallback;

  const rawAssets = [
    { name: "Global Fiat (M2)", value: fiat, color: "#2563eb" },
    { name: "Gold", value: gold, color: "#eab308" },
    { name: "Silver", value: silver, color: "#94a3b8" },
    { name: "Cryptocurrencies", value: crypto, color: "#10b981" },
  ];

  const totalRaw = rawAssets.reduce((sum, item) => sum + item.value, 0);
  const totalTrillions = Number(totalRaw.toFixed(2));
  const assets = rawAssets.map((item) => ({
    name: item.name,
    valueTrillions: Number(item.value.toFixed(2)),
    sharePercent: Number(((item.value / totalRaw) * 100).toFixed(2)),
    color: item.color,
  }));

  return {
    updatedAt: now.toISOString(),
    totalTrillions,
    assets,
  };
}

async function fetchLiveCryptoTrillions() {
  const response = await fetchWithTimeout(COINGECKO_GLOBAL_URL, "application/json");
  if (!response.ok) {
    throw new Error(`CoinGecko returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  const usdCap = payload && payload.data && payload.data.total_market_cap && Number(payload.data.total_market_cap.usd);
  if (!Number.isFinite(usdCap) || usdCap <= 0) {
    throw new Error("CoinGecko total_market_cap.usd was invalid");
  }
  return usdCap / 1e12;
}

async function handleMoneyMarket(request, env, ctx, corsHeaders) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    ...corsHeaders,
  };
  const cache = typeof caches !== "undefined" && caches && caches.default ? caches.default : null;
  const cacheKey = new Request(new URL("/api/money-market", request.url).toString(), { method: "GET" });

  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const cloned = new Response(cached.body, cached);
        Object.entries(headers).forEach(([k, v]) => cloned.headers.set(k, v));
        return cloned;
      }
    } catch (error) {
      console.error("Cache match failed:", error);
    }
  }

  let cryptoTrillions = null;
  try {
    cryptoTrillions = await fetchLiveCryptoTrillions();
  } catch (error) {
    console.error("Falling back to baseline crypto market cap:", error);
  }

  const body = buildMoneyMarketData(cryptoTrillions, env);
  const response = jsonResponse(body, 200, {
    ...headers,
    "Cache-Control": "public, max-age=3600",
  });

  if (cache) {
    const putPromise = cache.put(cacheKey, response.clone()).catch((error) => {
      console.error("Cache put failed:", error);
    });
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(putPromise);
    }
  }

  return response;
}

export default {
  async fetch(request, env = {}, ctx) {
    const url = new URL(request.url);
    const isMoneyMarket = url.pathname === "/api/money-market";
    const origin = request.headers.get("Origin") || "";
    const cors = isMoneyMarket
      ? {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        }
      : origin && ALLOWED_ORIGINS.includes(origin)
        ? {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Vary": "Origin",
          }
        : { "Vary": "Origin" };

    if (!isMoneyMarket && origin && !ALLOWED_ORIGINS.includes(origin)) {
      return jsonResponse({ error: "Origin not allowed" }, 403, cors);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Headers": "Accept, Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405, {
        ...cors,
        "Allow": "GET, OPTIONS",
      });
    }

    if (isMoneyMarket) {
      return handleMoneyMarket(request, env, ctx, cors);
    }

    if (url.pathname !== "/listings" && url.pathname !== "/global" && url.pathname !== "/history") {
      return jsonResponse({ error: "Not found" }, 404, cors);
    }
    if (url.pathname === "/history" &&
        (url.searchParams.getAll("asset").length !== 1 ||
         [...url.searchParams.keys()].some((key) => key !== "asset"))) {
      return jsonResponse({ error: "Invalid market history asset" }, 400, cors);
    }

    if (!env.CMC_RATE_LIMITER || typeof env.CMC_RATE_LIMITER.limit !== "function") {
      console.error("CMC_RATE_LIMITER binding is missing or invalid.");
      return jsonResponse({ error: "Rate limiting is unavailable" }, 503, cors);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    let allowed;
    try {
      ({ success: allowed } = await env.CMC_RATE_LIMITER.limit({ key: `listings:${ip}` }));
    } catch (error) {
      console.error("CMC_RATE_LIMITER check failed:", error);
      return jsonResponse({ error: "Rate limiting is unavailable" }, 503, cors);
    }

    if (typeof allowed !== "boolean") {
      console.error("CMC_RATE_LIMITER returned an invalid result.");
      return jsonResponse({ error: "Rate limiting is unavailable" }, 503, cors);
    }

    if (!allowed) {
      return jsonResponse({ error: "Rate limit exceeded" }, 429, {
        ...cors,
        "Retry-After": "60",
      });
    }

    if (url.pathname === "/history") {
      return proxyHistory(url.searchParams.get("asset"), cors);
    }

    const endpoint = url.pathname === "/global"
      ? "/v1/global-metrics/quotes/latest?convert=USD"
      : `/v1/cryptocurrency/listings/latest?${QS}`;
    const base = env.CMC_KEY ? CMC_BASE : `${CMC_BASE}/public-api`;
    const headers = { Accept: "application/json" };
    if (env.CMC_KEY) headers["X-CMC_PRO_API_KEY"] = env.CMC_KEY;

    let upstream;
    try {
      upstream = await fetch(base + endpoint, {
        headers,
        redirect: "manual",
        cf: UPSTREAM_CACHE,
      });
    } catch (error) {
      console.error("CoinMarketCap request failed:", error);
      return jsonResponse({ error: "CoinMarketCap request failed" }, 502, cors);
    }

    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : 502;
      const errorHeaders = { ...cors };
      if (status === 429) {
        const retryAfter = upstream.headers.get("Retry-After");
        if (retryAfter) {
          errorHeaders["Retry-After"] = retryAfter;
          if (origin && ALLOWED_ORIGINS.includes(origin)) {
            errorHeaders["Access-Control-Expose-Headers"] = "Retry-After";
          }
        }
      }
      console.error("CoinMarketCap returned HTTP", upstream.status);
      return jsonResponse(
        { error: "CoinMarketCap request failed", upstream_status: upstream.status },
        status,
        errorHeaders,
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
  },
};