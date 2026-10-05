/* Indikator opsional (dihitung di browser dari candle). Semua array sejajar dengan input, warm-up = null. */
const IND = (() => {
  const nulls = (n) => new Array(n).fill(null);

  function sma(a, n) {
    const out = nulls(a.length);
    let sum = 0, cnt = 0;
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (v == null) { sum = 0; cnt = 0; continue; }
      sum += v; cnt++;
      if (cnt > n) sum -= a[i - n];
      if (cnt >= n) out[i] = sum / n;
    }
    return out;
  }

  function ema(a, n) {
    const out = nulls(a.length), k = 2 / (n + 1);
    let prev = null, seed = 0, cnt = 0;
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (v == null) continue;
      if (prev == null) { seed += v; if (++cnt === n) { prev = seed / n; out[i] = prev; } }
      else { prev = v * k + prev * (1 - k); out[i] = prev; }
    }
    return out;
  }

  function bollinger(c, n = 20, k = 2) {
    const mid = sma(c, n), up = nulls(c.length), lo = nulls(c.length);
    for (let i = n - 1; i < c.length; i++) {
      if (mid[i] == null) continue;
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += (c[j] - mid[i]) ** 2;
      const sd = Math.sqrt(s / n);
      up[i] = mid[i] + k * sd; lo[i] = mid[i] - k * sd;
    }
    return { mid, up, lo };
  }

  function rsi(c, n = 14) {
    const out = nulls(c.length);
    let g = 0, l = 0;
    for (let i = 1; i < c.length; i++) {
      const d = c[i] - c[i - 1], gu = d > 0 ? d : 0, ld = d < 0 ? -d : 0;
      if (i <= n) { g += gu; l += ld; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
      else { g = (g * (n - 1) + gu) / n; l = (l * (n - 1) + ld) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    }
    return out;
  }

  function atr(h, l, c, n = 14) {
    const out = nulls(h.length);
    let prev = null;
    for (let i = 0; i < h.length; i++) {
      const tr = i === 0 ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
      if (i < n - 1) { prev = (prev ?? 0) + tr; continue; }
      if (i === n - 1) { prev = (prev + tr) / n; out[i] = prev; continue; }
      prev = (prev * (n - 1) + tr) / n; out[i] = prev;
    }
    return out;
  }

  // Supertrend: dir = 1 (naik, garis di bawah harga) / -1 (turun, garis di atas harga)
  function supertrend(h, l, c, n = 10, k = 3) {
    const a = atr(h, l, c, n), len = c.length;
    const st = nulls(len), dir = nulls(len), fu = nulls(len), fl = nulls(len);
    let start = a.findIndex((v) => v != null);
    if (start < 0) return { line: st, dir };
    for (let i = start; i < len; i++) {
      const hl2 = (h[i] + l[i]) / 2, ub = hl2 + k * a[i], lb = hl2 - k * a[i];
      if (i === start) { fu[i] = ub; fl[i] = lb; dir[i] = c[i] >= hl2 ? 1 : -1; }
      else {
        fu[i] = ub < fu[i - 1] || c[i - 1] > fu[i - 1] ? ub : fu[i - 1];
        fl[i] = lb > fl[i - 1] || c[i - 1] < fl[i - 1] ? lb : fl[i - 1];
        if (dir[i - 1] === -1) dir[i] = c[i] > fu[i] ? 1 : -1; else dir[i] = c[i] < fl[i] ? -1 : 1;
      }
      st[i] = dir[i] === 1 ? fl[i] : fu[i];
    }
    return { line: st, dir };
  }

  // Parabolic SAR
  function psar(h, l, step = 0.02, max = 0.2) {
    const len = h.length, sar = nulls(len), dir = nulls(len);
    if (len < 3) return { sar, dir };
    let bull = true, s = l[0], ep = h[0], af = step;
    sar[0] = s; dir[0] = 1;
    for (let i = 1; i < len; i++) {
      s = s + af * (ep - s);
      if (bull) {
        s = Math.min(s, l[i - 1], i > 1 ? l[i - 2] : l[i - 1]);
        if (l[i] < s) { bull = false; s = ep; ep = l[i]; af = step; }
        else if (h[i] > ep) { ep = h[i]; af = Math.min(af + step, max); }
      } else {
        s = Math.max(s, h[i - 1], i > 1 ? h[i - 2] : h[i - 1]);
        if (h[i] > s) { bull = true; s = ep; ep = h[i]; af = step; }
        else if (l[i] < ep) { ep = l[i]; af = Math.min(af + step, max); }
      }
      sar[i] = s; dir[i] = bull ? 1 : -1;
    }
    return { sar, dir };
  }

  // VWAP (reset tiap hari bursa; hanya bermakna untuk timeframe intraday)
  function vwap(t, h, l, c, v) {
    const out = nulls(t.length);
    let day = null, pv = 0, vv = 0;
    for (let i = 0; i < t.length; i++) {
      const d = Math.floor(t[i] / 86400);
      if (d !== day) { day = d; pv = 0; vv = 0; }
      const tp = (h[i] + l[i] + c[i]) / 3;
      pv += tp * v[i]; vv += v[i];
      out[i] = vv > 0 ? pv / vv : null;
    }
    return out;
  }

  function mid(h, l, n) {
    const out = nulls(h.length);
    for (let i = n - 1; i < h.length; i++) {
      let hi = -Infinity, lo = Infinity;
      for (let j = i - n + 1; j <= i; j++) { if (h[j] > hi) hi = h[j]; if (l[j] < lo) lo = l[j]; }
      out[i] = (hi + lo) / 2;
    }
    return out;
  }

  // Ichimoku (tanpa shift; pemanggil menggeser span ke depan dan chikou ke belakang)
  function ichimoku(h, l, a = 9, b = 26, c2 = 52) {
    const tenkan = mid(h, l, a), kijun = mid(h, l, b), sb = mid(h, l, c2);
    const sa = tenkan.map((v, i) => (v != null && kijun[i] != null ? (v + kijun[i]) / 2 : null));
    return { tenkan, kijun, spanA: sa, spanB: sb };
  }

  return { sma, ema, bollinger, rsi, atr, supertrend, psar, vwap, ichimoku };
})();
