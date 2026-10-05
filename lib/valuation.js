// Estimasi nilai wajar berbasis fundamental (multi-metode, asumsi transparan).
const COE = +process.env.COST_OF_EQUITY || 0.12;      // biaya ekuitas (imbal hasil SBN ~6,5-7% + premi risiko ~5-5,5%)
const G = +process.env.LONG_TERM_GROWTH || 0.05;      // pertumbuhan jangka panjang (nominal, konservatif)
const DEFAULT_PER = { bank: 12, fin: 11, other: 11 };
const DEFAULT_PBV = { bank: 1.8, fin: 1.2, other: 1.2 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const groupKey = (f) => (f.isBank ? 'bank' : f.isFinancial ? 'fin' : f.sector);

// Median PER/PBV peers dalam sektor yang sama (butuh >= 5 emiten)
function sectorStats(all, f) {
  const key = groupKey(f);
  const peers = Object.values(all).filter((x) => x && !x.none && x.code !== f.code && groupKey(x) === key);
  const pes = peers.map((x) => x.pe).filter((v) => v > 2 && v < 50);
  const pbvs = peers.map((x) => x.pbv).filter((v) => v > 0.1 && v < 12);
  const roes = peers.map((x) => x.roe).filter((v) => v != null && v > -0.5 && v < 1);
  const kind = f.isBank ? 'bank' : f.isFinancial ? 'fin' : 'other';
  return {
    key, n: peers.length,
    per: pes.length >= 5 ? median(pes) : null, pbv: pbvs.length >= 5 ? median(pbvs) : null, roe: roes.length >= 5 ? median(roes) : null,
    perDefault: DEFAULT_PER[kind], pbvDefault: DEFAULT_PBV[kind],
  };
}

function valuate(f, price, all) {
  if (!f || f.none) return { available: false, reason: 'Data fundamental emiten ini tidak tersedia di Yahoo Finance.' };
  const ss = sectorStats(all || {}, f);
  const methods = [];
  const notes = [];
  const lossMaking = f.eps != null && f.eps <= 0;
  if (lossMaking) notes.push('Emiten sedang rugi (EPS negatif): metode berbasis laba tidak berlaku, valuasi kurang andal.');
  if (f.foreign) notes.push(`Laporan keuangan dalam ${f.currency}: nilai buku per saham diturunkan dari EPS/ROE.`);

  // 1) Justified P/B dari ROE: PBV = (ROE - g) / (COE - g)
  if (f.bvps > 0 && f.roe != null && f.roe > 0) {
    const roe = clamp(f.roe, 0.02, 0.35);
    const pbvJ = clamp((roe - G) / (COE - G), 0.3, 4);
    methods.push({ id: 'jpbv', name: 'P/B wajar dari ROE', value: f.bvps * pbvJ, weight: f.isFinancial ? 3 : 2, how: `BVPS ${Math.round(f.bvps)} × PBV wajar ${pbvJ.toFixed(2)} (ROE ${(roe * 100).toFixed(1)}%, COE ${(COE * 100).toFixed(0)}%, g ${(G * 100).toFixed(0)}%)` });
  }
  // 2) P/E wajar sektor (disesuaikan pertumbuhan)
  if (f.eps > 0) {
    let eps = f.eps;
    if (f.feps > 0 && f.feps > f.eps * 0.5 && f.feps < f.eps * 2) eps = (f.eps + f.feps) / 2;
    const g = f.fwdG ?? f.niCagr ?? 0.05;
    const base = ss.per ?? ss.perDefault;
    const adj = clamp(1 + (clamp(g, -0.3, 0.4) - 0.05) * 1.2, 0.75, 1.3);
    const qrel = ss.roe && f.roe > 0 ? clamp(Math.sqrt(f.roe / ss.roe), 0.85, 1.3) : 1; // premi/diskon kualitas (ROE vs sektor)
    const per = clamp(base * adj * qrel, 6, 22);
    methods.push({ id: 'per', name: 'P/E wajar sektor', value: eps * per, weight: 2, how: `EPS ${eps.toFixed(0)} × PER wajar ${per.toFixed(1)} (${ss.per ? `median sektor ${ss.per.toFixed(1)}` : `default ${base}`}, growth ×${adj.toFixed(2)}, kualitas ×${qrel.toFixed(2)})` });
  }
  // 3) P/B median sektor, disesuaikan ROE relatif
  if (f.bvps > 0 && ss.pbv) {
    const rel = ss.roe && f.roe != null ? clamp(f.roe / ss.roe, 0.6, 1.5) : 1;
    methods.push({ id: 'spbv', name: 'P/B median sektor', value: f.bvps * ss.pbv * rel, weight: 1, how: `BVPS ${Math.round(f.bvps)} × PBV sektor ${ss.pbv.toFixed(2)} × kualitas relatif ${rel.toFixed(2)}` });
  }
  // 4) Graham number
  if (f.eps > 0 && f.bvps > 0) {
    methods.push({ id: 'graham', name: 'Graham number', value: Math.sqrt(22.5 * f.eps * f.bvps), weight: f.isFinancial ? 0.5 : 1, how: `√(22,5 × EPS ${f.eps.toFixed(0)} × BVPS ${Math.round(f.bvps)})` });
  }
  // 5) Dividen (Gordon growth), hanya bila dividen berkelanjutan
  if (f.divRate > 0 && f.payout != null && f.payout > 0.1 && f.payout <= 0.9 && !lossMaking) {
    const g = Math.min(G, 0.04);
    methods.push({ id: 'ddm', name: 'Diskonto dividen', value: (f.divRate * (1 + g)) / (COE - g), weight: f.divYield > 0.03 ? 1 : 0.5, how: `DPS ${f.divRate.toFixed(0)} × (1+${(g * 100).toFixed(0)}%) / (COE − g)` });
  }

  // buang outlier ekstrem relatif terhadap median
  const med = median(methods.map((m) => m.value));
  const used = methods.filter((m) => m.value > 0 && med && m.value < med * 2.5 && m.value > med / 2.5);
  const dropped = methods.filter((m) => !used.includes(m));
  for (const d of dropped) d.dropped = true;

  const quality = qualityCheck(f);
  const metrics = buildMetrics(f, ss);
  const target = f.target?.mean ? { mean: f.target.mean, high: f.target.high, low: f.target.low, n: f.target.n, rec: f.target.rec, upside: price ? f.target.mean / price - 1 : null } : null;

  if (!used.length) {
    return { available: true, fair: null, verdict: 'na', verdictLabel: 'Tidak dapat dinilai', methods, quality, metrics, sector: ss, target, notes: [...notes, 'Data tidak cukup untuk menghitung nilai wajar.'], confidence: 'low', assumptions: { coe: COE, g: G } };
  }
  const wsum = used.reduce((a, m) => a + m.weight, 0);
  const fair = used.reduce((a, m) => a + m.value * m.weight, 0) / wsum;
  const vals = used.map((m) => m.value);
  const low = Math.max(Math.min(...vals), fair * 0.7), high = Math.min(Math.max(...vals), fair * 1.3);
  const ratio = price / fair;
  let verdict, label;
  if (ratio <= 0.75) { verdict = 'cheap'; label = 'Murah (undervalued)'; }
  else if (ratio <= 0.95) { verdict = 'cheap'; label = 'Agak murah'; }
  else if (ratio <= 1.1) { verdict = 'fair'; label = 'Wajar'; }
  else if (ratio <= 1.3) { verdict = 'rich'; label = 'Agak mahal'; }
  else { verdict = 'rich'; label = 'Mahal (overvalued)'; }
  const spread = (Math.max(...vals) - Math.min(...vals)) / fair;
  let confidence = used.length >= 4 && spread < 0.5 ? 'high' : used.length >= 3 && spread < 0.9 ? 'medium' : 'low';
  if (lossMaking || ss.n < 5 && used.length < 3) confidence = 'low';
  if (spread >= 0.9) notes.push('Hasil antar-metode sangat tersebar, anggap nilai wajar sebagai perkiraan kasar.');
  return {
    available: true, fair, low, high, ratio, upside: fair / price - 1, mos: 1 - ratio, verdict, verdictLabel: label, confidence,
    buyBelow: fair * 0.85, methods, quality, metrics, sector: ss, target, notes, assumptions: { coe: COE, g: G },
  };
}

function qualityCheck(f) {
  const items = [];
  const add = (id, label, pass, value) => { if (pass != null) items.push({ id, label, pass, value }); };
  add('eps', 'Laba positif', f.eps != null ? f.eps > 0 : null);
  add('roe', 'ROE ≥ 12%', f.roe != null ? f.roe >= 0.12 : null, f.roe);
  if (!f.isFinancial) {
    add('npm', 'Margin bersih ≥ 5%', f.npm != null ? f.npm >= 0.05 : null, f.npm);
    add('der', 'DER ≤ 1,5×', f.der != null ? f.der <= 1.5 : null, f.der);
    add('cr', 'Current ratio ≥ 1,2', f.curRatio != null ? f.curRatio >= 1.2 : null, f.curRatio);
    add('fcf', 'Arus kas bebas positif', f.fcfPositive);
  } else add('npm', 'Margin bersih ≥ 20%', f.npm != null ? f.npm >= 0.2 : null, f.npm);
  add('grow', 'Laba tumbuh (CAGR 3 th)', f.niCagr != null ? f.niCagr > 0 : null, f.niCagr);
  add('div', 'Membayar dividen', f.divYield != null ? f.divYield > 0 : null, f.divYield);
  const score = items.length ? Math.round((items.filter((i) => i.pass).length / items.length) * 100) : null;
  return { score, label: score == null ? 'n/a' : score >= 70 ? 'Kuat' : score >= 45 ? 'Cukup' : 'Lemah', items };
}

function buildMetrics(f, ss) {
  const m = [];
  const push = (k, label, value, fmt, ref) => m.push({ k, label, value, fmt, ref });
  push('pe', 'PER', f.pe > 0 ? f.pe : null, 'x', ss.per);
  push('pbv', 'PBV', f.pbv, 'x', ss.pbv);
  push('roe', 'ROE', f.roe, '%', ss.roe);
  push('npm', 'Margin bersih', f.npm, '%');
  if (!f.isFinancial) push('der', 'DER', f.der, 'x'); else push('dy', 'Div. yield', f.divYield, '%');
  push('growth', 'Laba CAGR 3th', f.niCagr, '%');
  push('revg', 'Growth pendapatan', f.revG, '%');
  if (!f.isFinancial) push('dy', 'Div. yield', f.divYield, '%'); else push('eps', 'EPS', f.eps, 'idr');
  return m;
}

module.exports = { valuate, sectorStats };
