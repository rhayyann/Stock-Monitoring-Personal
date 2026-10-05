// Rencana entry (zona beli, stop loss, target, R:R) dari divergence + S/R + volatilitas,
// lalu digabung dengan valuasi fundamental menjadi satu rekomendasi waktu masuk.
const { ema, atr } = require('./indicators');

// Fraksi harga Bursa Efek Indonesia
function tick(p) { return p < 200 ? 1 : p < 500 ? 2 : p < 2000 ? 5 : p < 5000 ? 10 : 25; }
const roundTick = (p, dir = 'nearest') => { const t = tick(p); const q = p / t; return (dir === 'down' ? Math.floor(q) : dir === 'up' ? Math.ceil(q) : Math.round(q)) * t; };
const pct = (a, b) => ((a - b) / b) * 100;
const fmt = (v) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(v));
const BAR = { '15m': 'bar', '1h': 'bar', '1d': 'hari', '1wk': 'minggu' };

function buildPlan({ c, a, tf, val, hidden = false }) {
  const n = c.t.length;
  const price = c.c[n - 1];
  const A = atr(c.h, c.l, c.c, 14)[n - 1] || price * 0.02;
  const e20 = ema(c.c, 20)[n - 1], e50 = ema(c.c, 50)[n - 1];
  const trend = e20 != null && e50 != null ? (price > e50 && e20 > e50 ? 'up' : price < e50 && e20 < e50 ? 'down' : 'side') : 'side';
  const act = a.divs.filter((d) => d.active && (hidden || d.mode === 'regular'));
  const bull = act.filter((d) => d.kind === 'bull'), bear = act.filter((d) => d.kind === 'bear');
  const bullInd = [...new Set(bull.map((d) => d.ind))], bearInd = [...new Set(bear.map((d) => d.ind))];
  const S = a.sr.supports, R = a.sr.resistances;
  const reasons = [];

  // --- state teknikal ---
  let tech = 'wait';
  if (bear.length && !bull.length) tech = 'avoid';
  else if (bull.length) tech = 'buy';
  const youngest = (arr) => Math.min(...arr.map((d) => d.age));
  if (bull.length) reasons.push({ t: 'good', s: `Bullish divergence ${bullInd.join(' + ')} aktif (${youngest(bull)} ${BAR[tf]} lalu)${bullInd.length > 1 ? ' — terkonfirmasi 2 indikator' : ''}.` });
  if (bear.length) reasons.push({ t: 'bad', s: `Bearish divergence ${bearInd.join(' + ')} aktif (${youngest(bear)} ${BAR[tf]} lalu).` });
  if (!bull.length && !bear.length) reasons.push({ t: 'neutral', s: 'Belum ada divergence aktif pada timeframe ini.' });
  if (a.trig === 'bull') reasons.push({ t: 'good', s: 'StochRSI baru cross up dari area bawah (trigger timing).' });
  if (a.trig === 'bear') reasons.push({ t: 'bad', s: 'StochRSI baru cross down dari area atas.' });
  reasons.push({ t: trend === 'up' ? 'good' : trend === 'down' ? 'bad' : 'neutral', s: trend === 'up' ? 'Tren naik: harga di atas EMA50 dan EMA20 > EMA50.' : trend === 'down' ? 'Tren turun: harga di bawah EMA50 dan EMA20 < EMA50 (sinyal bullish = counter-trend, butuh konfirmasi).' : 'Tren sideways: harga di sekitar EMA50.' });

  // --- level acuan ---
  const s1 = S[0]?.price, r1 = R[0]?.price;
  const pivotLow = bull.length ? Math.min(...bull.map((d) => d.p2)) : null;
  let base = pivotLow ?? (s1 && s1 > price - 6 * A ? s1 : price - 1.5 * A); // dasar stop
  let zoneLow, zoneHigh, mode;
  if (tech === 'buy') {
    zoneHigh = price;
    zoneLow = Math.max(base + 0.25 * A, price - 1.0 * A);
    if (zoneLow >= zoneHigh) zoneLow = zoneHigh - 0.4 * A;
    mode = 'now';
  } else {
    // zona tunggu: area support terdekat
    const ref = s1 && s1 < price ? s1 : price - 1.5 * A;
    zoneLow = ref; zoneHigh = ref + 0.6 * A;
    base = ref;
    mode = 'wait';
  }
  let sl = base - 0.5 * A;
  if (sl >= zoneLow) sl = zoneLow - 0.6 * A;
  const entry = (zoneLow + zoneHigh) / 2;
  const risk = entry - sl;
  let t1 = R.map((x) => x.price).find((p) => p > entry + risk * 0.9) ?? entry + 1.5 * risk;
  let t2 = R.map((x) => x.price).find((p) => p > t1 * 1.015) ?? entry + 2.5 * risk;
  if (t2 <= t1) t2 = t1 + risk;
  zoneLow = roundTick(zoneLow, 'down'); zoneHigh = roundTick(zoneHigh, 'up'); sl = roundTick(sl, 'down'); t1 = roundTick(t1, 'down'); t2 = roundTick(t2, 'down');
  const entryMid = (zoneLow + zoneHigh) / 2;
  const rr1 = (t1 - entryMid) / Math.max(entryMid - sl, 1e-9), rr2 = (t2 - entryMid) / Math.max(entryMid - sl, 1e-9);
  const riskPct = pct(entryMid, sl);
  if (riskPct > 12) reasons.push({ t: 'bad', s: `Stop loss cukup jauh (${riskPct.toFixed(1)}% dari entry) — kecilkan ukuran posisi.` });
  if (s1) reasons.push({ t: 'neutral', s: `Support terdekat S1 ${fmt(s1)} (${pct(s1, price).toFixed(1)}%)${r1 ? `, resistance R1 ${fmt(r1)} (+${pct(r1, price).toFixed(1)}%)` : ''}.` });
  else if (r1) reasons.push({ t: 'neutral', s: `Tidak ada support terdekat; resistance R1 ${fmt(r1)} (+${pct(r1, price).toFixed(1)}%).` });

  // --- gabung valuasi ---
  const vv = val?.available && val.fair ? val.verdict : 'unknown';
  if (vv !== 'unknown') reasons.push({ t: vv === 'cheap' ? 'good' : vv === 'fair' ? 'neutral' : 'bad', s: `Valuasi: harga ${fmt(price)} vs nilai wajar ±${fmt(val.fair)} → ${val.verdictLabel.toLowerCase()} (${val.mos >= 0 ? 'diskon' : 'premi'} ${Math.abs(val.mos * 100).toFixed(0)}%).` });
  else reasons.push({ t: 'neutral', s: 'Valuasi fundamental tidak tersedia / tidak andal untuk emiten ini.' });
  if (val?.quality?.score != null) reasons.push({ t: val.quality.score >= 70 ? 'good' : val.quality.score >= 45 ? 'neutral' : 'bad', s: `Kualitas fundamental ${val.quality.label.toLowerCase()} (${val.quality.score}/100).` });

  let action, level, sub;
  const rrOk = rr1 >= 1.3;
  if (tech === 'avoid') { action = 'HINDARI'; level = 'bad'; sub = 'Ada bearish divergence aktif — risiko koreksi lebih besar daripada peluang.'; }
  else if (tech === 'buy') {
    if (!rrOk) { action = 'TUNGGU PULLBACK'; level = 'neutral'; sub = `Sinyal bullish ada, tetapi R:R ke T1 hanya ${rr1.toFixed(1)} — tunggu harga mendekati ${fmt(zoneLow)}.`; mode = 'wait'; }
    else if (vv === 'rich') { action = 'ENTRY TAKTIKAL'; level = 'neutral'; sub = 'Timing bagus tetapi valuasi mahal — hanya untuk trading jangka pendek, ukuran posisi kecil, disiplin di stop loss.'; }
    else if (vv === 'cheap' || vv === 'fair') { action = a.trig === 'bull' || bullInd.length > 1 ? 'ENTRY SEKARANG' : 'ENTRY BERTAHAP'; level = 'good'; sub = `Timing dan valuasi mendukung — cicil di zona ${fmt(zoneLow)}–${fmt(zoneHigh)}.`; }
    else { action = 'ENTRY BERTAHAP'; level = 'good'; sub = `Timing teknikal mendukung (fundamental belum bisa dinilai) — cicil di zona ${fmt(zoneLow)}–${fmt(zoneHigh)}.`; }
  } else {
    if (vv === 'cheap') { action = 'AKUMULASI BERTAHAP'; level = 'good'; sub = `Valuasi murah, tetapi belum ada konfirmasi teknikal — cicil kecil di area ${fmt(zoneLow)}–${fmt(zoneHigh)}, tambah saat divergence/trigger muncul.`; }
    else { action = 'TUNGGU'; level = 'neutral'; sub = `Belum ada sinyal masuk. Pantau area ${fmt(zoneLow)}–${fmt(zoneHigh)} atau munculnya bullish divergence.`; }
  }
  return {
    action, level, sub, tech, trend, atr: A, ema20: e20, ema50: e50, mode,
    zone: [zoneLow, zoneHigh], stop: sl, t1, t2, rr1, rr2, riskPct,
    zonePct: [pct(zoneLow, price), pct(zoneHigh, price)], stopPct: pct(sl, price), t1Pct: pct(t1, price), t2Pct: pct(t2, price),
    fundamentalBuyBelow: val?.available && val.buyBelow ? roundTick(val.buyBelow, 'down') : null,
    reasons, price, tf,
  };
}

module.exports = { buildPlan, roundTick, tick };
