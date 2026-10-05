// Analisis: divergence harga vs MACD / StochRSI, support-resistance, performa.
const { macd, stochRsi, atr } = require('./indicators');
const { buildSetup } = require('./setup');

const CFG = {
  pivotLeft: 3,        // bar kiri untuk konfirmasi pivot
  pivotRight: 2,       // bar kanan (delay konfirmasi)
  minDist: 5,          // jarak minimum antar pivot (bar)
  maxDist: 60,         // jarak maksimum antar pivot (bar)
  refineWin: 2,        // pencarian ekstrem indikator di sekitar bar pivot harga
  minPricePct: 0.003,  // beda harga minimum antar pivot
  priceTol: 0.002,     // toleransi garis harga (tidak boleh ditembus candle di antaranya)
  activeBars: 8,       // divergence dianggap "aktif" jika pivot ke-2 maks N bar lalu
  stochOversold: 35,   // divergence bullish regular hanya dari area di bawah ini
  stochOverbought: 65, // divergence bearish regular hanya dari area di atas ini
  lookbackBars: 150,   // histori divergence yang ditampilkan di chart
  macdSource: (process.env.MACD_SOURCE || 'hist').toLowerCase(), // 'hist' | 'line'
};

function pivots(arr, L, R, mode) {
  const out = [];
  const n = arr.length;
  for (let i = L; i < n - R; i++) {
    const v = arr[i];
    if (v == null) continue;
    let ok = true;
    for (let j = i - L; j < i && ok; j++) {
      const w = arr[j];
      if (w == null) { ok = false; break; }
      if (mode === 'low' ? w <= v : w >= v) ok = false;
    }
    for (let j = i + 1; j <= i + R && ok; j++) {
      const w = arr[j];
      if (w == null) { ok = false; break; }
      if (mode === 'low' ? w < v : w > v) ok = false;
    }
    if (ok) out.push(i);
  }
  return out;
}

function refine(ind, i, mode, win) {
  let best = -1;
  for (let j = Math.max(0, i - win); j <= Math.min(ind.length - 1, i + win); j++) {
    if (ind[j] == null) continue;
    if (best < 0 || (mode === 'low' ? ind[j] < ind[best] : ind[j] > ind[best])) best = j;
  }
  return best;
}

function findDivergences(c, ind, name, zoneLo, zoneHi) {
  const n = c.t.length;
  const res = [];
  const vals = ind.filter((v) => v != null).slice(-200);
  if (vals.length < 30) return res;
  const range = Math.max(...vals) - Math.min(...vals);
  if (!(range > 0)) return res;
  const minDelta = range * 0.02;
  const eps = range * 0.04;
  const first = Math.max(0, n - CFG.lookbackBars);

  for (const side of ['bull', 'bear']) {
    const low = side === 'bull';
    const src = low ? c.l : c.h;
    const mode = low ? 'low' : 'high';
    const pv = pivots(src, CFG.pivotLeft, CFG.pivotRight, mode).filter((i) => i >= first - CFG.maxDist);
    for (let b = 1; b < pv.length; b++) {
      const i2 = pv[b];
      if (i2 < first) continue;
      const j2 = refine(ind, i2, mode, CFG.refineWin);
      if (j2 < 0) continue;
      const found = new Set();
      for (let a = b - 1; a >= Math.max(0, b - 4); a--) {
        const i1 = pv[a];
        const dist = i2 - i1;
        if (dist < CFG.minDist) continue;
        if (dist > CFG.maxDist) break;
        const j1 = refine(ind, i1, mode, CFG.refineWin);
        if (j1 < 0 || j2 <= j1) continue;
        const p1 = src[i1], p2 = src[i2], v1 = ind[j1], v2 = ind[j2];
        const priceUp = p2 > p1 * (1 + CFG.minPricePct);
        const priceDn = p2 < p1 * (1 - CFG.minPricePct);
        let dmode = null;
        if (low) {
          if (priceDn && v2 > v1 + minDelta && v1 < zoneLo) dmode = 'regular';          // LL harga, HL indikator
          else if (priceUp && v2 < v1 - minDelta) dmode = 'hidden';                    // HL harga, LL indikator
        } else {
          if (priceUp && v2 < v1 - minDelta && v1 > zoneHi) dmode = 'regular';          // HH harga, LH indikator
          else if (priceDn && v2 > v1 + minDelta) dmode = 'hidden';                    // LH harga, HH indikator
        }
        if (!dmode || found.has(dmode)) continue;
        // Garis harga & indikator tidak boleh ditembus di antara dua pivot
        let clean = true;
        for (let k = i1 + 1; k < i2 && clean; k++) {
          const lp = p1 + ((p2 - p1) * (k - i1)) / dist;
          if (low ? src[k] < lp - lp * CFG.priceTol : src[k] > lp + lp * CFG.priceTol) clean = false;
        }
        const jd = j2 - j1;
        for (let k = j1 + 1; k < j2 && clean; k++) {
          if (ind[k] == null) continue;
          const li = v1 + ((v2 - v1) * (k - j1)) / jd;
          if (low ? ind[k] < li - eps : ind[k] > li + eps) clean = false;
        }
        if (!clean) continue;
        // Invalid bila harga sudah menembus pivot ke-2 setelahnya
        let valid = true;
        for (let k = i2 + 1; k < n; k++) {
          if (low ? c.l[k] < p2 * 0.999 : c.h[k] > p2 * 1.001) { valid = false; break; }
        }
        found.add(dmode);
        res.push({
          kind: side, mode: dmode, ind: name,
          i1, i2, j1, j2, t1: c.t[i1], t2: c.t[i2], u1: c.t[j1], u2: c.t[j2],
          p1, p2, v1, v2, valid, age: n - 1 - i2,
          active: valid && n - 1 - i2 <= CFG.activeBars,
        });
      }
    }
  }
  return res;
}

// Support / resistance dari klaster pivot swing.
function supportResistance(c, price) {
  const n = c.t.length;
  const a = atr(c.h, c.l, c.c, 14);
  const lastAtr = a[n - 1] || price * 0.02;
  const tol = Math.min(0.03, Math.max(0.008, (lastAtr / price) * 0.6));
  const pts = [];
  const start = Math.max(0, n - 260);
  const L = 4, R = 4;
  for (const i of pivots(c.h, L, R, 'high')) if (i >= start) pts.push({ p: c.h[i], w: 1 + (i - start) / (n - start) });
  for (const i of pivots(c.l, L, R, 'low')) if (i >= start) pts.push({ p: c.l[i], w: 1 + (i - start) / (n - start) });
  pts.sort((x, y) => x.p - y.p);
  const clusters = [];
  for (const pt of pts) {
    const cl = clusters[clusters.length - 1];
    if (cl && pt.p <= cl.max * (1 + tol)) {
      cl.sum += pt.p * pt.w; cl.wsum += pt.w; cl.n++; cl.max = pt.p; cl.score += pt.w;
    } else {
      clusters.push({ sum: pt.p * pt.w, wsum: pt.w, n: 1, max: pt.p, score: pt.w });
    }
  }
  const levels = clusters
    .map((cl) => ({ price: cl.sum / cl.wsum, touches: cl.n, strength: +cl.score.toFixed(2) }))
    .filter((l) => l.touches >= 2);
  const supports = levels.filter((l) => l.price < price * 0.998).sort((x, y) => y.price - x.price).slice(0, 3);
  const resistances = levels.filter((l) => l.price > price * 1.002).sort((x, y) => x.price - y.price).slice(0, 3);
  return { supports, resistances, tol };
}

function perf(c) {
  const n = c.t.length;
  const out = {};
  if (n < 2) return out;
  const lastT = c.t[n - 1];
  const last = c.c[n - 1];
  const at = (days) => {
    const target = lastT - days * 86400;
    if (c.t[0] > target + 6 * 86400) return null;
    let idx = 0;
    for (let i = 0; i < n; i++) { if (c.t[i] <= target) idx = i; else break; }
    return c.c[idx];
  };
  const pct = (base) => (base ? ((last - base) / base) * 100 : null);
  out['1W'] = pct(at(7));
  out['1M'] = pct(at(30));
  out['3M'] = pct(at(91));
  out['6M'] = pct(at(182));
  out['1Y'] = pct(at(365));
  const year = new Date(lastT * 1000).getUTCFullYear();
  let base = null;
  for (let i = 0; i < n; i++) {
    if (new Date(c.t[i] * 1000).getUTCFullYear() < year) base = c.c[i]; else break;
  }
  out.YTD = base ? pct(base) : null;
  return out;
}

function cross(k, d, bars) {
  const n = k.length;
  for (let i = n - 1; i >= Math.max(1, n - bars); i--) {
    if (k[i] == null || d[i] == null || k[i - 1] == null || d[i - 1] == null) continue;
    if (k[i - 1] <= d[i - 1] && k[i] > d[i] && k[i] <= 50) return 'bull';
    if (k[i - 1] >= d[i - 1] && k[i] < d[i] && k[i] >= 50) return 'bear';
  }
  return null;
}

// c: {t,o,h,l,c,v} (array sejajar)
function analyze(c) {
  const n = c.t.length;
  if (n < 60) return null;
  const m = macd(c.c);
  const s = stochRsi(c.c);
  const macdSrc = CFG.macdSource === 'line' ? m.line : m.hist;
  const divs = [
    ...findDivergences(c, macdSrc, 'MACD', 0, 0),
    ...findDivergences(c, s.k, 'StochRSI', CFG.stochOversold, CFG.stochOverbought),
  ].sort((x, y) => y.i2 - x.i2);
  const price = c.c[n - 1];
  const sr = supportResistance(c, price);
  const res = { series: { macd: m, stoch: s }, divs, sr, perf: perf(c), trig: cross(s.k, s.d, 3) };
  res.setup = buildSetup(c, res);
  return res;
}

module.exports = { analyze, perf, CFG };
