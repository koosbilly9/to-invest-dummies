(function (root) {
  "use strict";

  var DAY = 86400000;
  var WORKER = "https://to-invest-dummies.koosbilly9.workers.dev";
  var BINANCE = "https://data-api.binance.vision/api/v3/klines";
  var FNG = "https://api.alternative.me/fng/";
  var CACHE_KEY = "invest-dummies-market-v4";
  var CACHE_MS = 60 * 60 * 1000;
  var ASSETS = [
    { key: "BTC", name: "Bitcoin", type: "crypto", symbol: "BTCUSDT", currency: "USD", url: "https://bitcoin.org", slug: "bitcoin" },
    { key: "ETH", name: "Ethereum", type: "crypto", symbol: "ETHUSDT", currency: "USD", url: "https://ethereum.org", slug: "ethereum" },
    { key: "SOL", name: "Solana", type: "crypto", symbol: "SOLUSDT", currency: "USD", url: "https://solana.com", slug: "solana" },
    { key: "SP500", name: "S&P 500", type: "index", ticker: "sp500", yahooSymbol: "^GSPC", stooqSymbol: "^spx", currency: "USD", url: "https://www.spglobal.com/spdji/en/indices/equity/sp-500/", quoteUrl: "https://finance.yahoo.com/quote/%5EGSPC/" },
    { key: "NASDAQ100", name: "Nasdaq 100", type: "index", ticker: "nasdaq100", yahooSymbol: "^NDX", stooqSymbol: "^ndx", currency: "USD", url: "https://www.nasdaq.com/solutions/nasdaq-100", quoteUrl: "https://finance.yahoo.com/quote/%5ENDX/" },
    { key: "CORONATION", name: "Coronation Top 20", type: "fund", ticker: "coronation", moneywebCode: "CNTF", currency: "ZAR", url: "https://www.coronation.com/en-za/personal/funds/top-20/", quoteUrl: "https://www.moneyweb.co.za/tools-and-data/click-a-unit-trust/CNTF/" }
  ];

  function number(value) {
    if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return NaN;
    return Number(value);
  }

  function calculateIndicators(points) {
    if (!Array.isArray(points)) throw new Error("Price history is not an array");
    var valid = [];
    var previous = 0;
    points.forEach(function (point) {
      if (!Array.isArray(point) || point.length < 2) throw new Error("Invalid price history point");
      var time = number(point[0]);
      var close = number(point[1]);
      var high = point.length > 2 && point[2] != null ? number(point[2]) : close;
      var low = point.length > 3 && point[3] != null ? number(point[3]) : close;
      if (!Number.isSafeInteger(time) || time <= previous ||
          !Number.isFinite(close) || close <= 0 ||
          !Number.isFinite(high) || !Number.isFinite(low) ||
          high < close || low > close || high < low || low <= 0) {
        throw new Error("Invalid price history values");
      }
      valid.push({ time: time, close: close, high: high, low: low });
      previous = time;
    });
    if (!valid.length) throw new Error("Price history is empty");

    var cutoff = Date.now() - 5 * 365.25 * DAY;
    var fiveYear = valid.filter(function (point) { return point.time >= cutoff; });
    var closes = valid.map(function (point) { return point.close; });
    var last = closes[closes.length - 1];
    var average = closes.length >= 200
      ? closes.slice(-200).reduce(function (sum, close) { return sum + close; }, 0) / 200
      : null;
    var rsi = null;
    if (closes.length > 14) {
      var gains = 0;
      var losses = 0;
      for (var i = 1; i <= 14; i++) {
        var initial = closes[i] - closes[i - 1];
        if (initial > 0) gains += initial;
        else losses -= initial;
      }
      gains /= 14;
      losses /= 14;
      for (var j = 15; j < closes.length; j++) {
        var change = closes[j] - closes[j - 1];
        gains = (gains * 13 + Math.max(change, 0)) / 14;
        losses = (losses * 13 + Math.max(-change, 0)) / 14;
      }
      rsi = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
    }
    return {
      current: last,
      high: fiveYear.length ? Math.max.apply(null, fiveYear.map(function (p) { return p.high; })) : null,
      low: fiveYear.length ? Math.min.apply(null, fiveYear.map(function (p) { return p.low; })) : null,
      ma200: average,
      rsi: rsi,
      cycle: average === null ? null : last >= average ? "Bull" : "Bear"
    };
  }

  function formatPrice(value, currency) {
    if (!Number.isFinite(value)) return "—";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency,
        maximumFractionDigits: value >= 1000 ? 0 : value >= 1 ? 2 : 5
      }).format(value);
    } catch (error) {
      return currency + " " + value.toLocaleString();
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function requestJson(url) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    return fetch(url, { signal: controller.signal }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).catch(function (error) {
      if (error.name === "AbortError") throw new Error("Request timed out");
      throw error;
    }).finally(function () {
      clearTimeout(timer);
    });
  }

  function requestText(url) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    return fetch(url, { signal: controller.signal }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.text();
    }).catch(function (error) {
      if (error.name === "AbortError") throw new Error("Request timed out");
      throw error;
    }).finally(function () {
      clearTimeout(timer);
    });
  }

  function normalizeHistoryPoints(rawPoints) {
    var today = new Date();
    var currentUtcDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    var cutoff = currentUtcDay - 5 * 365.25 * DAY;
    var byDay = {};
    rawPoints.forEach(function (point) {
      var time = number(point[0]);
      var close = number(point[1]);
      var high = point[2] != null ? number(point[2]) : close;
      var low = point[3] != null ? number(point[3]) : close;
      if (Number.isSafeInteger(time) && time >= cutoff && time < currentUtcDay &&
          Number.isFinite(close) && close > 0 &&
          Number.isFinite(high) && Number.isFinite(low) &&
          high >= close && low <= close && high >= low && low > 0) {
        byDay[time] = [time, close, high, low];
      }
    });
    return Object.keys(byDay).map(function (k) { return byDay[k]; }).sort(function (a, b) {
      return a[0] - b[0];
    });
  }

  function parseYahooChart(payload) {
    var result = payload && payload.chart && Array.isArray(payload.chart.result) && payload.chart.result[0];
    var timestamps = result && result.timestamp;
    var quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
    var closes = quote && quote.close;
    var highs = quote && quote.high;
    var lows = quote && quote.low;
    if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length !== closes.length) {
      throw new Error("Invalid Yahoo chart response");
    }
    var raw = [];
    for (var i = 0; i < timestamps.length; i++) {
      var d = new Date(timestamps[i] * 1000);
      var dayTime = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      raw.push([
        dayTime,
        closes[i],
        Array.isArray(highs) ? highs[i] : closes[i],
        Array.isArray(lows) ? lows[i] : closes[i]
      ]);
    }
    var points = normalizeHistoryPoints(raw);
    if (!points.length) throw new Error("Empty Yahoo chart history");
    return points;
  }

  function parseStooqCsv(csv) {
    if (typeof csv !== "string" || !csv.trim()) throw new Error("Empty Stooq CSV");
    var lines = csv.trim().split(/\r?\n/);
    var raw = [];
    for (var i = 1; i < lines.length; i++) {
      var cols = lines[i].split(",");
      if (cols.length < 5) continue;
      var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cols[0].trim());
      if (!match) continue;
      var time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      raw.push([time, number(cols[4]), number(cols[2]), number(cols[3])]);
    }
    var points = normalizeHistoryPoints(raw);
    if (!points.length) throw new Error("Invalid Stooq CSV history");
    return points;
  }

  function parseMoneywebGraph(payload, code) {
    var key = code || "CNTF";
    var rows = payload && Array.isArray(payload[key]) ? payload[key] : null;
    if (!rows || !rows.length) throw new Error("Invalid Moneyweb response");
    var raw = [];
    for (var i = 0; i < rows.length; i++) {
      var item = rows[i];
      if (!item || typeof item.dt !== "string") continue;
      var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(item.dt.trim());
      if (!match) continue;
      var time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      var cents = item.c != null ? number(item.c) : NaN;
      var rands = item.i != null ? number(item.i) : NaN;
      var val = Number.isFinite(cents) && cents > 0 ? cents / 100 : rands;
      raw.push([time, val, val, val]);
    }
    var points = normalizeHistoryPoints(raw);
    if (!points.length) throw new Error("Empty Moneyweb history");
    return points;
  }

  function indexHistory(asset) {
    var yahooUrl = asset.yahooSymbol
      ? "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(asset.yahooSymbol) + "?range=5y&interval=1d"
      : null;
    var stooqUrl = asset.stooqSymbol
      ? "https://stooq.com/q/d/l/?s=" + encodeURIComponent(asset.stooqSymbol) + "&i=d"
      : null;
    var attempts = [
      function () {
        return workerJson("/history?asset=" + encodeURIComponent(asset.ticker)).then(function (response) {
          if (!response || !Array.isArray(response.points)) throw new Error("Invalid history response");
          return response.points;
        });
      }
    ];
    if (yahooUrl) {
      attempts.push(function () {
        return requestJson("https://api.allorigins.win/raw?url=" + encodeURIComponent(yahooUrl)).then(parseYahooChart);
      });
    }
    if (stooqUrl) {
      attempts.push(function () {
        return requestText("https://api.allorigins.win/raw?url=" + encodeURIComponent(stooqUrl)).then(parseStooqCsv);
      });
    }
    var index = 0;
    function next(lastError) {
      if (index >= attempts.length) return Promise.reject(lastError || new Error("History unavailable"));
      var attempt = attempts[index++];
      return attempt().catch(function (error) {
        return next(error);
      });
    }
    return next();
  }

  function workerJson(path) {
    return requestJson(WORKER + path).catch(function (error) {
      if ((error.message === "HTTP 404" || error.message === "HTTP 400") && path !== "/listings") {
        throw new Error("Shared Worker needs its /history route deployed");
      }
      if (error.name === "TypeError" || error.message === "Failed to fetch" || error.message === "Load failed") {
        throw new Error("Could not reach the shared crypto-proxy Worker; deploy its updates and refresh");
      }
      throw error;
    });
  }

  function cryptoHistory(symbol) {
    var start = Date.now() - 5 * 365.25 * DAY;
    var url = BINANCE + "?symbol=" + encodeURIComponent(symbol) + "&interval=1d&startTime=" + Math.floor(start) + "&limit=1000";
    return requestJson(url).then(function (first) {
      if (!Array.isArray(first)) throw new Error("Binance returned invalid candles");
      var candles = first;
      if (first.length === 1000) {
        var next = number(first[first.length - 1][0]) + DAY;
        return requestJson(BINANCE + "?symbol=" + encodeURIComponent(symbol) + "&interval=1d&startTime=" + next + "&limit=1000")
          .then(function (second) {
            if (!Array.isArray(second)) throw new Error("Binance returned invalid candles");
            candles = candles.concat(second);
            return candlePoints(candles);
          });
      }
      return candlePoints(candles);
    });
  }

  function candlePoints(candles) {
    var today = new Date();
    var currentUtcDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    return candles.filter(function (candle) {
      return Array.isArray(candle) && number(candle[0]) < currentUtcDay;
    }).map(function (candle) {
      return [number(candle[0]), number(candle[4]), number(candle[2]), number(candle[3])];
    });
  }

  function getFearGreed() {
    return requestJson(FNG).then(function (response) {
      var item = response && Array.isArray(response.data) && response.data[0];
      var value = item && Number(item.value);
      if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error("Invalid fear/greed response");
      return { value: value, label: item.value_classification || "Crypto sentiment" };
    });
  }

  function readCache() {
    try {
      var saved = JSON.parse(localStorage.getItem(CACHE_KEY));
      return saved && Number.isFinite(saved.time) && saved.data &&
        Date.now() >= saved.time && Date.now() - saved.time < CACHE_MS
        ? saved
        : null;
    } catch (error) {
      console.warn("Could not read saved market data:", error);
      return null;
    }
  }

  function saveCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), data: data }));
    } catch (error) {
      console.warn("Could not save market data:", error);
    }
  }

  function sentiment(indicator) {
    if (!Number.isFinite(indicator)) return { text: "n/a", cls: "pill-neutral" };
    if (indicator < 30) return { text: "Oversold", cls: "pill-positive" };
    if (indicator > 70) return { text: "Overbought", cls: "pill-negative" };
    return { text: "Neutral", cls: "pill-neutral" };
  }

  function displayPercent(value) {
    return Number.isFinite(value) ? value.toFixed(2) + "%" : "—";
  }

  function percentClass(value) {
    if (!Number.isFinite(value)) return "";
    if (value <= 10) return "percent-warning";
    if (value <= 40) return "";
    return "percent-good";
  }

  function percentBelowHigh(current, high) {
    return Number.isFinite(current) && Number.isFinite(high) && high > 0
      ? Math.max(0, (high - current) / high * 100)
      : null;
  }

  function render(data, timestamp) {
    var rows = ASSETS.map(function (asset) {
      var result = data[asset.key] || {};
      var signal = sentiment(result.indicators ? result.indicators.rsi : null);
      var cycle = result.indicators && result.indicators.cycle;
      var cycleClass = cycle === "Bull" ? "positive" : cycle === "Bear" ? "negative" : "";
      var percentBelow = percentBelowHigh(
        result.indicators && result.indicators.current,
        result.indicators && result.indicators.high
      );
      var fear = asset.type === "crypto" && data.fearGreed
        ? '<span class="value">' + data.fearGreed.value + '</span><div class="asset-sub">' + escapeHtml(data.fearGreed.label) + "</div>"
        : "—";
      var indicators = result.indicators || {};
      var status = result.error
        ? '<div class="asset-sub">' + escapeHtml(result.error) + "</div>"
        : "";
      var nameHtml = asset.url
        ? '<a href="' + escapeHtml(asset.url) + '" target="_blank" rel="noopener">' + escapeHtml(asset.name) + "</a>"
        : escapeHtml(asset.name);
      var slug = result.slug || asset.slug;
      var tickerHref = slug
        ? "https://coinmarketcap.com/currencies/" + encodeURIComponent(slug) + "/"
        : asset.quoteUrl || "";
      var tickerHtml = tickerHref
        ? '<a href="' + escapeHtml(tickerHref) + '" target="_blank" rel="noopener">' + escapeHtml(asset.key) + "</a>"
        : escapeHtml(asset.key);
      return "<tr>" +
        '<td><div class="asset"><span class="coin-icon">' + escapeHtml(asset.key === "NASDAQ100" ? "N100" : asset.key === "CORONATION" ? "C20" : asset.key === "SP500" ? "S&P" : asset.key) + '</span><div><div class="asset-name">' + nameHtml + '</div><div class="asset-sub">' + tickerHtml + status + "</div></div></div></td>" +
        "<td>" + fear + "</td>" +
        '<td class="value">' + formatPrice(result.indicators && result.indicators.high, asset.currency) + "</td>" +
        '<td class="value">' + formatPrice(result.indicators && result.indicators.low, asset.currency) + "</td>" +
        '<td><span class="sentiment ' + signal.cls + '">' + signal.text + "</span></td>" +
        '<td class="value">' + formatPrice(indicators.current, asset.currency) + "</td>" +
        '<td class="value">' + formatPrice(indicators.ma200, asset.currency) + "</td>" +
        '<td class="value ' + percentClass(percentBelow) + '">' + displayPercent(percentBelow) + "</td>" +
        '<td class="' + cycleClass + '">' + (cycle || "—") + "</td>" +
        "</tr>";
    });
    document.getElementById("assets").innerHTML = rows.join("");
    document.getElementById("updated").textContent = timestamp
      ? "Updated " + new Date(timestamp).toLocaleString()
      : "Some feeds may be unavailable";
  }

  function load() {
    var button = document.getElementById("refresh");
    var notice = document.getElementById("notice");
    button.disabled = true;
    notice.textContent = "Fetching current prices and history…";

    var cached = readCache();
    if (cached && !root.forceRefresh) {
      render(cached.data, cached.time);
      notice.textContent = "Showing a saved snapshot from this browser. Refresh is available once the snapshot expires.";
      button.disabled = false;
      return Promise.resolve();
    }

    var data = {};
    var errors = [];
    return Promise.all([
      workerJson("/listings").then(function (response) {
        if (!response || !Array.isArray(response.data)) throw new Error("CoinMarketCap listings were invalid");
        var lookup = {};
        response.data.forEach(function (coin) {
          lookup[String(coin.symbol).toUpperCase()] = coin;
        });
        return Promise.all(ASSETS.filter(function (asset) { return asset.type === "crypto"; }).map(function (asset) {
          var item = lookup[asset.key];
          var quote = item && item.quote && !Array.isArray(item.quote)
            ? item.quote.USD
            : item && Array.isArray(item.quote)
              ? item.quote.filter(function (value) { return value && value.symbol === "USD"; })[0]
              : null;
          if (!quote) throw new Error("CoinMarketCap has no USD listing for " + asset.key);
          return cryptoHistory(asset.symbol).then(function (history) {
            var indicators = calculateIndicators(history);
            var current = number(quote.price);
            indicators.current = current;
            if (Number.isFinite(current)) {
              if (Number.isFinite(indicators.high)) indicators.high = Math.max(indicators.high, current);
              if (Number.isFinite(indicators.low)) indicators.low = Math.min(indicators.low, current);
              if (Number.isFinite(indicators.ma200)) indicators.cycle = current >= indicators.ma200 ? "Bull" : "Bear";
            }
            data[asset.key] = { slug: item.slug || asset.slug, indicators: indicators };
          }).catch(function (error) {
            data[asset.key] = { slug: item.slug || asset.slug, error: "History unavailable", indicators: { current: number(quote.price) } };
            errors.push(asset.key + " history: " + error.message);
          });
        }));
      }).catch(function (error) {
        errors.push("Crypto feed: " + error.message);
        ["BTC", "ETH", "SOL"].forEach(function (key) { data[key] = { error: "Feed unavailable" }; });
      }),
      Promise.all(ASSETS.filter(function (asset) { return asset.type === "index" || asset.type === "fund"; }).map(function (asset) {
        return indexHistory(asset).then(function (points) {
          data[asset.key] = { indicators: calculateIndicators(points) };
        }).catch(function (error) {
          data[asset.key] = { error: "History unavailable" };
          errors.push(asset.name + ": " + error.message);
        });
      })),
      getFearGreed().then(function (value) {
        data.fearGreed = value;
      }).catch(function (error) {
        errors.push("Fear/greed: " + error.message);
      })
    ]).then(function () {
      render(data, Date.now());
      var cacheable = ASSETS.filter(function (asset) {
        return asset.type !== "fund";
      }).every(function (asset) {
        var row = data[asset.key];
        return row && row.indicators &&
          Number.isFinite(row.indicators.current) &&
          Number.isFinite(row.indicators.high) &&
          Number.isFinite(row.indicators.low) &&
          Number.isFinite(row.indicators.ma200) &&
          Number.isFinite(row.indicators.rsi) &&
          !!row.indicators.cycle;
      });
      if (cacheable) saveCache(data);
      notice.textContent = errors.length
        ? "Some data could not be loaded: " + errors.join("; ") + "."
        : "Signals use completed daily data. Figures may be delayed.";
    }).catch(function (error) {
      notice.textContent = "Could not load market data: " + error.message;
      console.error("Market data request failed:", error);
    }).finally(function () {
      button.disabled = false;
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      calculateIndicators: calculateIndicators,
      parseMoneywebGraph: parseMoneywebGraph,
      parseStooqCsv: parseStooqCsv,
      parseYahooChart: parseYahooChart,
      percentClass: percentClass,
      percentBelowHigh: percentBelowHigh,
      sentiment: sentiment
    };
  }
  if (typeof document !== "undefined") {
    document.getElementById("refresh").addEventListener("click", function () {
      root.forceRefresh = true;
      load().finally(function () { root.forceRefresh = false; });
    });
    load();
  }
})(typeof window !== "undefined" ? window : globalThis);
