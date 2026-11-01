/*
 * Crypto Signals — canvas chart
 *
 * A small candlestick renderer: 90 daily candles, volume strip, EMA 20 overlay,
 * last-price marker and a hover readout. No charting library, no CDN.
 */
(function (global) {
  'use strict';

  var COLORS = {
    grid: 'rgba(255,255,255,0.045)',
    axis: '#6b7c99',
    up: '#21c7b6',
    down: '#ef5f53',
    upSoft: 'rgba(33,199,182,0.22)',
    downSoft: 'rgba(239,95,83,0.22)',
    ema: '#e2b04a',
    crosshair: 'rgba(233,238,248,0.28)',
    lastLine: 'rgba(233,238,248,0.25)'
  };

  function Chart(canvas, tipEl) {
    this.canvas = canvas;
    this.tip = tipEl;
    this.ctx = canvas.getContext('2d');
    this.candles = [];
    this.ema = [];
    this.hover = null;
    this.formatPrice = function (v) { return String(v); };
    this.width = 0;
    this.height = 0;

    this._onMove = this._onMove.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._resize = this._resize.bind(this);

    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerleave', this._onLeave);

    if (typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver(this._resize);
      this._observer.observe(canvas);
    } else {
      global.addEventListener('resize', this._resize);
    }

    this._resize();
  }

  Chart.prototype.setFormat = function (fn) {
    this.formatPrice = fn;
  };

  Chart.prototype.setData = function (candles, ema, formatPrice) {
    this.candles = candles || [];
    this.ema = ema || [];
    if (formatPrice) this.formatPrice = formatPrice;
    this.hover = null;
    if (this.tip) this.tip.hidden = true;
    this.draw();
  };

  Chart.prototype._resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = global.devicePixelRatio || 1;
    if (!rect.width || !rect.height) return;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    this.draw();
  };

  Chart.prototype._geometry = function () {
    var padRight = 56;
    var padLeft = 8;
    var padTop = 12;
    var padBottom = 22;
    var volumeH = 42;
    var gap = 10;

    var plotW = this.width - padLeft - padRight;
    var plotH = this.height - padTop - padBottom - volumeH - gap;

    var count = this.candles.length;
    var step = count > 0 ? plotW / count : plotW;
    var bodyW = Math.max(1.5, Math.min(9, step * 0.62));

    var min = Infinity;
    var max = -Infinity;
    for (var i = 0; i < count; i++) {
      var c = this.candles[i];
      if (c.l < min) min = c.l;
      if (c.h > max) max = c.h;
    }
    for (var j = 0; j < this.ema.length; j++) {
      var value = this.ema[j];
      if (value === null || value === undefined) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (!isFinite(min) || !isFinite(max) || min === max) {
      min = min - 1;
      max = max + 1;
    }
    var pad = (max - min) * 0.08;
    min -= pad;
    max += pad;

    return {
      padLeft: padLeft,
      padRight: padRight,
      padTop: padTop,
      padBottom: padBottom,
      plotW: plotW,
      plotH: plotH,
      volumeH: volumeH,
      gap: gap,
      step: step,
      bodyW: bodyW,
      min: min,
      max: max,
      volumeTop: padTop + plotH + gap
    };
  };

  Chart.prototype._y = function (price, g) {
    return g.padTop + g.plotH - ((price - g.min) / (g.max - g.min)) * g.plotH;
  };

  Chart.prototype._x = function (index, g) {
    return g.padLeft + g.step * (index + 0.5);
  };

  Chart.prototype.draw = function () {
    var ctx = this.ctx;
    if (!this.width || !this.height) return;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.candles.length) return;

    var g = this._geometry();
    this._grid(ctx, g);
    this._volume(ctx, g);
    this._candles(ctx, g);
    this._ema(ctx, g);
    this._lastPrice(ctx, g);
    this._timeAxis(ctx, g);

    if (this.hover !== null && this.candles[this.hover]) {
      this._crosshair(ctx, g, this.hover);
    }  };

  Chart.prototype._grid = function (ctx, g) {
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLORS.axis;
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    var lines = 4;
    for (var i = 0; i <= lines; i++) {
      var price = g.min + ((g.max - g.min) / lines) * i;
      var y = Math.round(this._y(price, g)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(g.padLeft, y);
      ctx.lineTo(this.width - g.padRight, y);
      ctx.stroke();
      ctx.fillText(this.formatPrice(price), this.width - g.padRight + 8, y);
    }
    ctx.restore();
  };

  Chart.prototype._volume = function (ctx, g) {
    var ctx2 = ctx;
    var maxVol = 0;
    var i;
    for (i = 0; i < this.candles.length; i++) {
      if ((this.candles[i].v || 0) > maxVol) maxVol = this.candles[i].v;
    }
    if (!maxVol) return;

    ctx2.save();
    for (i = 0; i < this.candles.length; i++) {
      var c = this.candles[i];
      var ratio = (c.v || 0) / maxVol;
      var h = Math.max(1, ratio * g.volumeH);
      var x = this._x(i, g);
      var up = c.c >= c.o;
      ctx2.fillStyle = up ? COLORS.upSoft : COLORS.downSoft;
      ctx2.fillRect(x - g.bodyW / 2, g.volumeTop + (g.volumeH - h), g.bodyW, h);
    }
    ctx2.restore();
  };

  Chart.prototype._candles = function (ctx, g) {
    ctx.save();
    for (var i = 0; i < this.candles.length; i++) {
      var c = this.candles[i];
      var up = c.c >= c.o;
      var color = up ? COLORS.up : COLORS.down;
      var x = this._x(i, g);
      var openY = this._y(c.o, g);
      var closeY = this._y(c.c, g);
      var highY = this._y(c.h, g);
      var lowY = this._y(c.l, g);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, highY);
      ctx.lineTo(Math.round(x) + 0.5, lowY);
      ctx.stroke();

      var top = Math.min(openY, closeY);
      var height = Math.max(1, Math.abs(closeY - openY));
      ctx.fillStyle = color;
      ctx.fillRect(x - g.bodyW / 2, top, g.bodyW, height);
    }
    ctx.restore();
  };

  Chart.prototype._ema = function (ctx, g) {
    ctx.save();
    ctx.strokeStyle = COLORS.ema;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < this.ema.length; i++) {
      var value = this.ema[i];
      if (value === null || value === undefined) continue;
      var x = this._x(i, g);
      var y = this._y(value, g);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  };

  Chart.prototype._lastPrice = function (ctx, g) {
    var lastCandle = this.candles[this.candles.length - 1];
    var y = this._y(lastCandle.c, g);
    var label = this.formatPrice(lastCandle.c);

    ctx.save();
    ctx.strokeStyle = COLORS.lastLine;
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.padLeft, y);
    ctx.lineTo(this.width - g.padRight, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '10px ui-monospace, Menlo, monospace';
    var textW = ctx.measureText(label).width;
    var boxW = textW + 12;
    var boxH = 16;
    var boxX = this.width - g.padRight - 4;
    var boxY = Math.max(2, Math.min(this.height - boxH - 2, y - boxH / 2));

    ctx.fillStyle = lastCandle.c >= lastCandle.o ? COLORS.up : COLORS.down;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(boxX - boxW + 4, boxY, boxW, boxH);
    ctx.globalAlpha = 1;
    ctx.fillStyle = lastCandle.c >= lastCandle.o ? COLORS.up : COLORS.down;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, boxX, boxY + boxH / 2 + 0.5);
    ctx.restore();
  };

  Chart.prototype._timeAxis = function (ctx, g) {
    var count = this.candles.length;
    var marks = count > 60 ? [0, Math.floor(count / 2), count - 1] : [0, count - 1];
    ctx.save();
    ctx.fillStyle = COLORS.axis;
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'bottom';

    marks.forEach(function (index, position) {
      var candle = this.candles[index];
      if (!candle) return;
      var date = new Date(candle.t);
      var text = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      var x = this._x(index, g);
      ctx.textAlign = position === 0 ? 'left' : position === marks.length - 1 ? 'right' : 'center';
      if (position === 0) x = g.padLeft;
      if (position === marks.length - 1) x = this.width - g.padRight;
      ctx.fillText(text, x, this.height - 4);
    }, this);
    ctx.restore();
  };

  Chart.prototype._crosshair = function (ctx, g, index) {
    var c = this.candles[index];
    var x = this._x(index, g);
    var y = this._y(c.c, g);

    ctx.save();
    ctx.strokeStyle = COLORS.crosshair;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, g.padTop);
    ctx.lineTo(Math.round(x) + 0.5, g.padTop + g.plotH + g.gap + g.volumeH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = c.c >= c.o ? COLORS.up : COLORS.down;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    this._placeTip(x, this.pointerY || y, c);
  };

  Chart.prototype._placeTip = function (x, y, candle) {
    if (!this.tip) return;
    var date = new Date(candle.t);
    var rows = [
      ['Open', this.formatPrice(candle.o)],
      ['High', this.formatPrice(candle.h)],
      ['Low', this.formatPrice(candle.l)],
      ['Close', this.formatPrice(candle.c)]
    ];
    var html =
      '<div class="tip__date">' +
      date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      '</div>';
    rows.forEach(function (row) {
      html +=
        '<div class="tip__row"><span>' + row[0] + '</span><span>' + row[1] + '</span></div>';
    });

    this.tip.innerHTML = html;
    this.tip.hidden = false;

    var tipWidth = this.tip.offsetWidth || 150;
    var tipHeight = this.tip.offsetHeight || 100;
    var left = Math.min(Math.max(x, tipWidth / 2 + 6), this.width - tipWidth / 2 - 6);
    var top = Math.min(Math.max(y - 10, tipHeight + 6), this.height - 10);

    this.tip.style.left = left + 'px';
    this.tip.style.top = top + 'px';
  };

  Chart.prototype._onMove = function (event) {
    if (!this.candles.length) return;
    var rect = this.canvas.getBoundingClientRect();
    var x = event.clientX - rect.left;
    this.pointerY = event.clientY - rect.top;
    var g = this._geometry();
    var index = Math.floor((x - g.padLeft) / g.step);
    if (index < 0 || index >= this.candles.length) {
      this._onLeave();
      return;
    }
    if (index === this.hover) return;
    this.hover = index;
    this.draw();
  };

  Chart.prototype._onLeave = function () {
    if (this.hover === null) return;
    this.hover = null;
    if (this.tip) this.tip.hidden = true;
    this.draw();
  };

  global.EMG = global.EMG || {};
  global.EMG.Chart = Chart;
})(window);
