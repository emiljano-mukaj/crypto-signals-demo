/*
 * Crypto Signals — indicator engine
 *
 * Pure functions only: no DOM, no network, no globals beyond the EMG namespace.
 * Every indicator here is textbook TA (Wilder RSI, MACD, OBV, ATR).
 *
 * The scoring model is illustrative and deliberately simple: four readings,
 * fixed weights, fixed thresholds. It is NOT the production model.
 */
(function (global) {
  'use strict';

  var SCALE_MAX = 7;

  /* ---------- series helpers ---------- */

  // Returns an array aligned with `values`; entries before the warm-up are null.
  function emaSeries(values, period) {
    var out = new Array(values.length).fill(null);
    if (!values || values.length < period) return out;
    var k = 2 / (period + 1);
    var prev = 0;
    for (var i = 0; i < period; i++) prev += values[i];
    prev /= period;
    out[period - 1] = prev;
    for (var j = period; j < values.length; j++) {
      prev = values[j] * k + prev * (1 - k);
      out[j] = prev;
    }
    return out;
  }

  function last(arr) {
    return arr && arr.length ? arr[arr.length - 1] : null;
  }

  /* ---------- indicators ---------- */

  // Wilder's RSI over the supplied closes.
  function rsi(closes, period) {
    period = period || 14;
    if (!closes || closes.length < period + 1) return null;
    var gain = 0;
    var loss = 0;
    for (var i = 1; i <= period; i++) {
      var change = closes[i] - closes[i - 1];
      if (change > 0) gain += change;
      else loss -= change;
    }
    var avgGain = gain / period;
    var avgLoss = loss / period;
    for (var j = period + 1; j < closes.length; j++) {
      var diff = closes[j] - closes[j - 1];
      avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    }
    if (avgLoss === 0) return 100;
    var rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  // MACD histogram, normalised by price so it is comparable across pairs.
  function macdHistogramPct(closes) {
    if (!closes || closes.length < 35) return null;
    var fast = emaSeries(closes, 12);
    var slow = emaSeries(closes, 26);
    var macdLine = [];
    for (var i = 0; i < closes.length; i++) {
      if (fast[i] === null || slow[i] === null) continue;
      macdLine.push(fast[i] - slow[i]);
    }
    if (macdLine.length < 9) return null;
    var signal = emaSeries(macdLine, 9);
    var hist = last(macdLine) - last(signal);
    var price = last(closes);
    if (!price) return null;
    return (hist / price) * 100;
  }

  // On-balance volume slope, normalised by average absolute volume.
  function obvTrend(candles, lookback) {
    lookback = lookback || 14;
    if (!candles || candles.length < lookback + 1) return null;
    var obv = 0;
    var series = [];
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      if (i === 0) {
        obv = c.v || 0;
      } else {
        obv += c.c >= candles[i - 1].c ? c.v || 0 : -(c.v || 0);
      }
      series.push(obv);
    }
    var window = series.slice(-lookback);
    var first = window[0];
    var final = window[window.length - 1];
    var span = Math.abs(first) > 0 ? Math.abs(first) : 1;
    return { change: (final - first) / span, rising: final > first };
  }

  function atr(candles, period) {
    period = period || 14;
    if (!candles || candles.length < period + 1) return null;
    var trs = [];
    for (var i = 1; i < candles.length; i++) {
      var c = candles[i];
      var prevClose = candles[i - 1].c;
      trs.push(Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose)));
    }
    var value = 0;
    for (var j = 0; j < period; j++) value += trs[j];
    value /= period;
    for (var k = period; k < trs.length; k++) {
      value = (value * (period - 1) + trs[k]) / period;
    }
    return value;
  }

  function rangePosition(candles, n) {
    n = n || 30;
    var slice = candles.slice(-n);
    if (!slice.length) return null;
    var high = -Infinity;
    var low = Infinity;
    for (var i = 0; i < slice.length; i++) {
      if (slice[i].h > high) high = slice[i].h;
      if (slice[i].l < low) low = slice[i].l;
    }
    var close = last(slice).c;
    var span = high - low;
    return {
      high: high,
      low: low,
      position: span > 0 ? ((close - low) / span) * 100 : 50
    };
  }

  // Volume of the most recent completed session versus the prior 20 sessions.
  function volumeRatio(candles, period) {
    period = period || 20;
    if (!candles || candles.length < period + 2) return null;
    var index = candles.length - 2;
    var sum = 0;
    for (var i = index - period; i < index; i++) {
      sum += candles[i].v || 0;
    }
    var avg = sum / period;
    var current = candles[index].v || 0;
    return avg > 0 ? current / avg : null;
  }

  /* ---------- scoring ---------- */

  function scoreEma(closes) {
    if (closes.length < 50) return { points: 0, note: 'Not enough history.' };
    var fast = last(emaSeries(closes, 20));
    var slow = last(emaSeries(closes, 50));
    var diff = ((fast - slow) / slow) * 100;
    var points = diff > 1 ? 2 : diff > 0 ? 1 : diff < -1 ? -2 : diff < 0 ? -1 : 0;
    var note =
      'EMA 20 is ' + Math.abs(diff).toFixed(2) + '% ' +
      (diff >= 0 ? 'above' : 'below') + ' EMA 50.';
    return { points: points, note: note };
  }

  function scoreRsi(closes) {
    var value = rsi(closes.slice(-60), 14);
    if (value === null) return { points: 0, note: 'Not enough history.' };
    var points = value < 30 ? 2 : value < 40 ? 1 : value > 70 ? -2 : value > 60 ? -1 : 0;
    var band =
      value < 30 ? 'oversold' :
      value < 40 ? 'below the neutral band' :
      value > 70 ? 'overbought' :
      value > 60 ? 'above the neutral band' : 'in the neutral band';
    return { points: points, note: 'RSI 14 at ' + value.toFixed(1) + ', ' + band + '.' };
  }

  function scoreMacd(closes) {
    var pct = macdHistogramPct(closes);
    if (pct === null) return { points: 0, note: 'Not enough history.' };
    var points = pct > 0.4 ? 2 : pct > 0.1 ? 1 : pct < -0.4 ? -2 : pct < -0.1 ? -1 : 0;
    return {
      points: points,
      note:
        'Histogram at ' + (pct >= 0 ? '+' : '') + pct.toFixed(2) +
        '% of price, ' + (pct >= 0 ? 'above' : 'below') + ' its signal line.'
    };
  }

  function scoreObv(candles) {
    var trend = obvTrend(candles.slice(-30), 14);
    if (!trend) return { points: 0, note: 'Not enough history.' };
    var points = trend.rising ? 1 : trend.change < 0 ? -1 : 0;
    return {
      points: points,
      note: trend.rising ? 'Volume accumulating on up days.' : 'Volume accumulating on down days.'
    };
  }

  function labelFor(points) {
    if (points >= 5) return { label: 'Very strong bullish', tone: 'up' };
    if (points >= 3) return { label: 'Strong bullish', tone: 'up' };
    if (points >= 1) return { label: 'Bullish', tone: 'up' };
    if (points <= -5) return { label: 'Very strong bearish', tone: 'down' };
    if (points <= -3) return { label: 'Strong bearish', tone: 'down' };
    if (points <= -1) return { label: 'Bearish', tone: 'down' };
    return { label: 'Neutral', tone: 'flat' };
  }

  /*
   * score(candles) -> {
   *   points, label, tone, components[], stats{}
   * }
   * Weights are fixed: EMA ±2, RSI ±2, MACD ±2, OBV ±1 (total ±7).
   */
  function score(candles) {
    if (!candles || candles.length < 50) return null;
    var closes = candles.map(function (c) { return c.c; });

    var ema = scoreEma(closes);
    var rsiPart = scoreRsi(closes);
    var macdPart = scoreMacd(closes);
    var obvPart = scoreObv(candles);

    var components = [
      { key: 'ema', name: 'EMA trend (20 / 50)', max: 2, points: ema.points, note: ema.note },
      { key: 'rsi', name: 'RSI (14)', max: 2, points: rsiPart.points, note: rsiPart.note },
      { key: 'macd', name: 'MACD histogram', max: 2, points: macdPart.points, note: macdPart.note },
      { key: 'obv', name: 'On-balance volume', max: 1, points: obvPart.points, note: obvPart.note }
    ];

    var points = components.reduce(function (sum, c) { return sum + c.points; }, 0);
    var descriptor = labelFor(points);
    var lastClose = last(candles).c;
    var atrValue = atr(candles, 14);

    return {
      points: points,
      max: SCALE_MAX,
      label: descriptor.label,
      tone: descriptor.tone,
      components: components,
      stats: {
        close: lastClose,
        atrPct: atrValue ? (atrValue / lastClose) * 100 : null,
        volumeRatio: volumeRatio(candles, 20),
        range30: rangePosition(candles, 30)
      }
    };
  }

  global.EMG = global.EMG || {};
  global.EMG.engine = {
    SCALE_MAX: SCALE_MAX,
    emaSeries: emaSeries,
    rsi: rsi,
    macdHistogramPct: macdHistogramPct,
    obvTrend: obvTrend,
    atr: atr,
    rangePosition: rangePosition,
    volumeRatio: volumeRatio,
    score: score
  };
})(window);
