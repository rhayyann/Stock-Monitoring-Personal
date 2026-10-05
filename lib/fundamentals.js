// Data fundamental dari Yahoo Finance (quoteSummary) + normalisasi untuk emiten IDX.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MODULES = 'summaryDetail,defaultKeyStatistics,financialData,assetProfile,incomeStatementHistory,earningsTrend';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- cookie + crumb ----------
let session = null; // {cookie, crumb, at}
let sessionPromise = null;
async function getSession(force) {
  if (!force && session && Date.now() - session.at < 50 * 60e3) return session;
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const r = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(12000) });
    const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    const res = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie }, signal: AbortSignal.timeout(12000) });
    const crumb = (await res.text()).trim();
    if (!res.ok || !crumb || crumb.includes('<')) throw new Error('crumb gagal');
    session = { cookie, crumb, at: Date.now() };
    return session;
  })();
  try { return await sessionPromise; } finally { sessionPromise = null; }
}

const raw = (o) => (o && typeof o === 'object' && 'raw' in o ? o.raw : typeof o === 'number' ? o : null);
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

async function fetchRaw(code, attempt = 0) {
  const s = await getSession(attempt > 0);
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${code}.JK?modules=${MODULES}&crumb=${encodeURIComponent(s.crumb)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: s.cookie }, signal: AbortSignal.timeout(15000) });
  if (res.status === 404) return null;
  if ((res.status === 401 || res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(700 * (attempt + 1)); return fetchRaw(code, attempt + 1); }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  return j?.quoteSummary?.result?.[0] || null;
}

// ---------- normalisasi ----------
function normalize(code, r) {
  const sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, fd = r.financialData || {}, ap = r.assetProfile || {};
  const cur = fd.financialCurrency || 'IDR';
  const foreign = cur !== 'IDR';
  const price = num(raw(fd.currentPrice)) ?? num(raw(sd.fulldayPrice)) ?? num(raw(sd.previousClose));
  const eps = num(raw(ks.trailingEps));
  const feps = num(raw(ks.forwardEps));
  const roe = num(raw(fd.returnOnEquity));
  // Laporan non-IDR membuat bookValue/PBV Yahoo tidak sebanding dengan harga IDR -> turunkan dari EPS / ROE
  let bvps = num(raw(ks.bookValue));
  if (foreign || !bvps || bvps <= 0) bvps = eps && roe && eps > 0 && roe > 0 ? eps / roe : foreign ? null : bvps;
  const pbv = price && bvps && bvps > 0 ? price / bvps : null;
  const industry = ap.industry || '';
  const sector = ap.sector || 'Lainnya';
  const isBank = /bank/i.test(industry);
  const isFinancial = /financial/i.test(sector);
  const ni = (r.incomeStatementHistory?.incomeStatementHistory || []).map((x) => ({ y: x.endDate?.fmt?.slice(0, 4), ni: raw(x.netIncome), rev: raw(x.totalRevenue) })).filter((x) => x.ni != null).reverse(); // lama -> baru
  let niCagr = null;
  if (ni.length >= 3 && ni[0].ni > 0 && ni[ni.length - 1].ni > 0) niCagr = Math.pow(ni[ni.length - 1].ni / ni[0].ni, 1 / (ni.length - 1)) - 1;
  const trend = r.earningsTrend?.trend || [];
  const fwdG = num(raw(trend.find((t) => t.period === '+1y')?.growth));
  const der = num(raw(fd.debtToEquity));
  return {
    code, at: Date.now(), sector, industry, isBank, isFinancial, foreign, currency: cur,
    summary: (ap.longBusinessSummary || '').slice(0, 320),
    price, mcap: num(raw(sd.marketCap)),
    pe: num(raw(sd.trailingPE)), fpe: num(raw(sd.forwardPE)), pbv, eps, feps, bvps,
    roe, roa: num(raw(fd.returnOnAssets)), npm: num(raw(fd.profitMargins)), opm: num(raw(fd.operatingMargins)), gpm: num(raw(fd.grossMargins)),
    der: der != null ? der / 100 : null, curRatio: num(raw(fd.currentRatio)),
    revG: num(raw(fd.revenueGrowth)), earnG: num(raw(fd.earningsGrowth)), fwdG, niCagr, niHist: ni.map((x) => ({ y: x.y, ni: x.ni })),
    fcfPositive: num(raw(fd.freeCashflow)) == null ? null : raw(fd.freeCashflow) > 0,
    divYield: num(raw(sd.dividendYield)), divRate: foreign ? null : num(raw(sd.dividendRate)), payout: num(raw(sd.payoutRatio)),
    beta: num(raw(sd.beta)), hi52: num(raw(sd.fiftyTwoWeekHigh)), lo52: num(raw(sd.fiftyTwoWeekLow)),
    target: { mean: num(raw(fd.targetMeanPrice)), high: num(raw(fd.targetHighPrice)), low: num(raw(fd.targetLowPrice)), n: num(raw(fd.numberOfAnalystOpinions)) || 0, rec: fd.recommendationKey && fd.recommendationKey !== 'none' ? fd.recommendationKey : null },
  };
}

async function fetchFundamentals(code) {
  const r = await fetchRaw(code);
  if (!r) return { code, at: Date.now(), none: true };
  return normalize(code, r);
}

module.exports = { fetchFundamentals };
