# Crypto Signals: public demo

A browser-only slice of **EM Gruppen Crypto Signals**. It pulls public market
data, scores 18 major pairs with four standard indicators, and draws the chart
itself. No account, no API key, no build step, no backend.

> **This is a demo, not the product.** The score shown here is an illustrative
> equal-weight blend of four indicators. It is not the production model and it
> contains no trading rules. Nothing in this repository is investment advice.

## What it does

- **Market view.** Price, 24h change and a score for each pair, fetched in one
  request and scored from daily candles.
- **Pair detail.** Gauge, candlestick chart with EMA 20 and volume, plus
  volatility and range statistics.
- **Transparent scoring.** Every point is broken down by indicator, with the
  reading that produced it.
- **Keyboard and mobile friendly.** Buttons rather than clickable divs, visible
  focus states, one column on narrow screens.

## How the score works

Scores are computed on the last 120 daily candles. Four readings, fixed weights,
no hidden tuning:

| Indicator | Weight | Reading |
| --- | --- | --- |
| EMA trend | ±2 | 20-period EMA relative to the 50-period EMA, as % of price |
| RSI (14) | ±2 | Momentum bands: oversold below 30, overbought above 70 |
| MACD histogram | ±2 | 12/26 EMA difference minus its 9-period signal, normalised by price |
| On-balance volume | ±1 | Whether volume accumulates on up days or down days over 14 sessions |

Total range is ±7. Labels are symmetrical: 1 to 2 bullish or bearish, 3 to 4
strong, 5 to 7 very strong.

## Running it

Any static server works:

```bash
git clone https://github.com/emiljano-mukaj/crypto-signals-demo.git
cd crypto-signals-demo
python3 -m http.server 8080
```

Then open <http://localhost:8080>. Opening `index.html` directly from disk also
works in most browsers; the app only talks to remote APIs, never to local files.

There is nothing to install and nothing to configure.

## Tests

The indicator layer runs under Node's built-in test runner, with no dependencies:

```bash
npm test
```

Thirteen known-answer tests cover EMA warm-up, RSI edge cases (all gains, all
losses, flat series), MACD sign, ATR, range position, volume ratio, the minimum
history requirement, and the component weights that make up the total score. CI
runs the same suite on Node 20, 22 and 24.

## Structure

| File | Responsibility |
| --- | --- |
| `index.html` | Semantic page shell, no inline logic |
| `style.css` | Design tokens, layout, responsive rules |
| `api.js` | Public endpoints, retries, concurrency limit, five-minute cache |
| `engine.js` | Pure indicator and scoring functions, no DOM or network |
| `chart.js` | Canvas candlestick renderer, EMA overlay, hover readout |
| `app.js` | State, rendering, event wiring, hash routing |

The indicator layer has no knowledge of the UI, and the data layer has no
knowledge of the score, which is what makes the engine testable on its own.

## Data

- **Binance** public REST API for daily klines and 24h tickers (primary).
- **CoinGecko** public API as a fallback if Binance is unreachable or
  geo-blocked.

Responses are cached in memory for five minutes, one request per pair at a time,
four pairs in flight. No keys, no secrets, no proxy. If both sources fail, the
interface says so in plain language instead of showing a broken chart.

## Deliberately not included

- The production scoring model, weights or backtests
- Entry, exit, stop-loss or target logic
- Subscription, billing or account code
- Push notifications, FCM keys or mobile signing configuration
- Any backend, worker or service credentials

## Browser support

Current Chrome, Safari, Firefox and Edge. Uses Canvas 2D, CSS custom properties,
`AbortController` and `ResizeObserver`; no transpiler needed.

## License

MIT. See [LICENSE](LICENSE).

---

Built by [EM Gruppen](https://emgruppen.com). Demo interface only; the shipping
Android app is a separate codebase and is not part of this repository.
