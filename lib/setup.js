// Setup entry untuk sesi berikutnya. Urutan prioritas:
//  form  : divergence bullish SEDANG terbentuk (low kedua sudah lebih rendah, indikator lebih tinggi, harga belum naik)
//  near  : harga mendekati low sebelumnya dan indikator masih punya ruang (divergence AKAN terbentuk bila low diuji)
//  ready/build/early/ext : divergence sudah terkonfirmasi dan harga mulai/ sudah naik (lihat konfirmasinya)
const { ema, atr } = require('./indicators');
const { roundTick, tick } = require('./plan');

const FORM_MAX_BOUNCE = 0.8; // sama dengan CFG.formMaxBounce di analysis.js: harga belum bounce dari low kedua
const FORM_MAX_AGE = 3;      // pivot terkonfirmasi paling lama N bar lalu masih dihitung "belum naik"
const MAX_AGE = 15; // divergence yang sudah terkonfirmasi dianggap relevan sampai N bar setelah pivot ke-2
const CONF = [
  ['stoch', 'StochRSI naik', 'StochRSI K di atas D dan naik, belum overbought'],
  ['macd', 'MACD naik', 'Histogram MACD naik 2 bar berturut-turut atau garis MACD di atas sinyal'],
  ['ema', 'Di atas EMA20', 'Harga penutupan di atas EMA20'],
  ['brk', 'Breakout', 'Penutupan di atas high 3 bar sebelumnya'],
  ['vol', 'Volume naik', 'Volume > 1,2× rata-rata 20 bar (bar berjalan belum final)'],
];
const pct = (a, b) => ((a - b) / b) * 100;
const f0 = (v) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(v));
const fi = (v) => (Math.abs(v) >= 10 ? f0(v) : v.toFixed(2).replace('.', ','));

function buildSetup(c, a) {
  const n = c.t.length, last = n - 1;
  if (n < 60 || !a?.series) return null;
  const divs = a.divs.filter((d) => d.kind === 'bull' && d.valid && d.age <= MAX_AGE);
  const forming = divs.filter((d) => d.forming);
  const done = divs.filter((d) => !d.forming);
  const near = a.near || [];
  if (!forming.length && !done.length && !near.length) return null;

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
  const passed = CONF.filter(([key]) => flags[key]).map(([, label]) => label);
  const conf = CONF.map(([key, name, hint]) => ({ key, name, hint, ok: flags[key] }));
  const R = a.sr.resistances.map((x) => x.price);

  // target dari kandidat level (neckline / resistance) di atas entry
  const targets = (entry, sl, extra = []) => {
    const risk = entry - sl;
    const lv = [...extra, ...R].sort((x, y) => x - y);
    const t1 = roundTick(lv.find((p) => p > entry + risk * 0.9) ?? entry + 1.5 * risk, 'down');
    const t2 = roundTick(lv.find((p) => p > t1 * 1.015) ?? entry + 2.5 * risk, 'down');
    return [t1, Math.max(t2, t1 + tick(t1))];
  };
  const base = { count, flags, passed, conf, close: C, high: H, low: L, atr: A, ema20: e20 };

  // ============ (1) SEDANG / BARU TERBENTUK (harga belum naik) ============
  const justDone = done.filter((x) => x.mode === 'regular' && x.age <= FORM_MAX_AGE && (C - x.p2) / A <= FORM_MAX_BOUNCE);
  const fl = forming.concat(justDone);
  if (fl.length) {
    const lowJ = Math.min(...fl.map((x) => x.p2));
    const ref = fl.find((x) => x.p2 === lowJ);
    const neck = Math.max(...c.h.slice(ref.i1, ref.i2 + 1)); // swing high di antara dua low
    let zl = roundTick(lowJ + 0.1 * A, 'up');
    let zh = roundTick(Math.min(Math.max(C, zl + 0.3 * A), lowJ + 1.0 * A), 'up');
    if (zh <= zl) zh = zl + tick(zl);
    const sl = roundTick(lowJ - 0.5 * A, 'down');
    const mid = (zl + zh) / 2;
    const [t1, t2] = targets(mid, sl, [neck]);
    const rr = (t1 - mid) / Math.max(mid - sl, 1e-9);
    const inds = [...new Set(fl.map((x) => x.ind))].sort();
    const bounce = pct(C, lowJ);
    return {
      ...base, state: 'form', label: 'Divergence sedang terbentuk',
      sub: `Low kedua ${f0(lowJ)} lebih rendah dari low sebelumnya ${f0(ref.p1)}, tetapi ${inds.join(' + ')} lebih tinggi: bullish divergence sedang terbentuk dan belum terkonfirmasi (harga belum naik). Cicil kecil di ${f0(zl)}–${f0(zh)}; batal bila harga menembus ${f0(sl)}. R:R ${rr.toFixed(1)}. Tambah posisi setelah StochRSI cross up atau penutupan di atas EMA20.`,
      pivot: lowJ, age: Math.min(...fl.map((x) => x.age)), inds, regular: true, bounce, bounceATR: (C - lowJ) / A,
      trigger: null, pull: [zl, zh], sl, t1, t2, rrBreak: rr, rrPull: rr, riskPct: pct(mid, sl),
      fm: { p1: ref.p1, p2: lowJ, neck, confirmed: !ref.forming },
    };
  }

  // ============ (2) divergence yang SUDAH terkonfirmasi ============
  if (done.length) {
    const pivot = Math.min(...done.map((x) => x.p2));
    const youngest = Math.min(...done.map((x) => x.age));
    const inds = [...new Set(done.map((x) => x.ind))].sort();
    const regular = done.some((x) => x.mode === 'regular');
    const bounce = pct(C, pivot), bounceATR = (C - pivot) / A;
    let st;
    if (bounceATR > 4.5 || bounce > 15) st = 'ext';
    else if (count >= 3 && bounce >= 0.5) st = 'ready';
    else if (count >= 2) st = 'build';
    else st = 'early';

    const trigger = roundTick(H + tick(H), 'up');
    let zl = Math.max(pivot + 0.3 * A, C - 1.0 * A), zh = C - 0.3 * A;
    if (zh <= zl) zh = zl + 0.3 * A;
    zl = roundTick(zl, 'down'); zh = roundTick(zh, 'up');
    let sl = roundTick(pivot - 0.3 * A, 'down');
    if (sl >= zl) sl = roundTick(zl - 0.6 * A, 'down');
    const [t1, t2] = targets(trigger, sl);
    const [p1] = targets((zl + zh) / 2, sl);
    const rrBreak = (t1 - trigger) / Math.max(trigger - sl, 1e-9);
    const rrPull = (p1 - (zl + zh) / 2) / Math.max((zl + zh) / 2 - sl, 1e-9);
    const lowRR = Math.max(rrBreak, rrPull) < 1.2;
    if (st === 'ready' && lowRR) st = 'build'; // konfirmasi cukup tetapi ruang naik ke target terlalu sempit
    let label, sub;
    if (st === 'ready') { label = 'Siap dipantau besok'; sub = `Konfirmasi ${count}/5. Beli bila tembus ${f0(trigger)} (disertai volume) atau cicil saat pullback ${f0(zl)}–${f0(zh)}; stop loss ${f0(sl)}.`; }
    else if (st === 'build') { label = 'Mulai terkonfirmasi'; sub = lowRR ? `Konfirmasi ${count}/5 (${passed.join(', ') || '—'}), tetapi R:R hanya ${Math.max(rrBreak, rrPull).toFixed(1)} karena resistance dekat. Tunggu harga lebih dekat ke ${f0(zl)} atau breakout yang jelas di atas ${f0(trigger)}.` : `Baru ${count}/5 konfirmasi (${passed.join(', ') || '—'}). Masuk kecil hanya bila tembus ${f0(trigger)}; tambah saat konfirmasi lain menyusul.`; }
    else if (st === 'ext') { label = 'Sudah naik jauh'; sub = `Harga sudah naik ${bounce.toFixed(1)}% (${bounceATR.toFixed(1)}× ATR) dari pivot ${f0(pivot)}. Jangan mengejar; tunggu pullback ke ${f0(zl)}–${f0(zh)}.`; }
    else { label = 'Masih dini'; sub = `Divergence ada tetapi baru ${count}/5 konfirmasi. Tunggu StochRSI cross up dan penutupan di atas EMA20 sebelum masuk.`; }
    return {
      ...base, state: st, label, sub, pivot, age: youngest, inds, regular, bounce, bounceATR,
      trigger, pull: [zl, zh], sl, t1, t2, rrBreak, rrPull, riskPct: pct(trigger, sl),
    };
  }

  // ============ (3) MENDEKATI low sebelumnya (antisipasi) ============
  const p1 = Math.min(...near.map((x) => x.p1));
  const ref = near.find((x) => x.p1 === p1);
  const inds = [...new Set(near.map((x) => x.ind))].sort();
  const neck = Math.max(...c.h.slice(ref.i1, last + 1));
  const zl = roundTick(p1 - 0.4 * A, 'down'), zh = roundTick(p1 + 0.3 * A, 'up');
  const sl = roundTick(p1 - 1.2 * A, 'down');
  const mid = (zl + zh) / 2;
  const [t1, t2] = targets(mid, sl, [neck]);
  const rr = (t1 - mid) / Math.max(mid - sl, 1e-9);
  const hold = near.map((x) => ({ ind: x.ind, level: x.v1, now: x.vNow }));
  const holdTxt = hold.map((x) => `${x.ind} bertahan di atas ${fi(x.level)} (sekarang ${fi(x.now)})`).join(' dan ');
  return {
    ...base, state: 'near', label: 'Mendekati low sebelumnya',
    sub: `Harga ${f0(C)} hanya ${ref.distAtr.toFixed(1)}× ATR di atas low sebelumnya ${f0(p1)}. Bila harga menguji/menembus ${f0(p1)} sementara ${holdTxt}, bullish divergence terbentuk. Antisipasi: order beli kecil di ${f0(zl)}–${f0(zh)}, stop loss ${f0(sl)} (R:R ${rr.toFixed(1)}); lebih aman tunggu low baru dan StochRSI cross up.`,
    pivot: p1, age: ref.age, inds, regular: true, bounce: pct(C, p1), bounceATR: ref.distAtr,
    trigger: null, pull: [zl, zh], sl, t1, t2, rrBreak: rr, rrPull: rr, riskPct: pct(mid, sl),
    hold, distATR: ref.distAtr, fm: { p1, neck },
  };
}

module.exports = { buildSetup, MAX_AGE };
