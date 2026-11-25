(function (root) {
  "use strict";

  var DAY = 86400000;
  var WORKER = "https://to-invest-dummies.koosbilly9.workers.dev";
  var BINANCE = "https://data-api.binance.vision/api/v3/klines";
  var FNG = "https://api.alternative.me/fng/";
  var COINGECKO_GLOBAL = "https://api.coingecko.com/api/v3/global";
  var CACHE_KEY = "invest-dummies-market-v7";
  var CACHE_MS = 60 * 60 * 1000;
  var MONEY_MARKET_BASELINES = {
    fiat: 103.9,
    gold: 24.6,
    silver: 2.3,
    cryptoFallback: 2.0
  };
  var ASSETS = [
    { key: "BTC", name: "Bitcoin", type: "crypto", symbol: "BTCUSDT", currency: "USD", url: "https://bitcoin.org", slug: "bitcoin" },
    { key: "ETH", name: "Ethereum", type: "crypto", symbol: "ETHUSDT", currency: "USD", url: "https://ethereum.org", slug: "ethereum" },
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

  function buildMoneyMarketPayload(cryptoTrillions, timestamp) {
    var crypto = Number.isFinite(cryptoTrillions) && cryptoTrillions > 0
      ? cryptoTrillions
      : MONEY_MARKET_BASELINES.cryptoFallback;
    var raw = [
      { name: "Global Fiat (M2)", value: MONEY_MARKET_BASELINES.fiat, color: "#2563eb" },
      { name: "Gold", value: MONEY_MARKET_BASELINES.gold, color: "#eab308" },
      { name: "Silver", value: MONEY_MARKET_BASELINES.silver, color: "#94a3b8" },
      { name: "Cryptocurrencies", value: crypto, color: "#10b981" }
    ];
    var totalRaw = raw.reduce(function (sum, item) { return sum + item.value; }, 0);
    return {
      updatedAt: new Date(timestamp || Date.now()).toISOString(),
      totalTrillions: Number(totalRaw.toFixed(2)),
      assets: raw.map(function (item) {
        return {
          name: item.name,
          valueTrillions: Number(item.value.toFixed(2)),
          sharePercent: Number(((item.value / totalRaw) * 100).toFixed(2)),
          color: item.color
        };
      })
    };
  }

  function validateMoneyMarketPayload(payload) {
    if (!payload || !Array.isArray(payload.assets) || !payload.assets.length || !Number.isFinite(Number(payload.totalTrillions))) {
      throw new Error("Invalid money market response");
    }
    return payload;
  }

  function getMoneyMarket() {
    return workerJson("/api/money-market").then(validateMoneyMarketPayload).catch(function () {
      return requestJson(COINGECKO_GLOBAL).then(function (payload) {
        var usd = payload && payload.data && payload.data.total_market_cap && number(payload.data.total_market_cap.usd);
        if (!Number.isFinite(usd) || usd <= 0) throw new Error("Invalid CoinGecko market cap");
        return buildMoneyMarketPayload(usd / 1e12, Date.now());
      }).catch(function () {
        return buildMoneyMarketPayload(MONEY_MARKET_BASELINES.cryptoFallback, Date.now());
      });
    });
  }

  function shadeHexColor(hex, factor) {
    var clean = String(hex || "").replace("#", "");
    if (clean.length !== 6) return hex;
    var r = Math.max(0, Math.min(255, Math.round(parseInt(clean.slice(0, 2), 16) * factor)));
    var g = Math.max(0, Math.min(255, Math.round(parseInt(clean.slice(2, 4), 16) * factor)));
    var b = Math.max(0, Math.min(255, Math.round(parseInt(clean.slice(4, 6), 16) * factor)));
    return "#" + [r, g, b].map(function (v) { return v.toString(16).padStart(2, "0"); }).join("");
  }

  function build3dPieSvg(payload) {
    var byName = {};
    payload.assets.forEach(function (a) { byName[a.name] = a; });
    var gold = byName["Gold"] || { name: "Gold", valueTrillions: 24.6, sharePercent: 18.52, color: "#eab308" };
    var silver = byName["Silver"] || { name: "Silver", valueTrillions: 2.3, sharePercent: 1.73, color: "#94a3b8" };
    var crypto = byName["Cryptocurrencies"] || { name: "Cryptocurrencies", valueTrillions: 2.0, sharePercent: 1.51, color: "#10b981" };
    var fiat = byName["Global Fiat (M2)"] || { name: "Global Fiat (M2)", valueTrillions: 103.9, sharePercent: 78.24, color: "#2563eb" };

    var cx = 450;
    var cy = 268;
    var rx = 192;
    var ry = 102;
    var deg = Math.PI / 180;

    // Stepped slices ordered back-to-front (painter's algorithm):
    // 1. Gold (back-top, tallest step)
    // 2. Silver (mid-left, medium-tall step)
    // 3. Cryptocurrencies (mid-right, medium step)
    // 4. Global Fiat M2 (front-bottom, wide base step)
    var slices = [
      {
        key: "gold",
        asset: gold,
        caption: "Above-ground gold reserves (~212.6k metric tons)",
        start: 222 * deg,
        end: 320 * deg,
        height: 64,
        labelRadius: 0.56,
        callout: { x: 450, y: 26, align: "middle", anchorX: 450, anchorY: 74, lineEndR: 0.78 }
      },
      {
        key: "silver",
        asset: silver,
        caption: "Above-ground silver supply (~1.74M metric tons)",
        start: 174 * deg,
        end: 222 * deg,
        height: 46,
        labelRadius: 0.66,
        callout: { x: 24, y: 120, align: "start", anchorX: 205, anchorY: 162, lineEndR: 0.84 }
      },
      {
        key: "crypto",
        asset: crypto,
        caption: "All cryptocurrencies combined (live via CoinGecko)",
        start: 320 * deg,
        end: 366 * deg,
        height: 36,
        labelRadius: 0.66,
        callout: { x: 876, y: 126, align: "end", anchorX: 695, anchorY: 168, lineEndR: 0.84 }
      },
      {
        key: "fiat",
        asset: fiat,
        caption: "Global M2 broad money across major economies",
        start: 6 * deg,
        end: 174 * deg,
        height: 24,
        labelRadius: 0.56,
        callout: { x: 24, y: 356, align: "start", anchorX: 215, anchorY: 368, lineEndR: 0.78 }
      }
    ];

    function pt(angle, h, rScale) {
      var scale = rScale == null ? 1 : rScale;
      return {
        x: +(cx + rx * scale * Math.cos(angle)).toFixed(2),
        y: +(cy + ry * scale * Math.sin(angle) - (h || 0)).toFixed(2)
      };
    }

    function sectorPath(a0, a1, h) {
      var p0 = pt(a0, h);
      var p1 = pt(a1, h);
      var large = (a1 - a0) > Math.PI ? 1 : 0;
      return "M " + cx + " " + (cy - h) +
        " L " + p0.x + " " + p0.y +
        " A " + rx + " " + ry + " 0 " + large + " 1 " + p1.x + " " + p1.y +
        " Z";
    }

    function rimPath(a0, a1, h) {
      var top0 = pt(a0, h);
      var top1 = pt(a1, h);
      var bot1 = pt(a1, 0);
      var bot0 = pt(a0, 0);
      var large = (a1 - a0) > Math.PI ? 1 : 0;
      return "M " + top0.x + " " + top0.y +
        " A " + rx + " " + ry + " 0 " + large + " 1 " + top1.x + " " + top1.y +
        " L " + bot1.x + " " + bot1.y +
        " A " + rx + " " + ry + " 0 " + large + " 0 " + bot0.x + " " + bot0.y +
        " Z";
    }

    function cutWallPath(angle, h) {
      var topRim = pt(angle, h);
      var botRim = pt(angle, 0);
      return "M " + cx + " " + (cy - h) +
        " L " + topRim.x + " " + topRim.y +
        " L " + botRim.x + " " + botRim.y +
        " L " + cx + " " + cy + " Z";
    }

    var defs = '<defs>' +
      '<radialGradient id="pieFloorShadow" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0%" stop-color="#000" stop-opacity="0.28"/>' +
        '<stop offset="72%" stop-color="#000" stop-opacity="0.10"/>' +
        '<stop offset="100%" stop-color="#000" stop-opacity="0"/>' +
      "</radialGradient>" +
      slices.map(function (s) {
        var base = s.asset.color;
        var light = shadeHexColor(base, 1.12);
        var mid = shadeHexColor(base, 0.84);
        var dark = shadeHexColor(base, 0.66);
        return '<linearGradient id="top-' + s.key + '" x1="0%" y1="0%" x2="100%" y2="100%">' +
            '<stop offset="0%" stop-color="' + light + '"/>' +
            '<stop offset="100%" stop-color="' + base + '"/>' +
          "</linearGradient>" +
          '<linearGradient id="rim-' + s.key + '" x1="0%" y1="0%" x2="100%" y2="0%">' +
            '<stop offset="0%" stop-color="' + dark + '"/>' +
            '<stop offset="50%" stop-color="' + mid + '"/>' +
            '<stop offset="100%" stop-color="' + dark + '"/>' +
          "</linearGradient>";
      }).join("") +
    "</defs>";

    var shadow = '<ellipse cx="' + cx + '" cy="' + (cy + 14) + '" rx="' + (rx + 22) + '" ry="' + (ry + 14) + '" fill="url(#pieFloorShadow)"/>';

    var sliceGroups = slices.map(function (s, idx) {
      var cutColor = shadeHexColor(s.asset.color, 0.72);
      var strokeColor = shadeHexColor(s.asset.color, 0.58);
      var midAngle = (s.start + s.end) / 2;
      var labelPos = pt(midAngle, s.height, s.labelRadius);
      var lineStart = pt(midAngle, s.height, s.callout.lineEndR);
      var pctNum = Number(s.asset.sharePercent);
      var pctText = (pctNum >= 10 ? pctNum.toFixed(1) : pctNum.toFixed(2)) + "%";

      var walls = "";
      if (s.key === "gold") {
        walls = '<path d="' + rimPath(s.start, s.end, s.height) + '" fill="url(#rim-' + s.key + ')"/>' +
          '<path d="' + cutWallPath(s.start, s.height) + '" fill="' + cutColor + '"/>' +
          '<path d="' + cutWallPath(s.end, s.height) + '" fill="' + shadeHexColor(s.asset.color, 0.78) + '"/>';
      } else if (s.key === "silver") {
        walls = '<path d="' + cutWallPath(s.end, s.height) + '" fill="' + cutColor + '"/>' +
          '<path d="' + rimPath(s.start, s.end, s.height) + '" fill="url(#rim-' + s.key + ')"/>' +
          '<path d="' + cutWallPath(s.start, s.height) + '" fill="' + shadeHexColor(s.asset.color, 0.76) + '"/>';
      } else if (s.key === "crypto") {
        walls = '<path d="' + cutWallPath(s.start, s.height) + '" fill="' + cutColor + '"/>' +
          '<path d="' + rimPath(s.start, s.end, s.height) + '" fill="url(#rim-' + s.key + ')"/>' +
          '<path d="' + cutWallPath(s.end, s.height) + '" fill="' + shadeHexColor(s.asset.color, 0.76) + '"/>';
      } else {
        walls = '<path d="' + cutWallPath(s.start, s.height) + '" fill="' + cutColor + '"/>' +
          '<path d="' + cutWallPath(s.end, s.height) + '" fill="' + cutColor + '"/>' +
          '<path d="' + rimPath(s.start, s.end, s.height) + '" fill="url(#rim-' + s.key + ')"/>';
      }

      var topFace = '<path d="' + sectorPath(s.start, s.end, s.height) + '" fill="url(#top-' + s.key + ')" stroke="' + strokeColor + '" stroke-width="0.8"/>';

      var extrudedText = [4, 3, 2, 1].map(function (offset) {
        return '<text x="' + (labelPos.x + offset * 0.9) + '" y="' + (labelPos.y + offset * 1.15) + '" text-anchor="middle" dominant-baseline="central" fill="#0d1713" font-size="25" font-weight="900" letter-spacing="-0.03em">' + escapeHtml(pctText) + "</text>";
      }).join("") +
      '<text x="' + labelPos.x + '" y="' + labelPos.y + '" text-anchor="middle" dominant-baseline="central" fill="#ffffff" stroke="#0d1713" stroke-width="0.7" font-size="25" font-weight="900" letter-spacing="-0.03em">' + escapeHtml(pctText) + "</text>";

      var c = s.callout;
      var underlineX1 = c.align === "middle" ? c.x - 105 : c.align === "end" ? c.x - 210 : c.x;
      var underlineX2 = c.align === "middle" ? c.x + 105 : c.align === "end" ? c.x : c.x + 210;
      var calloutSvg =
        '<polyline points="' + lineStart.x + "," + lineStart.y + " " + c.anchorX + "," + c.anchorY + " " + underlineX1 + "," + c.anchorY + '" fill="none" stroke="var(--muted)" stroke-width="1.4" stroke-dasharray="4 3"/>' +
        '<line x1="' + underlineX1 + '" y1="' + c.anchorY + '" x2="' + underlineX2 + '" y2="' + c.anchorY + '" stroke="' + escapeHtml(s.asset.color) + '" stroke-width="2.2" stroke-dasharray="5 3"/>' +
        '<circle cx="' + lineStart.x + '" cy="' + lineStart.y + '" r="3.2" fill="#ffffff" stroke="#0d1713" stroke-width="1.2"/>' +
        '<text x="' + c.x + '" y="' + c.y + '" text-anchor="' + c.align + '" fill="var(--ink)" font-size="14" font-weight="800">' +
          escapeHtml(s.asset.name) + " · $" + Number(s.asset.valueTrillions).toFixed(1) + "T" +
        "</text>" +
        '<text x="' + c.x + '" y="' + (c.y + 19) + '" text-anchor="' + c.align + '" fill="var(--muted)" font-size="11.5">' +
          escapeHtml(s.caption) +
        "</text>" +
        '<text x="' + c.x + '" y="' + (c.y + 35) + '" text-anchor="' + c.align + '" fill="var(--ink)" font-size="11.5" font-weight="700">' +
          Number(s.asset.sharePercent).toFixed(2) + "% of $" + Number(payload.totalTrillions).toFixed(1) + "T global total" +
        "</text>";

      return '<g class="pie3d-slice" tabindex="0" data-slice-name="' + escapeHtml(s.asset.name) + '" aria-label="' + escapeHtml(s.asset.name + ": $" + Number(s.asset.valueTrillions).toFixed(2) + " trillion (" + Number(s.asset.sharePercent).toFixed(2) + "%)") + '">' +
        walls + topFace + extrudedText + calloutSvg +
      "</g>";
    }).join("");

    return defs + shadow + sliceGroups;
  }

  function renderMoneyMarket(moneyMarket) {
    var listEl = document.getElementById("money-market-list");
    var updatedEl = document.getElementById("money-market-updated");
    if (!listEl || !updatedEl) return;
    var payload = moneyMarket && Array.isArray(moneyMarket.assets)
      ? moneyMarket
      : buildMoneyMarketPayload(MONEY_MARKET_BASELINES.cryptoFallback, Date.now());

    listEl.innerHTML = payload.assets.map(function (item) {
      return '<li class="money-item" data-asset-name="' + escapeHtml(item.name) + '">' +
        '<div class="money-label"><span class="swatch" style="background:' + escapeHtml(item.color) + '"></span>' + escapeHtml(item.name) + "</div>" +
        '<div class="money-metrics">' +
          '<div class="money-val">$' + Number(item.valueTrillions).toFixed(2) + "T</div>" +
          '<div class="money-share">' + Number(item.sharePercent).toFixed(2) + "% of total</div>" +
        "</div>" +
      "</li>";
    }).join("");

    updatedEl.textContent = "Total $" + Number(payload.totalTrillions).toFixed(2) + "T";

    var svg = document.getElementById("money-market-chart");
    if (!svg) return;
    svg.innerHTML = build3dPieSvg(payload);

    var sliceEls = svg.querySelectorAll(".pie3d-slice");
    var itemEls = listEl.querySelectorAll(".money-item");
    function setHighlight(name) {
      for (var i = 0; i < itemEls.length; i++) {
        var match = name && itemEls[i].getAttribute("data-asset-name") === name;
        itemEls[i].classList.toggle("is-active", !!match);
      }
    }
    for (var j = 0; j < sliceEls.length; j++) {
      (function (el) {
        var name = el.getAttribute("data-slice-name");
        el.addEventListener("mouseenter", function () { setHighlight(name); });
        el.addEventListener("mouseleave", function () { setHighlight(null); });
        el.addEventListener("focus", function () { setHighlight(name); });
        el.addEventListener("blur", function () { setHighlight(null); });
      })(sliceEls[j]);
    }
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

  function currentPriceClass(current, ma200) {
    return Number.isFinite(current) && Number.isFinite(ma200) && current < ma200
      ? "positive"
      : "";
  }

  function ma200ValueClass(current, ma200) {
    return Number.isFinite(current) && Number.isFinite(ma200) && ma200 > current
      ? "positive"
      : "";
  }

  function render(data, timestamp) {
    var rows = ASSETS.map(function (asset) {
      var result = data[asset.key] || {};
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
        '<td class="value">' + formatPrice(result.indicators && result.indicators.low, asset.currency) + "</td>" +
        '<td class="value ' + currentPriceClass(indicators.current, indicators.ma200) + '">' + formatPrice(indicators.current, asset.currency) + "</td>" +
        '<td class="value ' + percentClass(percentBelow) + '">' + displayPercent(percentBelow) + "</td>" +
        '<td class="value">' + formatPrice(result.indicators && result.indicators.high, asset.currency) + "</td>" +
        '<td class="value ' + ma200ValueClass(indicators.current, indicators.ma200) + '">' + formatPrice(indicators.ma200, asset.currency) + "</td>" +
        "<td>" + fear + "</td>" +
        '<td class="' + cycleClass + '">' + (cycle || "—") + "</td>" +
        "</tr>";
    });
    document.getElementById("assets").innerHTML = rows.join("");
    document.getElementById("updated").textContent = timestamp
      ? "Updated " + new Date(timestamp).toLocaleString()
      : "Some feeds may be unavailable";
    renderMoneyMarket(data.moneyMarket);
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
          if (!quote) {
            data[asset.key] = { error: "CoinMarketCap has no USD listing" };
            errors.push(asset.key + " price: CoinMarketCap has no USD listing");
            return Promise.resolve();
          }
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
        ["BTC", "ETH"].forEach(function (key) { data[key] = { error: "Feed unavailable" }; });
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
      }),
      getMoneyMarket().then(function (value) {
        data.moneyMarket = value;
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
      build3dPieSvg: build3dPieSvg,
      buildMoneyMarketPayload: buildMoneyMarketPayload,
      calculateIndicators: calculateIndicators,
      parseMoneywebGraph: parseMoneywebGraph,
      parseStooqCsv: parseStooqCsv,
      parseYahooChart: parseYahooChart,
      percentClass: percentClass,
      percentBelowHigh: percentBelowHigh,
      currentPriceClass: currentPriceClass,
      ma200ValueClass: ma200ValueClass,
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
