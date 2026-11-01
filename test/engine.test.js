/*
 * Known-answer tests for the indicator engine.
 *
 * engine.js is a browser script that attaches to window.EMG, so it is loaded
 * into a vm context rather than imported. No dependencies, no network.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'engine.js' });
const engine = sandbox.window.EMG.engine;

// Build a candle series from a close-price function.
function candles(count, closeAt, volumeAt) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const close = closeAt(i);
    const open = i === 0 ? close : closeAt(i - 1);
    out.push({
      t: Date.UTC(2025, 0, 1) + i * 86400000,
      o: open,
      h: Math.max(open, close) + 1,
      l: Math.min(open, close) - 1,
      c: close,
      v: volumeAt ? volumeAt(i) : 1000
    });
  }
  return out;
}

const ramp = (from, step) => (i) => from + step * i;

test('emaSeries returns nulls during warm-up and seeds with the SMA', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const ema = engine.emaSeries(values, 5);

  assert.equal(ema.length, values.length);
  // Arrays created in the vm context belong to another realm, so copy before
  // comparing with deepEqual.
  assert.deepEqual(Array.from(ema.slice(0, 4)), [null, null, null, null]);
  assert.equal(ema[4], 3); // mean(1..5)

  // k = 2 / (5 + 1); 6 * 1/3 + 3 * 2/3 = 4
  assert.ok(Math.abs(ema[5] - 4) < 1e-9);
  assert.ok(ema[9] > ema[5], 'EMA should follow a rising series upward');
});

test('emaSeries returns all nulls when the series is shorter than the period', () => {
  assert.deepEqual(Array.from(engine.emaSeries([1, 2, 3], 5)), [null, null, null]);
});

test('rsi is 100 with only gains and 0 with only losses', () => {
  const rising = Array.from({ length: 40 }, (_, i) => 100 + i);
  const falling = Array.from({ length: 40 }, (_, i) => 140 - i);

  assert.equal(engine.rsi(rising, 14), 100);
  assert.equal(engine.rsi(falling, 14), 0);
});

test('rsi is neutral when the series does not move', () => {
  const flat = Array.from({ length: 40 }, () => 100);
  assert.equal(engine.rsi(flat, 14), 50);
});

test('macd histogram tracks acceleration, not direction alone', () => {
  // A constant-rate trend leaves the histogram near zero (the signal line
  // simply lags), so the sign flips only when the move accelerates.
  const acceleratingUp = Array.from({ length: 120 }, (_, i) => Math.exp((i * i) / 20000));
  const acceleratingDown = Array.from({ length: 120 }, (_, i) => Math.exp(-(i * i) / 20000));

  assert.ok(engine.macdHistogramPct(acceleratingUp) > 0);
  assert.ok(engine.macdHistogramPct(acceleratingDown) < 0);
});

test('macd histogram is null without enough history', () => {
  assert.equal(engine.macdHistogramPct([1, 2, 3]), null);
});

test('atr equals the constant true range', () => {
  const flat = candles(40, () => 10);
  assert.equal(engine.atr(flat, 14), 2);
});

test('rangePosition reports where price sits in the window', () => {
  const rising = candles(30, ramp(100, 1));
  const range = engine.rangePosition(rising, 30);

  assert.equal(range.low, 99);
  assert.equal(range.high, 130);
  assert.ok(range.position > 90, 'price near the top of its range');
});

test('volumeRatio compares the last completed session to the prior 20', () => {
  const series = candles(22, ramp(100, 1), (i) => (i === 20 ? 200 : i === 21 ? 50 : 100));
  assert.equal(engine.volumeRatio(series, 20), 2);
});

test('score needs at least 50 candles', () => {
  assert.equal(engine.score(candles(40, ramp(100, 1))), null);
  assert.equal(engine.score([]), null);
});

test('score components add up to the total and stay inside the scale', () => {
  const rising = candles(120, (i) => 100 * Math.pow(1.01, i));
  const result = engine.score(rising);

  assert.ok(result);
  assert.equal(result.max, 7);
  assert.equal(result.components.length, 4);

  const sum = result.components.reduce((total, part) => total + part.points, 0);
  assert.equal(result.points, sum);
  assert.ok(result.points >= -7 && result.points <= 7);
});

test('score components use the documented weights', () => {
  const result = engine.score(candles(120, (i) => 100 * Math.pow(1.01, i)));
  const weights = Object.fromEntries(result.components.map((part) => [part.key, part.max]));

  assert.deepEqual(weights, { ema: 2, rsi: 2, macd: 2, obv: 1 });
});

test('label and tone agree for trending and flat markets', () => {
  const variants = [
    candles(120, (i) => 100 * Math.pow(1.01, i)),
    candles(120, (i) => 100 * Math.pow(0.99, i)),
    candles(120, () => 100),
    candles(120, (i) => 100 + 10 * Math.sin(i / 4))
  ];

  for (const series of variants) {
    const result = engine.score(series);
    assert.ok(result, 'expected a score for a full series');

    if (result.label === 'Neutral') {
      assert.equal(result.tone, 'flat');
    } else if (result.label.toLowerCase().endsWith('bullish')) {
      assert.equal(result.tone, 'up');
    } else {
      assert.equal(result.tone, 'down');
    }
  }
});
