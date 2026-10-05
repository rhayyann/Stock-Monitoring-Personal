// Server dashboard monitoring divergence saham IDX. Tanpa dependensi (Node >= 18).
require('./lib/env');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { fetchCandles, NotFound, TF } = require('./lib/yahoo');
const { analyze, perf, CFG } = require('./lib/analysis');
const universe = require('./lib/universe');
const { fetchFundamentals } = require('./lib/fundamentals');
const { valuate } = require('./lib/valuation');
const { buildPlan } = require('./lib/plan');
const ai = require('./lib/ai');

const PORT = +process.env.PORT || 3000;
const CONCURRENCY = +process.env.CONCURRENCY || 10;
const SERVERLESS = !!process.env.VERCEL;   // Vercel: tidak ada proses background & filesystem hanya-baca
const DATA_DIR = SERVERLESS ? path.join(require('os').tmpdir(), 'idx-data') : path.join(__dirname, 'data');
const SCAN_BUDGET = +process.env.SCAN_BUDGET_MS || 8000; // serverless: waktu maksimal scan per request
const PUBLIC = path.join(__dirname, 'public');

const codes = universe.load();
const store = {};     // store[tf] = Map(code -> {at, name, c, a, last})
const scans = {};     // scans[tf] = {running, done, total, finishedAt}
const wanted = {};    // tf -> timestamp permintaan terakhir dari UI
const invalid = new Map(); // code -> timestamp (404)
for (const tf of Object.keys(TF)) { store[tf] = new Map(); scans[tf] = { running: false, done: 0, total: 0, finishedAt: 0 }; }

// ---------- jam bursa ----------
const wib = (ms = Date.now()) => new Date(ms + 7 * 3600e3);
function marketOpen(ms = Date.now()) {
  const d = wib(ms);
  const dow = d.getUTCDay();
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return dow >= 1 && dow <= 5 && m >= 9 * 60 && m < 16 * 60;
}
function lastCloseTs(ms = Date.now()) {
  // 16:15 WIB hari bursa terakhir (sudah lewat)
  let d = wib(ms);
  for (let i = 0; i < 8; i++) {
    const dow = d.getUTCDay();
    const close = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16, 15) - 7 * 3600e3;
    if (dow >= 1 && dow <= 5 && close <= ms) return close;
    d = new Date(d.getTime() - 86400e3);
  }
  return 0;
}
const TTL = { '15m': 5, '1h': 10, '1d': 5, '1wk': 30 }; // menit, saat bursa buka
function isFresh(entry, tf, now = Date.now()) {
  if (!entry) return false;
  if (marketOpen(now)) return now - entry.at < TTL[tf] * 60e3;
  return entry.at >= lastCloseTs(now);
}

// ---------- ringkasan ----------
function summarize(tf, name, c, a) {
  const n = c.t.length;
  const price = c.c[n - 1];
  let prev = n > 1 ? c.c[n - 2] : price;
  if (tf === '15m' || tf === '1h') { // bandingkan dengan close hari bursa sebelumnya
    const day = Math.floor(c.t[n - 1] / 86400);
    for (let i = n - 2; i >= 0; i--) if (Math.floor(c.t[i] / 86400) < day) { prev = c.c[i]; break; }
  }
  const k = Math.min(20, n);
  let val = 0;
  for (let i = n - k; i < n; i++) val += c.c[i] * c.v[i];
  const avgVal = (val / k) * TF[tf].perDay;
  const sup = a?.sr.supports[0], res = a?.sr.resistances[0];
  return {
    price, chg: price - prev, chgPct: prev ? ((price - prev) / prev) * 100 : 0,
    vol: c.v[n - 1], avgVal,
    sup: sup?.price ?? null, res: res?.price ?? null,
    t: c.t[n - 1],
  };
}

function ingest(tf, code, name, c) {
  const a = c.t.length >= 60 ? analyze(c) : null;
  const last = summarize(tf, name, c, a);
  if (a) delete a.series; // seri indikator dihitung ulang saat detail diminta
  const entry = { at: Date.now(), name, c, a, last };
  store[tf].set(code, entry);
  return entry;
}

// ---------- scan ----------
async function refreshOne(tf, code) {
  try {
    const { name, c } = await fetchCandles(code, tf);
    if (!c.t.length) throw new NotFound(code);
    return ingest(tf, code, name, c);
  } catch (e) {
    if (e instanceof NotFound) invalid.set(code, Date.now());
    return null;
  }
}

async function scan(tf, budgetMs = Infinity) {
  const s = scans[tf];
  if (s.running) return s.promise;
  s.promise = scanRun(tf, budgetMs).finally(() => { s.promise = null; });
  return s.promise;
}
async function scanRun(tf, budgetMs) {
  const s = scans[tf];
  const todo = codes.filter((code) => {
    const inv = invalid.get(code);
    if (inv && Date.now() - inv < 7 * 86400e3) return false;
    return !isFresh(store[tf].get(code), tf);
  });
  if (!todo.length) { s.pending = 0; return; }
  s.running = true; s.done = 0; s.total = todo.length; s.pending = todo.length;
  const t0 = Date.now(), deadline = t0 + budgetMs;
  let idx = 0, sinceSave = 0;
  const worker = async () => {
    while (idx < todo.length && Date.now() < deadline) {
      const code = todo[idx++];
      await refreshOne(tf, code);
      s.done++;
      if (++sinceSave >= 80) { sinceSave = 0; persist(tf); }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  s.running = false; s.finishedAt = Date.now(); s.pending = todo.length - idx;
  persist(tf); persistInvalid();
  console.log(`[scan ${tf}] ${todo.length} emiten dalam ${((Date.now() - t0) / 1000).toFixed(1)} dtk`);
  if (tf === '1d' && !SERVERLESS) scanFundamentals().catch((e) => console.error(e));
}

// ---------- fundamental ----------
const FUND_TTL = 24 * 3600e3;
const fund = {};           // code -> data fundamental ternormalisasi
const fundScan = { running: false, done: 0, total: 0 };
const fundFile = path.join(DATA_DIR, 'fundamentals.json');
const fundFresh = (f) => f && Date.now() - f.at < FUND_TTL;

async function getFund(code) {
  if (fundFresh(fund[code])) return fund[code];
  try { fund[code] = await fetchFundamentals(code); } catch (e) { if (!fund[code]) return null; }
  return fund[code];
}
async function scanFundamentals(budgetMs = Infinity) {
  if (fundScan.running) return;
  const todo = [...store['1d'].keys()].filter((c) => !fundFresh(fund[c]));
  if (!todo.length) return;
  const deadline = Date.now() + budgetMs;
  fundScan.running = true; fundScan.done = 0; fundScan.total = todo.length;
  let idx = 0;
  const worker = async () => {
    while (idx < todo.length && Date.now() < deadline) {
      const code = todo[idx++];
      try { fund[code] = await fetchFundamentals(code); } catch {}
      fundScan.done++;
    }
  };
  await Promise.all(Array.from({ length: SERVERLESS ? 6 : 4 }, worker));
  fundScan.running = false;
  try { fs.writeFileSync(fundFile, JSON.stringify(fund)); } catch {}
  console.log(`[fundamental] ${todo.length} emiten diperbarui`);
}
function loadFund() {
  try { Object.assign(fund, JSON.parse(fs.readFileSync(fundFile, 'utf8'))); console.log(`[cache fundamental] ${Object.keys(fund).length} emiten`); } catch {}
}

// ---------- cache disk ----------
const cacheFile = (tf) => path.join(DATA_DIR, `cache-${tf}.json`);
function persist(tf) {
  try {
    const obj = {};
    for (const [code, e] of store[tf]) obj[code] = { at: e.at, name: e.name, c: e.c };
    fs.writeFileSync(cacheFile(tf) + '.tmp', JSON.stringify(obj));
    fs.renameSync(cacheFile(tf) + '.tmp', cacheFile(tf));
  } catch (e) { console.error('persist gagal', e.message); }
}
function persistInvalid() {
  try { fs.writeFileSync(path.join(DATA_DIR, 'invalid.json'), JSON.stringify([...invalid])); } catch {}
}
function loadCache() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  try { for (const [k, v] of JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'invalid.json'), 'utf8'))) invalid.set(k, v); } catch {}
  for (const tf of Object.keys(TF)) {
    try {
      const obj = JSON.parse(fs.readFileSync(cacheFile(tf), 'utf8'));
      for (const [code, e] of Object.entries(obj)) {
        const a = e.c.t.length >= 60 ? analyze(e.c) : null;
        const last = summarize(tf, e.name, e.c, a);
        if (a) delete a.series;
        store[tf].set(code, { at: e.at, name: e.name, c: e.c, a, last });
      }
      console.log(`[cache ${tf}] ${store[tf].size} emiten dimuat`);
    } catch {}
  }
}

function ensure(tf) {
  wanted[tf] = Date.now();
  if (SERVERLESS) return; // di serverless scan dijalankan di dalam request (advance)
  const s = scans[tf];
  if (!s.running && Date.now() - s.finishedAt > 20e3) scan(tf).catch((e) => console.error(e));
}

if (!SERVERLESS) {
  setInterval(() => {
    for (const tf of Object.keys(TF)) if (wanted[tf] && Date.now() - wanted[tf] < 30 * 60e3) ensure(tf);
  }, 60e3);
}

// Serverless: kerjakan sebagian scan di dalam request, sisanya di request polling berikutnya
async function advance(tf) {
  const t0 = Date.now();
  const left = () => Math.max(0, SCAN_BUDGET - (Date.now() - t0));
  await Promise.race([scan(tf, SCAN_BUDGET), new Promise((r) => setTimeout(r, SCAN_BUDGET + 2000))]);
  if (tf === '1d' && left() > 1500 && !scans['1d'].pending) await scanFundamentals(left());
}

// ---------- API ----------
function activeDivs(a) {
  if (!a) return [];
  return a.divs.filter((d) => d.active).map((d) => ({ k: d.kind, m: d.mode, i: d.ind, age: d.age }));
}

function compactSetup(su) {
  if (!su) return null;
  return { st: su.state, n: su.count, f: su.flags, b: su.bounce, ba: su.bounceATR, age: su.age, trg: su.trigger, z: su.pull, sl: su.sl, t1: su.t1, rb: su.rrBreak, rp: su.rrPull, rk: su.riskPct, pv: su.pivot, ind: su.inds };
}
function quickVal(code, price) {
  const f = fund[code];
  if (!f || f.none) return null;
  const v = valuate(f, price, fund);
  return v.available && v.fair ? { v: v.verdict, r: +v.ratio.toFixed(2), q: v.quality.label } : null;
}

function screenerPayload(tf) {
  const rows = [];
  let at = 0;
  for (const [code, e] of store[tf]) {
    if (!e.a) continue;
    at = Math.max(at, e.at);
    const l = e.last;
    rows.push({
      code, name: e.name, price: l.price, chg: l.chg, chgPct: l.chgPct, vol: l.vol, avgVal: l.avgVal,
      sup: l.sup, res: l.res, divs: activeDivs(e.a), trig: e.a.trig,
      setup: compactSetup(e.a.setup), fv: e.a.setup ? quickVal(code, l.price) : null,
    });
  }
  const s = scans[tf];
  const pending = s.pending || 0;
  const scanInfo = SERVERLESS ? { running: pending > 0, done: Math.max(0, (s.total || 0) - pending), total: s.total || 0 } : { running: s.running, done: s.done, total: s.total };
  return { tf, asOf: at, marketOpen: marketOpen(), scan: scanInfo, total: codes.length, rows };
}

async function stockPayload(code, tf) {
  let e = store[tf].get(code);
  if (!isFresh(e, tf)) {
    const f = await refreshOne(tf, code);
    if (f) e = f;
    else if (!e) return null;
  }
  const a = analyze(e.c);
  if (!a) return { code, tf, name: e.name, tooShort: true };
  const n = e.c.t.length;
  const first = Math.max(0, n - CFG.lookbackBars);
  return {
    code, tf, name: e.name, at: e.at, marketOpen: marketOpen(),
    candles: e.c, macd: a.series.macd, stoch: a.series.stoch,
    divs: a.divs.filter((d) => d.i2 >= first), sr: a.sr, perf: (tf === '1d' || tf === '1wk' || !store['1d'].get(code)) ? a.perf : perf(store['1d'].get(code).c), trig: a.trig, last: e.last,
    macdSource: CFG.macdSource,
  };
}

async function buildAnalysis(code, tf) {
  let e = store[tf].get(code);
  if (!isFresh(e, tf)) { const f = await refreshOne(tf, code); if (f) e = f; else if (!e) return null; }
  const a = analyze(e.c);
  if (!a) return { code, tf, tooShort: true };
  const f = await getFund(code);
  const price = e.c.c[e.c.t.length - 1];
  const val = valuate(f, price, fund);
  const plan = buildPlan({ c: e.c, a, tf, val });
  const act = a.divs.filter((d) => d.active).map((d) => ({ jenis: d.kind === 'bull' ? 'bullish' : 'bearish', tipe: d.mode, indikator: d.ind, umur_bar: d.age, harga_pivot: [d.p1, d.p2] }));
  return {
    code, tf, name: e.name, price, at: e.at, fundAt: f?.at || null, fundScan: { ...fundScan },
    profile: f && !f.none ? { sector: f.sector, industry: f.industry, summary: f.summary, currency: f.currency } : null,
    val, plan, setup: a.setup, ai: { configured: ai.configured(), model: ai.MODEL },
    _tech: { active: act, trig: a.trig, sr: a.sr, perf: a.perf },
  };
}

function aiPayload(an) {
  const v = an.val, p = an.plan;
  const round = (x) => (typeof x === 'number' ? +x.toFixed(Math.abs(x) < 10 ? 3 : 0) : x);
  return {
    emiten: { kode: an.code, nama: an.name, sektor: an.profile?.sector, industri: an.profile?.industry, harga_sekarang: an.price, timeframe: an.tf },
    valuasi: v.available ? {
      nilai_wajar: round(v.fair), rentang: [round(v.low), round(v.high)], harga_vs_wajar_rasio: round(v.ratio), verdict: v.verdictLabel, keyakinan: v.confidence,
      harga_beli_dengan_margin_of_safety_15persen: round(v.buyBelow),
      metode: v.methods.map((m) => ({ nama: m.name, nilai: round(m.value), dipakai: !m.dropped, rumus: m.how })),
      kualitas: { skor: v.quality.score, label: v.quality.label, lolos: v.quality.items.filter((i) => i.pass).map((i) => i.label), gagal: v.quality.items.filter((i) => !i.pass).map((i) => i.label) },
      metrik: Object.fromEntries(v.metrics.map((m) => [m.label, { nilai: round(m.value), median_sektor: round(m.ref) }])),
      konsensus_analis: v.target, catatan: v.notes, asumsi: v.assumptions, peer_sektor: v.sector.n,
    } : { tersedia: false, alasan: v.reason },
    teknikal: { tren: p.trend, ema20: round(p.ema20), ema50: round(p.ema50), atr: round(p.atr), divergence_aktif: an._tech.active, trigger_stochrsi: an._tech.trig, support: an._tech.sr.supports.map((x) => ({ harga: round(x.price), sentuhan: x.touches })), resistance: an._tech.sr.resistances.map((x) => ({ harga: round(x.price), sentuhan: x.touches })), performa_persen: Object.fromEntries(Object.entries(an._tech.perf).map(([k, x]) => [k, x == null ? null : +x.toFixed(1)])) },
    besok: an.setup ? { status: an.setup.label, konfirmasi_terpenuhi: an.setup.passed, jumlah_konfirmasi_dari_5: an.setup.count, naik_dari_pivot_persen: +an.setup.bounce.toFixed(1), naik_dalam_kelipatan_ATR: +an.setup.bounceATR.toFixed(1), umur_divergence_bar: an.setup.age, indikator_divergence: an.setup.inds, pivot_low: an.setup.pivot, pemicu_breakout: an.setup.trigger, zona_pullback: an.setup.pull, stop_loss: an.setup.sl, target1: an.setup.t1, target2: an.setup.t2, rr_breakout: +an.setup.rrBreak.toFixed(1), rr_pullback: +an.setup.rrPull.toFixed(1), catatan: 'bar terakhir bisa belum final bila bursa sedang buka' } : null,
    plan: { action: p.action, alasan_singkat: p.sub, zona_beli: p.zone, stop_loss: p.stop, target1: p.t1, target2: p.t2, rr_t1: round(p.rr1), rr_t2: round(p.rr2), risiko_persen: round(p.riskPct), faktor: p.reasons.map((r) => r.s) },
  };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function sendJson(req, res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(status, headers);
    res.end(zlib.gzipSync(body, { level: 4 }));
  } else {
    res.writeHead(status, headers);
    res.end(body);
  }
}

const handler = async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname);
    if (SERVERLESS && u.searchParams.has('__p')) p = '/api/' + u.searchParams.get('__p'); // rewrite Vercel membawa path asli di query
    if (p === '/api/screener') {
      const tf = TF[u.searchParams.get('tf')] ? u.searchParams.get('tf') : '1d';
      if (SERVERLESS) await advance(tf); else ensure(tf);
      return sendJson(req, res, 200, screenerPayload(tf));
    }
    if (p.startsWith('/api/analysis/') || p.startsWith('/api/ai/')) {
      const isAi = p.startsWith('/api/ai/');
      const code = p.slice(isAi ? 8 : 14).toUpperCase().replace(/\.JK$/, '');
      const tf = TF[u.searchParams.get('tf')] ? u.searchParams.get('tf') : '1d';
      if (!/^[A-Z0-9]{2,6}$/.test(code)) return sendJson(req, res, 400, { error: 'kode tidak valid' });
      const an = await buildAnalysis(code, tf);
      if (!an) return sendJson(req, res, 404, { error: `Data ${code} tidak ditemukan` });
      if (an.tooShort) return sendJson(req, res, 422, { error: 'Data terlalu pendek untuk analisis' });
      if (!isAi) { delete an._tech; return sendJson(req, res, 200, an); }
      try {
        const key = [code, tf, Math.round(an.price), an.plan.action, Math.floor(Date.now() / 3600e3)].join('|');
        const out = await ai.narrate(key, aiPayload(an), u.searchParams.get('refresh') === '1');
        return sendJson(req, res, 200, { ok: true, ...out });
      } catch (e) {
        return sendJson(req, res, 200, { ok: false, code: e.code || 'error', error: e.message });
      }
    }
    if (p.startsWith('/api/stock/')) {
      const code = p.slice(11).toUpperCase().replace(/\.JK$/, '');
      const tf = TF[u.searchParams.get('tf')] ? u.searchParams.get('tf') : '1d';
      if (!/^[A-Z0-9]{2,6}$/.test(code)) return sendJson(req, res, 400, { error: 'kode tidak valid' });
      wanted[tf] = Date.now();
      const out = await stockPayload(code, tf);
      return out ? sendJson(req, res, 200, out) : sendJson(req, res, 404, { error: `Data ${code} tidak ditemukan` });
    }
    // static
    let f = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
    if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    console.error(e);
    sendJson(req, res, 500, { error: e.message });
  }
};

loadCache();
loadFund();
if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    console.log(`Dashboard IDX: http://localhost:${PORT}  (${codes.length} emiten di universe)`);
    ensure('1d');
    setTimeout(() => scanFundamentals().catch((e) => console.error(e)), 8000);
  });
}
module.exports = handler;
