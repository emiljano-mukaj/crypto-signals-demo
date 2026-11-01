/*
 * Crypto Signals — data layer
 *
 * Public endpoints only. Binance is the primary source (candles + volume),
 * CoinGecko is the fallback when Binance is unreachable or geo-blocked.
 * Everything is cached for five minutes so switching pairs is instant.
 */
(function (global) {
  'use strict';

  var BINANCE = 'https://api.binance.com/api/v3';
  var COINGECKO = 'https://api.coingecko.com/api/v3';
  var CACHE_TTL = 5 * 60 * 1000;

  var COINS = [
    { symbol: 'BTCUSDT', name: 'Bitcoin', cg: 'bitcoin' },
    { symbol: 'ETHUSDT', name: 'Ethereum', cg: 'ethereum' },
    { symbol: 'SOLUSDT', name: 'Solana', cg: 'solana' },
    { symbol: 'XRPUSDT', name: 'XRP', cg: 'ripple' },
    { symbol: 'BNBUSDT', name: 'BNB', cg: 'binancecoin' },
    { symbol: 'DOGEUSDT', name: 'Dogecoin', cg: 'dogecoin' },
    { symbol: 'ADAUSDT', name: 'Cardano', cg: 'cardano' },
    { symbol: 'TRXUSDT', name: 'TRON', cg: 'tron' },
    { symbol: 'LINKUSDT', name: 'Chainlink', cg: 'chainlink' },
    { symbol: 'AVAXUSDT', name: 'Avalanche', cg: 'avalanche-2' },
    { symbol: 'DOTUSDT', name: 'Polkadot', cg: 'polkadot' },
    { symbol: 'LTCUSDT', name: 'Litecoin', cg: 'litecoin' },
    { symbol: 'BCHUSDT', name: 'Bitcoin Cash', cg: 'bitcoin-cash' },
    { symbol: 'ATOMUSDT', name: 'Cosmos', cg: 'cosmos' },
    { symbol: 'NEARUSDT', name: 'NEAR', cg: 'near' },
    { symbol: 'FILUSDT', name: 'Filecoin', cg: 'filecoin' },
    { symbol: 'PEPEUSDT', name: 'Pepe', cg: 'pepe' },
    { symbol: 'SHIBUSDT', name: 'Shiba Inu', cg: 'shiba-inu' }
  ];

  /* ---------- low-level fetch ---------- */

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function getJson(url, attempts) {
    attempts = attempts || 3;
    var lastError = null;

    for (var attempt = 0; attempt < attempts; attempt++) {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 12000);
      try {
        var response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timer);

        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) {
            lastError = new Error('Service responded ' + response.status);
            if (attempt < attempts - 1) {
              await delay(600 * Math.pow(2, attempt));
              continue;
            }
          }
          throw new Error('Service responded ' + response.status);
        }
        return await response.json();
      } catch (error) {
        clearTimeout(timer);
        lastError = error.name === 'AbortError' ? new Error('Request timed out') : error;
        if (attempt < attempts - 1) await delay(500 * Math.pow(2, attempt));
      }
    }
    throw lastError || new Error('Request failed');
  }

  // Run `worker` over `items` with bounded concurrency.
  async function mapLimit(items, limit, worker) {
    var results = new Array(items.length);
    var cursor = 0;

    async function runner() {
      while (cursor < items.length) {
        var index = cursor++;
        results[index] = await worker(items[index], index);
      }
    }

    var runners = [];
    for (var i = 0; i < Math.min(limit, items.length); i++) runners.push(runner());
    await Promise.all(runners);
    return results;
  }

  /* ---------- normalisation ---------- */

  function fromBinanceKlines(rows) {
    return rows.map(function (row) {
      return {
        t: row[0],
        o: parseFloat(row[1]),
        h: parseFloat(row[2]),
        l: parseFloat(row[3]),
        c: parseFloat(row[4]),
        v: parseFloat(row[5])
      };
    });
  }

  function fromCoinGeckoOhlc(rows) {
    return rows.map(function (row) {
      return { t: row[0], o: row[1], h: row[2], l: row[3], c: row[4], v: null };
    });
  }

  /* ---------- cache ---------- */

  var candleCache = new Map();
  var inflight = new Map();
  var overviewCache = null;

  function cacheGet(symbol) {
    var entry = candleCache.get(symbol);
    if (entry && Date.now() - entry.at < CACHE_TTL) return entry;
    return null;
  }

  function invalidate() {
    candleCache.clear();
    inflight.clear();
    overviewCache = null;
  }

  /* ---------- public API ---------- */

  /**
   * Snapshot for the market table: price, 24h change, 24h quote volume.
   * Returns { source, at, quotes: { BTCUSDT: {...} } }.
   */
  async function overview() {
    if (overviewCache && Date.now() - overviewCache.at < CACHE_TTL) return overviewCache;

    var symbols = COINS.map(function (c) { return c.symbol; });
    var quotes = {};

    try {
      var url =
        BINANCE + '/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(symbols));
      var rows = await getJson(url, 2);
      (rows || []).forEach(function (row) {
        quotes[row.symbol] = {
          price: parseFloat(row.lastPrice),
          changePct: parseFloat(row.priceChangePercent),
          quoteVolume: parseFloat(row.quoteVolume)
        };
      });
      if (!Object.keys(quotes).length) throw new Error('Empty ticker response');
      overviewCache = { source: 'Binance', at: Date.now(), quotes: quotes };
      return overviewCache;
    } catch (binanceError) {
      // Fallback: CoinGecko gives the same headline numbers in one request.
      var ids = COINS.map(function (c) { return c.cg; }).join(',');
      var markets = await getJson(
        COINGECKO + '/coins/markets?vs_currency=usd&ids=' + ids + '&per_page=250',
        2
      );
      var byId = {};
      (markets || []).forEach(function (coin) { byId[coin.id] = coin; });
      COINS.forEach(function (coin) {
        var match = byId[coin.cg];
        if (!match) return;
        quotes[coin.symbol] = {
          price: match.current_price,
          changePct: match.price_change_percentage_24h,
          quoteVolume: match.total_volume
        };
      });
      if (!Object.keys(quotes).length) throw binanceError;
      overviewCache = { source: 'CoinGecko', at: Date.now(), quotes: quotes };
      return overviewCache;
    }
  }

  /**
   * Daily candles for one pair, newest last.
   * Returns { source, candles }. Concurrent calls for the same pair share
   * a single request.
   */
  function candles(symbol) {
    var cached = cacheGet(symbol);
    if (cached) {
      return Promise.resolve({ source: cached.source, candles: cached.candles, cached: true });
    }
    if (inflight.has(symbol)) return inflight.get(symbol);

    var request = loadCandles(symbol).finally(function () {
      inflight.delete(symbol);
    });
    inflight.set(symbol, request);
    return request;
  }

  async function loadCandles(symbol) {
    var coin = COINS.find(function (c) { return c.symbol === symbol; });

    try {
      var rows = await getJson(
        BINANCE + '/klines?symbol=' + symbol + '&interval=1d&limit=120',
        2
      );
      if (!Array.isArray(rows) || rows.length < 50) throw new Error('Insufficient candle history');
      var parsed = fromBinanceKlines(rows);
      candleCache.set(symbol, { at: Date.now(), source: 'Binance', candles: parsed });
      return { source: 'Binance', candles: parsed, cached: false };
    } catch (binanceError) {
      if (!coin) throw binanceError;
      var ohlc = await getJson(
        COINGECKO + '/coins/' + coin.cg + '/ohlc?vs_currency=usd&days=365',
        2
      );
      if (!Array.isArray(ohlc) || ohlc.length < 55) throw binanceError;
      var fallback = fromCoinGeckoOhlc(ohlc);
      candleCache.set(symbol, { at: Date.now(), source: 'CoinGecko', candles: fallback });
      return { source: 'CoinGecko', candles: fallback, cached: false };
    }
  }

  /**
   * Fetch candles for many pairs, tolerating individual failures.
   * Resolves with { SYMBOL: {source, candles} | {error} }.
   */
  async function manyCandles(symbols, onResult) {
    var output = {};
    await mapLimit(symbols, 4, async function (symbol) {
      try {
        var result = await candles(symbol);
        output[symbol] = result;
      } catch (error) {
        output[symbol] = { error: error.message };
      }
      if (onResult) onResult(symbol, output[symbol]);
    });
    return output;
  }

  global.EMG = global.EMG || {};
  global.EMG.api = {
    COINS: COINS,
    overview: overview,
    candles: candles,
    manyCandles: manyCandles,
    invalidate: invalidate,
    cacheTtl: CACHE_TTL
  };
})(window);
