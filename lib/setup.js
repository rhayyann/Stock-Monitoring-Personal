// Setup "siap entry besok": bullish divergence yang sudah valid + konfirmasi bahwa harga mulai bergerak naik,
// lengkap dengan level untuk sesi berikutnya (pemicu breakout, zona pullback, stop loss, target).
const { ema, atr } = require('./indicators');
const { roundTick, tick } = require('./plan');

const MAX_AGE = 15; // bullish divergence masih dianggap relevan sampai N bar setelah pivot ke-2
const CONF = [
  ['stoch', 'StochRSI naik', 'StochRSI K di atas D dan naik, belum overbought'],
  ['macd', 'MACD naik', 'Histogram MACD naik 2 bar berturut-turut atau garis MACD di atas sinyal'],
  ['ema', 'Di atas EMA20', 'Harga penutupan di atas EMA20'],
  ['brk', 'Breakout', 'Penutupan di atas high 3 bar sebelumnya'],
  ['vol', 'Volume naik', 'Volume > 1,2× rata-rata 20 bar (bar berjalan belum final)'],
];
const pct = (a, b) => ((a - b) / b) * 100;

function buildSetup(c, a) {
  const n = c.t.length, last = n - 1;
  if (n < 60 || !a?.series) return null;
  const divs = a.divs.filter((d) => d.kind === 'bull' && d.valid && d.age <= MAX_AGE);
  if (!divs.length) return null;

  const C = c.c[last], H = c.h[last], L = c.l[last];
  const A = atr(c.h, c.l, c.c, 14)[last] || C * 0.02;
  const e20 = ema(c.c, 20)[last];
  const { macd, stoch } = a.series;
  const k = stoch.k, d = stoch.d, h = macd.hist;
  const avgVol = c.v.slice(last - 20, last).reduce((s, v) => s + v, 0) / 20;

  const flags = {
    stoch: k[last] != null && d[last] != null && k[last - 1] != null && k[last] > d[last] && k[last] >= k[last - 1] && k[last] < 85,
    macd: (h[last] != null && h[last - 1] != null && h[last - 2] != null && h[last] > h[last - 1] && h[last - 1] >= h[last - 2]) || (macd.line[last] != null && macd.signal[last] != null && macd.line[last] > macd.signal[last]),
    ema: e20 != null && C > e20,
    brk: C > Math.max(...c.h.slice(last - 3, last)),
    vol: avgVol > 0 && c.v[last] > 1.2 * avgVol,
  };
  const count = Object.values(flags).filter(Boolean).length;

  const pivot = Math.min(...divs.map((x) => x.p2));
  const youngest = Math.min(...divs.map((x) => x.age));
  const inds = [...new Set(divs.map((x) => x.ind))].sort();
  const regular = divs.some((x) => x.mode === 'regular');
  const bounce = pct(C, pivot), bounceATR = (C - pivot) / A;

  let st;
  if (bounceATR > 4.5 || bounce > 15) st = 'ext';
  else if (count >= 3 && bounce >= 0.5) st = 'ready';
  else if (count >= 2) st = 'build';
  else st = 'early';

  // ---- level untuk besok ----
  const trigger = roundTick(H + tick(H), 'up');
  let zl = Math.max(pivot + 0.3 * A, C - 1.0 * A), zh = C - 0.3 * A;
  if (zh <= zl) zh = zl + 0.3 * A;
  zl = roundTick(zl, 'down'); zh = roundTick(zh, 'up');
  let sl = roundTick(pivot - 0.3 * A, 'down');
  if (sl >= zl) sl = roundTick(zl - 0.6 * A, 'down');
  const R = a.sr.resistances.map((x) => x.price);
  const target = (entry) => {
    const risk = entry - sl;
    const t1 = roundTick(R.find((p) => p > entry + risk * 0.9) ?? entry + 1.5 * risk, 'down');
    const t2 = roundTick(R.find((p) => p > t1 * 1.015) ?? entry + 2.5 * risk, 'down');
    return [t1, Math.max(t2, t1 + tick(t1))];
  };
  const [t1, t2] = target(trigger);
  const mid = (zl + zh) / 2;
  const [p1] = target(mid);
  const rrBreak = (t1 - trigger) / Math.max(trigger - sl, 1e-9);
  const rrPull = (p1 - mid) / Math.max(mid - sl, 1e-9);
  const riskPct = pct(trigger, sl);

  const f = (v) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(v));
  const passed = CONF.filter(([key]) => flags[key]).map(([, label]) => label);
  const lowRR = Math.max(rrBreak, rrPull) < 1.2;
  if (st === 'ready' && lowRR) st = 'build'; // konfirmasi cukup tetapi ruang naik ke target terlalu sempit
  let label, sub;
  if (st === 'ready') { label = 'Siap dipantau besok'; sub = `Konfirmasi ${count}/5. Beli bila tembus ${f(trigger)} (disertai volume) atau cicil saat pullback ${f(zl)}–${f(zh)}; stop loss ${f(sl)}.`; }
  else if (st === 'build') { label = 'Mulai terkonfirmasi'; sub = lowRR ? `Konfirmasi ${count}/5 (${passed.join(', ') || '—'}), tetapi R:R hanya ${Math.max(rrBreak, rrPull).toFixed(1)} karena resistance dekat. Tunggu harga lebih dekat ke ${f(zl)} atau breakout yang jelas di atas ${f(trigger)}.` : `Baru ${count}/5 konfirmasi (${passed.join(', ') || '—'}). Masuk kecil hanya bila tembus ${f(trigger)}; tambah saat konfirmasi lain menyusul.`; }
  else if (st === 'ext') { label = 'Sudah naik jauh'; sub = `Harga sudah naik ${bounce.toFixed(1)}% (${bounceATR.toFixed(1)}× ATR) dari pivot ${f(pivot)}. Jangan mengejar; tunggu pullback ke ${f(zl)}–${f(zh)}.`; }
  else { label = 'Masih dini'; sub = `Divergence ada tetapi baru ${count}/5 konfirmasi. Tunggu StochRSI cross up dan penutupan di atas EMA20 sebelum masuk.`; }

  return {
    state: st, label, sub, count, flags, passed, pivot, age: youngest, inds, regular,
    bounce, bounceATR, trigger, pull: [zl, zh], sl, t1, t2, rrBreak, rrPull, riskPct,
    close: C, high: H, low: L, atr: A, ema20: e20,
    conf: CONF.map(([key, name, hint]) => ({ key, name, hint, ok: flags[key] })),
  };
}

module.exports = { buildSetup, MAX_AGE };
