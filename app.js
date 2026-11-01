/*
 * Crypto Signals: UI layer
 *
 * Wires the data layer and the indicator engine to the page. All state lives
 * in `state`; rendering functions are pure reads of that state.
 */
(function (global) {
  'use strict';

  const api = global.EMG.api;
  const engine = global.EMG.engine;

  const COINS = api.COINS;

  const state = {
    symbol: 'BTCUSDT',
    filter: '',
    overview: null,
    pairSource: '—',
    candles: {},
    scores: {},
    updatedAt: null
  };

  let chart = null;
  const pending = {};

  /* ---------- formatting ---------- */

  function fmtPrice(value) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    let digits;
    if (Math.abs(value) >= 1000) digits = 0;
    else if (Math.abs(value) >= 100) digits = 2;
    else if (Math.abs(value) >= 1) digits = 3;
    else if (Math.abs(value) >= 0.01) digits = 4;
    else digits = 6;
    return value.toLocaleString('en-US', {
      minimumFractionDigits: digits === 0 ? 0 : Math.min(2, digits),
      maximumFractionDigits: digits
    });
  }

  function fmtPct(value, digits) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    return (value >= 0 ? '+' : '') + value.toFixed(digits === undefined ? 2 : digits) + '%';
  }

  function fmtCompact(value) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    return '$' + Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  function fmtPoints(points) {
    if (points === 0) return '0';
    return (points > 0 ? '+' : '') + points;
  }

  function toneFor(points) {
    return points > 0 ? 'up' : points < 0 ? 'down' : 'flat';
  }

  function baseSymbol(symbol) {
    return symbol.replace(/USDT$/, '');
  }

  /* ---------- market list ---------- */

  function buildMarketRows() {
    const list = document.getElementById('market-list');
    const html = COINS.map(function (coin) {
      return (
        '<button class="market__row" type="button" aria-pressed="false" data-symbol="' +
        coin.symbol +
        '">' +
        '<span class="pair">' +
        '<span class="pair__sym">' + baseSymbol(coin.symbol) + '</span>' +
        '<span class="pair__name">' + coin.name + '</span>' +
        '</span>' +
        '<span class="cell--num cell--price" data-cell="price"><span class="skeleton"></span></span>' +
        '<span class="cell--num" data-cell="change"><span class="skeleton"></span></span>' +
        '<span class="cell--num" data-cell="score"><span class="badge badge--flat">—</span></span>' +
        '</button>'
      );
    }).join('');

    list.innerHTML = html;

    list.addEventListener('click', function (event) {
      const row = event.target.closest('.market__row');
      if (!row) return;
      selectPair(row.getAttribute('data-symbol'), true);
    });

    list.setAttribute('aria-busy', 'false');
  }

  function rowFor(symbol) {
    return document.querySelector('.market__row[data-symbol="' + symbol + '"]');
  }

  function paintQuote(symbol) {
    const row = rowFor(symbol);
    if (!row || !state.overview) return;
    const quote = state.overview.quotes[symbol];
    const priceCell = row.querySelector('[data-cell="price"]');
    const changeCell = row.querySelector('[data-cell="change"]');

    if (!quote) {
      priceCell.textContent = '—';
      changeCell.textContent = '—';
      return;
    }

    priceCell.textContent = fmtPrice(quote.price);

    const tone = quote.changePct >= 0 ? 'tone-up' : 'tone-down';
    changeCell.textContent = fmtPct(quote.changePct);
    changeCell.className = 'cell--num ' + tone;
  }

  function paintScore(symbol) {
    const row = rowFor(symbol);
    if (!row) return;
    const cell = row.querySelector('[data-cell="score"]');
    const score = state.scores[symbol];

    if (!score) {
      cell.innerHTML = '<span class="badge badge--flat">—</span>';
      return;
    }

    const tone = toneFor(score.points);
    cell.innerHTML =
      '<span class="badge badge--' + tone + '" title="' + score.label + '">' +
      fmtPoints(score.points) +
      '</span>';
  }

  function markActiveRow() {
    document.querySelectorAll('.market__row').forEach(function (row) {
      const isActive = row.getAttribute('data-symbol') === state.symbol;
      row.classList.toggle('is-active', isActive);
      row.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function applyFilter() {
    const query = state.filter.trim().toLowerCase();
    let visible = 0;

    COINS.forEach(function (coin) {
      const row = rowFor(coin.symbol);
      if (!row) return;
      const haystack = (coin.name + ' ' + baseSymbol(coin.symbol)).toLowerCase();
      const match = !query || haystack.indexOf(query) !== -1;
      row.hidden = !match;
      if (match) visible++;
    });

    document.getElementById('market-empty').hidden = visible > 0;
  }

  /* ---------- gauge ---------- */

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function gaugePoint(cx, cy, radius, fraction) {
    const angle = Math.PI + fraction * Math.PI;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle)
    };
  }

  function renderGauge(score) {
    const svg = document.getElementById('gauge');
    const cx = 160;
    const cy = 150;
    const radius = 118;
    const fraction = Math.max(0, Math.min(1, (score.points + score.max) / (score.max * 2)));

    svg.innerHTML = '';
    svg.setAttribute(
      'aria-label',
      'Signal gauge: ' + score.label + ', ' + fmtPoints(score.points) + ' out of ' + score.max
    );

    const defs = document.createElementNS(SVG_NS, 'defs');
    const gradient = document.createElementNS(SVG_NS, 'linearGradient');
    gradient.setAttribute('id', 'gauge-gradient');
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('y1', '0%');
    gradient.setAttribute('x2', '100%');
    gradient.setAttribute('y2', '0%');
    [
      ['0%', '#ef5f53'],
      ['50%', '#3a4763'],
      ['100%', '#21c7b6']
    ].forEach(function (stop) {
      const node = document.createElementNS(SVG_NS, 'stop');
      node.setAttribute('offset', stop[0]);
      node.setAttribute('stop-color', stop[1]);
      gradient.appendChild(node);
    });
    defs.appendChild(gradient);
    svg.appendChild(defs);

    function arc(from, to, stroke, width, opacity, dash) {
      const start = gaugePoint(cx, cy, radius, from);
      const end = gaugePoint(cx, cy, radius, to);
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute(
        'd',
        'M' + start.x.toFixed(2) + ' ' + start.y.toFixed(2) +
        ' A' + radius + ' ' + radius + ' 0 0 1 ' + end.x.toFixed(2) + ' ' + end.y.toFixed(2)
      );
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', width);
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('opacity', opacity);
      if (dash) path.setAttribute('stroke-dasharray', dash);
      svg.appendChild(path);
      return path;
    }

    arc(0, 1, '#1b2740', 12, 1);
    if (score.points !== 0) {
      const from = Math.min(0.5, fraction);
      const to = Math.max(0.5, fraction);
      arc(from, to, 'url(#gauge-gradient)', 12, 1);
    }

    // Ticks every whole point, longer at the ends and the middle.
    for (let i = -score.max; i <= score.max; i++) {
      const t = (i + score.max) / (score.max * 2);
      const outer = gaugePoint(cx, cy, radius - 20, t);
      const inner = gaugePoint(cx, cy, radius - (i % 7 === 0 ? 30 : 26), t);
      const tick = document.createElementNS(SVG_NS, 'line');
      tick.setAttribute('x1', outer.x);
      tick.setAttribute('y1', outer.y);
      tick.setAttribute('x2', inner.x);
      tick.setAttribute('y2', inner.y);
      tick.setAttribute('stroke', '#31405e');
      tick.setAttribute('stroke-width', i === 0 ? 2 : 1);
      svg.appendChild(tick);
    }

    // Needle
    const tip = gaugePoint(cx, cy, radius - 34, fraction);
    const needle = document.createElementNS(SVG_NS, 'line');
    needle.setAttribute('x1', cx);
    needle.setAttribute('y1', cy);
    needle.setAttribute('x2', tip.x);
    needle.setAttribute('y2', tip.y);
    needle.setAttribute('stroke', '#e9eef8');
    needle.setAttribute('stroke-width', 2);
    needle.setAttribute('stroke-linecap', 'round');
    svg.appendChild(needle);

    const hub = document.createElementNS(SVG_NS, 'circle');
    hub.setAttribute('cx', cx);
    hub.setAttribute('cy', cy);
    hub.setAttribute('r', 5);
    hub.setAttribute('fill', '#0d1421');
    hub.setAttribute('stroke', '#e9eef8');
    hub.setAttribute('stroke-width', 2);
    svg.appendChild(hub);

    [
      { text: 'Bearish', fraction: 0.02, anchor: 'start' },
      { text: 'Neutral', fraction: 0.5, anchor: 'middle' },
      { text: 'Bullish', fraction: 0.98, anchor: 'end' }
    ].forEach(function (tick) {
      const point = gaugePoint(cx, cy, radius - 52, tick.fraction);
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', tick.anchor === 'start' ? 34 : tick.anchor === 'end' ? 286 : point.x);
      label.setAttribute('y', 172);
      label.setAttribute('text-anchor', tick.anchor);
      label.setAttribute('fill', '#6b7c99');
      label.setAttribute('font-size', '10.5');
      label.setAttribute('letter-spacing', '0.06em');
      label.textContent = tick.text.toUpperCase();
      svg.appendChild(label);
    });
  }

  /* ---------- detail panel ---------- */

  function renderDetail(symbol) {
    const coin = COINS.find(function (c) { return c.symbol === symbol; });
    const score = state.scores[symbol];
    const quote = state.overview && state.overview.quotes[symbol];

    document.getElementById('pair-name').textContent = coin ? coin.name : symbol;
    document.getElementById('pair-symbol').textContent = baseSymbol(symbol) + '/USDT';
    document.getElementById('pair-source').textContent = state.pairSource + ' · daily candles';

    const priceEl = document.getElementById('pair-price');
    const changeEl = document.getElementById('pair-change');

    if (quote) {
      priceEl.textContent = '$' + fmtPrice(quote.price);
      changeEl.textContent = fmtPct(quote.changePct) + ' · 24h';
      changeEl.className = 'quote__change mono ' + (quote.changePct >= 0 ? 'tone-up' : 'tone-down');
    } else {
      priceEl.textContent = '—';
      changeEl.textContent = '—';
      changeEl.className = 'quote__change mono';
    }

    if (!score) {
      document.getElementById('signal-readout').textContent = 'Loading signal…';
      return;
    }

    renderGauge(score);

    const toneClass = score.tone === 'up' ? 'tone-up' : score.tone === 'down' ? 'tone-down' : 'tone-flat';
    document.getElementById('signal-readout').innerHTML =
      '<strong class="' + toneClass + '">' + score.label + '</strong>' +
      ' · score ' + fmtPoints(score.points) + ' of ±' + score.max;

    renderStats(quote, score);
    renderBreakdown(score);
    renderChart(symbol);
  }

  function renderStats(quote, score) {
    const stats = score.stats;
    const volumeValue = quote && quote.quoteVolume ? fmtCompact(quote.quoteVolume) : '—';

    const tiles = [
      { label: '24h volume', value: volumeValue },
      { label: 'Volatility (ATR)', value: stats.atrPct === null ? '—' : stats.atrPct.toFixed(1) + '%' },
      { label: '30d range', value: stats.range30 ? stats.range30.position.toFixed(0) + '% from low' : '—' },
      {
        label: 'Volume vs 20d',
        value: stats.volumeRatio === null ? '—' : stats.volumeRatio.toFixed(1) + '×'
      }
    ];

    document.getElementById('stats').innerHTML = tiles.map(function (tile) {
      return (
        '<div class="stat">' +
        '<p class="stat__label">' + tile.label + '</p>' +
        '<p class="stat__value">' + tile.value + '</p>' +
        '</div>'
      );
    }).join('');
  }

  function renderBreakdown(score) {
    const rows = score.components.map(function (component) {
      const tone = toneFor(component.points);
      const share = Math.min(1, Math.abs(component.points) / component.max);
      const width = (share * 50).toFixed(1) + '%';

      const fillStyle =
        component.points >= 0
          ? 'left:50%;width:' + width
          : 'right:50%;width:' + width;

      return (
        '<div class="brow">' +
        '<div class="brow__top">' +
        '<span class="brow__name">' + component.name + '</span>' +
        '<span class="brow__value tone-' + tone + '">' +
        fmtPoints(component.points) + ' / ±' + component.max +
        '</span>' +
        '</div>' +
        '<div class="brow__track">' +
        '<span class="brow__fill brow__fill--' + tone + '" style="' + fillStyle + '"></span>' +
        '</div>' +
        '<p class="brow__note">' + component.note + '</p>' +
        '</div>'
      );
    });

    document.getElementById('breakdown').innerHTML = rows.join('');
  }

  function renderChart(symbol) {
    if (!chart) {
      chart = new global.EMG.Chart(
        document.getElementById('chart'),
        document.getElementById('chart-tip')
      );
    }

    const candles = (state.candles[symbol] || []).slice(-90);
    if (!candles.length) return;

    const closes = state.candles[symbol].map(function (c) { return c.c; });
    const emaFull = engine.emaSeries(closes, 20);
    const offset = state.candles[symbol].length - candles.length;
    const ema = emaFull.slice(offset);

    chart.setFormat(formatAxisPrice);
    chart.setData(candles, ema);
    document.getElementById('chart-title').textContent =
      'Daily candles, last ' + candles.length + ' sessions';
  }

  function formatAxisPrice(value) {
    if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (value >= 10) return value.toFixed(0);
    if (value >= 1) return value.toFixed(2);
    if (value >= 0.01) return value.toFixed(4);
    return value.toFixed(6);
  }

  function clearDetail() {
    document.getElementById('gauge').innerHTML = '';
    document.getElementById('signal-readout').textContent = 'Loading signal…';
    document.getElementById('stats').innerHTML = '';
    document.getElementById('breakdown').innerHTML = '';
  }

  function renderDetailError(message) {
    clearDetail();
    document.getElementById('signal-readout').textContent = message;
  }

  /* ---------- loading ---------- */

  function setMarketStatus(text, tone) {
    const el = document.getElementById('market-status');
    el.textContent = text;
    el.style.color = tone === 'error' ? 'var(--red)' : '';
  }

  function setUpdatedLabel(at) {
    if (!at) return;
    const time = new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('updated').textContent = 'Updated ' + time;
  }

  async function selectPair(symbol, pushHash) {
    if (!COINS.some(function (c) { return c.symbol === symbol; })) return;
    state.symbol = symbol;
    markActiveRow();
    if (pushHash) {
      history.replaceState(null, '', '#/' + baseSymbol(symbol));
    }
    if (!state.scores[symbol]) clearDetail();
    await loadPair(symbol, true);
  }

  async function loadPair(symbol, force) {
    if (!force && state.candles[symbol]) {
      renderDetail(symbol);
      return;
    }

    if (pending[symbol]) return pending[symbol];

    document.getElementById('signal-readout').textContent = 'Loading signal…';

    pending[symbol] = (async function () {
      try {
        const result = await api.candles(symbol);
        state.candles[symbol] = result.candles;
        const computed = engine.score(result.candles);
        if (computed) state.scores[symbol] = computed;
        paintScore(symbol);

        if (state.symbol === symbol) {
          state.pairSource = result.source;
          renderDetail(symbol);
        }
      } catch (error) {
        paintScore(symbol);
        if (state.symbol === symbol) {
          renderDetailError('Market data is unavailable for this pair right now.');
        }
      } finally {
        delete pending[symbol];
      }
    })();

    return pending[symbol];
  }

  async function loadScores() {
    const ordered = [state.symbol].concat(
      COINS.map(function (c) { return c.symbol; }).filter(function (s) { return s !== state.symbol; })
    );
    const sources = {};

    await api.manyCandles(ordered, function (symbol, result) {
      if (result.error) {
        paintScore(symbol);
        return;
      }
      sources[result.source] = (sources[result.source] || 0) + 1;
      state.candles[symbol] = result.candles;
      const computed = engine.score(result.candles);
      if (computed) state.scores[symbol] = computed;
      paintScore(symbol);
      if (symbol === state.symbol) {
        state.pairSource = result.source;
        renderDetail(symbol);
      }
    });

    const failed = ordered.filter(function (s) { return !state.scores[s]; }).length;
    const primary =
      Object.keys(sources).sort(function (a, b) { return sources[b] - sources[a]; })[0] ||
      'Market data';

    setMarketStatus(
      failed
        ? primary + ' · ' + (ordered.length - failed) + ' of ' + ordered.length + ' pairs'
        : primary,
      failed ? 'error' : null
    );
  }

  async function loadOverview() {
    try {
      const snapshot = await api.overview();
      state.overview = snapshot;
      state.updatedAt = snapshot.at;
      COINS.forEach(function (coin) { paintQuote(coin.symbol); });
      setUpdatedLabel(snapshot.at);
      setMarketStatus(snapshot.source);
    } catch (error) {
      setMarketStatus('Data unavailable', 'error');
      document.getElementById('updated').textContent = 'Could not reach the market data service';
    }
  }

  async function refreshAll() {
    const button = document.getElementById('refresh');
    button.setAttribute('aria-busy', 'true');
    setMarketStatus('Refreshing');

    api.invalidate();
    state.candles = {};
    state.scores = {};
    Object.keys(pending).forEach(function (key) { delete pending[key]; });

    await loadOverview();
    await loadPair(state.symbol, true);
    loadScores();

    button.removeAttribute('aria-busy');
  }

  /* ---------- wiring ---------- */

  function readHash() {
    const raw = (location.hash || '').replace(/^#\/?/, '').toUpperCase().trim();
    if (!raw) return null;
    const symbol = raw.indexOf('USDT') !== -1 ? raw : raw + 'USDT';
    return COINS.some(function (c) { return c.symbol === symbol; }) ? symbol : null;
  }

  function init() {
    buildMarketRows();

    document.getElementById('search').addEventListener('input', function (event) {
      state.filter = event.target.value;
      applyFilter();
    });

    document.getElementById('refresh').addEventListener('click', refreshAll);

    global.addEventListener('hashchange', function () {
      const symbol = readHash();
      if (symbol && symbol !== state.symbol) selectPair(symbol, false);
    });

    const initial = readHash() || 'BTCUSDT';
    state.symbol = initial;
    markActiveRow();

    loadOverview().then(function () {
      loadPair(state.symbol, true);
      loadScores();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
