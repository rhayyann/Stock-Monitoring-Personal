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
  nearMaxATR: 1.2,     // deteksi dini: harga maksimal N× ATR di atas low sebelumnya
  formMinLL: 0.3,      // deteksi dini: low kedua minimal 0,3× ATR di bawah low sebelumnya
  formMaxBounce: 0.8,  // deteksi dini: harga maksimal 0,8× ATR di atas low kedua (belum naik)
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
  for (const i of pivots(c.h, L, R, 'high')) if (i >= start) pts.push({ p: c.h[i], i, w: 1 + (i - start) / (n - start) });
  for (const i of pivots(c.l, L, R, 'low')) if (i >= start) pts.push({ p: c.l[i], i, w: 1 + (i - start) / (n - start) });
  pts.sort((x, y) => x.p - y.p);
  const clusters = [];
  for (const pt of pts) {
    const cl = clusters[clusters.length - 1];
    if (cl && pt.p <= cl.max * (1 + tol)) {
      cl.sum += pt.p * pt.w; cl.wsum += pt.w; cl.n++; cl.max = pt.p; cl.score += pt.w; cl.i0 = Math.min(cl.i0, pt.i); cl.i1 = Math.max(cl.i1, pt.i);
    } else {
      clusters.push({ sum: pt.p * pt.w, wsum: pt.w, n: 1, max: pt.p, score: pt.w, i0: pt.i, i1: pt.i });
    }
  }
  const levels = clusters
    .map((cl) => ({ price: cl.sum / cl.wsum, touches: cl.n, strength: +cl.score.toFixed(2), t0: c.t[cl.i0], t1: c.t[cl.i1] }))
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

// Deteksi DINI (sebelum harga naik): low kedua yang belum terkonfirmasi sebagai pivot (form),
// atau harga yang tinggal sedikit di atas low sebelumnya sementara indikator masih punya ruang (near).
function findForming(c, ind, name, zoneLo, A) {
  const n = c.t.length, last = n - 1;
  const out = { form: null, near: null };
  const vals = ind.filter((v) => v != null).slice(-200);
  if (vals.length < 30 || ind[last] == null) return out;
  const range = Math.max(...vals) - Math.min(...vals);
  if (!(range > 0)) return out;
  const minDelta = range * 0.02, eps = range * 0.04;
  const L = CFG.pivotLeft, R = CFG.pivotRight;
  const pl = pivots(c.l, L, R, 'low'); // pivot low yang sudah terkonfirmasi

  // --- (1) sedang terbentuk: low terendah di 2 bar terakhir belum terkonfirmasi ---
  let j = last;
  for (let k = last - 1; k >= Math.max(0, last - 1); k--) if (c.l[k] < c.l[j]) j = k;
  let leftOk = j - L >= 0;
  for (let m = j - L; m < j && leftOk; m++) if (c.l[m] <= c.l[j]) leftOk = false;
  if (leftOk && last - j < R) {
    const j2 = refine(ind, j, 'low', CFG.refineWin);
    for (let a = pl.length - 1; a >= Math.max(0, pl.length - 4) && j2 >= 0 && !out.form; a--) {
      const i1 = pl[a], dist = j - i1;
      if (dist < CFG.minDist) continue;
      if (dist > CFG.maxDist) break;
      const j1 = refine(ind, i1, 'low', CFG.refineWin);
      if (j1 < 0 || j2 <= j1) continue;
      const p1 = c.l[i1], p2 = c.l[j], v1 = ind[j1], v2 = ind[j2];
      if (!(p2 < p1 * (1 - CFG.minPricePct) && v2 > v1 + minDelta && v1 < zoneLo)) continue;
      // harus benar-benar lower low (bukan beda 1 tick) dan harga BELUM bounce dari low kedua
      if (p1 - p2 < CFG.formMinLL * A || c.c[last] - p2 > CFG.formMaxBounce * A) continue;
      let clean = true;
      for (let k = i1 + 1; k < j && clean; k++) {
        const lp = p1 + ((p2 - p1) * (k - i1)) / dist;
        if (c.l[k] < lp - lp * CFG.priceTol) clean = false;
      }
      const jd = j2 - j1;
      for (let k = j1 + 1; k < j2 && clean; k++) {
        if (ind[k] == null) continue;
        if (ind[k] < v1 + ((v2 - v1) * (k - j1)) / jd - eps) clean = false;
      }
      if (!clean) continue;
      out.form = {
        kind: 'bull', mode: 'regular', ind: name, i1, i2: j, j1, j2, t1: c.t[i1], t2: c.t[j], u1: c.t[j1], u2: c.t[j2],
        p1, p2, v1, v2, valid: true, age: last - j, active: true, forming: true,
      };
    }
  }

  // --- (2) mendekati: belum membuat low yang lebih rendah, tetapi sudah dekat ---
  if (!out.form) {
    for (let a = pl.length - 1; a >= Math.max(0, pl.length - 3); a--) {
      const i1 = pl[a], age = last - i1;
      if (age > CFG.maxDist) break;
      if (age < CFG.minDist) continue;
      const p1 = c.l[i1];
      let broken = false;
      for (let m = i1 + 1; m <= last; m++) if (c.l[m] <= p1) { broken = true; break; }
      if (broken) continue;
      const distAtr = (c.c[last] - p1) / A;
      if (distAtr > CFG.nearMaxATR || c.c[last] > c.c[Math.max(0, last - 3)]) continue; // harus sedang turun mendekati low
      const j1 = refine(ind, i1, 'low', CFG.refineWin);
      if (j1 < 0) continue;
      const v1 = ind[j1], vNow = ind[last];
      if (!(v1 < zoneLo) || !(vNow > v1 + minDelta * 2)) continue;
      out.near = { ind: name, i1, t1: c.t[i1], p1, v1, vNow, distAtr, age };
      break;
    }
  }
  return out;
}

// c: {t,o,h,l,c,v} (array sejajar)
function analyze(c) {
  const n = c.t.length;
  if (n < 60) return null;
  const m = macd(c.c);
  const s = stochRsi(c.c);
  const macdSrc = CFG.macdSource === 'line' ? m.line : m.hist;
  const price = c.c[n - 1];
  const A = atr(c.h, c.l, c.c, 14)[n - 1] || price * 0.02;
  const fm = [findForming(c, macdSrc, 'MACD', 0, A), findForming(c, s.k, 'StochRSI', CFG.stochOversold, A)];
  const divs = [
    ...findDivergences(c, macdSrc, 'MACD', 0, 0),
    ...findDivergences(c, s.k, 'StochRSI', CFG.stochOversold, CFG.stochOverbought),
    ...fm.map((x) => x.form).filter(Boolean),
  ].sort((x, y) => y.i2 - x.i2);
  const sr = supportResistance(c, price);
  const res = { series: { macd: m, stoch: s }, divs, sr, perf: perf(c), trig: cross(s.k, s.d, 3) };
  res.near = fm.map((x) => x.near).filter(Boolean);
  res.setup = buildSetup(c, res);
  return res;
}

module.exports = { analyze, perf, CFG };
