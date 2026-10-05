// Indikator teknikal. Semua fungsi mengembalikan array sepanjang input; nilai warm-up = null.

function ema(src, period) {
  const out = new Array(src.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  let seed = [];
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v == null) continue;
    if (prev == null) {
      seed.push(v);
      if (seed.length === period) {
        prev = seed.reduce((a, b) => a + b, 0) / period;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function sma(src, period) {
  const out = new Array(src.length).fill(null);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v == null) { sum = 0; n = 0; continue; }
    sum += v; n++;
    if (n > period) sum -= src[i - period];
    if (n >= period) out[i] = sum / period;
  }
  return out;
}

function macd(close, fast = 12, slow = 26, signal = 9) {
  const ef = ema(close, fast);
  const es = ema(close, slow);
  const line = close.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const sig = ema(line, signal);
  const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
  return { line, signal: sig, hist };
}

// RSI Wilder
function rsi(close, period = 14) {
  const out = new Array(close.length).fill(null);
  let avgG = 0, avgL = 0;
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    if (i <= period) {
      avgG += g; avgL += l;
      if (i === period) {
        avgG /= period; avgL /= period;
        out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
      }
    } else {
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
      out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
  }
  return out;
}

// Stochastic RSI (skala 0-100): rsiLen 14, stochLen 14, smoothK 3, smoothD 3
function stochRsi(close, rsiLen = 14, stochLen = 14, kSmooth = 3, dSmooth = 3) {
  const r = rsi(close, rsiLen);
  const raw = new Array(close.length).fill(null);
  for (let i = 0; i < r.length; i++) {
    if (i < stochLen - 1 || r[i] == null) continue;
    let lo = Infinity, hi = -Infinity, ok = true;
    for (let j = i - stochLen + 1; j <= i; j++) {
      if (r[j] == null) { ok = false; break; }
      if (r[j] < lo) lo = r[j];
      if (r[j] > hi) hi = r[j];
    }
    if (!ok) continue;
    raw[i] = hi === lo ? 50 : ((r[i] - lo) / (hi - lo)) * 100;
  }
  const k = sma(raw, kSmooth);
  const d = sma(k, dSmooth);
  return { k, d };
}

function atr(high, low, close, period = 14) {
  const tr = high.map((h, i) => (i === 0 ? h - low[i] : Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1]))));
  const out = new Array(tr.length).fill(null);
  let prev = null;
  for (let i = 0; i < tr.length; i++) {
    if (i === period - 1) { prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period; out[i] = prev; }
    else if (i >= period) { prev = (prev * (period - 1) + tr[i]) / period; out[i] = prev; }
  }
  return out;
}

module.exports = { ema, sma, macd, rsi, stochRsi, atr };
