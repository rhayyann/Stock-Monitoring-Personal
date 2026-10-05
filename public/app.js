/* IDX Monitor – frontend */
const LW = window.LightweightCharts;
const $ = (s, r = document) => r.querySelector(s);

// ---------- tema ----------
const COL = {};
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  for (const [k, v] of Object.entries({ up: '--up', dn: '--dn', sup: '--sup', res: '--res', bg: '--chart-bg', grid: '--grid', cross: '--cross', mut: '--mut', line: '--line', tx: '--tx' })) COL[k] = cs.getPropertyValue(v).trim();
}
readPalette();

// ---------- util ----------
const nf0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fPrice = (v) => (v == null ? '—' : Math.abs(v) >= 200 ? nf0.format(Math.round(v)) : nf2.format(v));
const fPct = (v, d = 2) => (v == null ? '—' : (v > 0 ? '+' : '') + (d === 1 ? nf1 : nf2).format(v) + '%');
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'dn' : 'mut');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const intraday = (tf) => tf === '15m' || tf === '1h';
function fDate(t, tf) { // t = detik yang sudah digeser ke WIB -> baca sebagai UTC
  const d = new Date(t * 1000);
  const s = `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
  return intraday(tf) ? `${s} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` : `${s} '${String(d.getUTCFullYear()).slice(2)}`;
}
const TF_LABEL = { '15m': '15 menit', '1h': '1 jam', '1d': 'Harian', '1wk': 'Mingguan' };
const BAR_LABEL = { '15m': 'bar', '1h': 'bar', '1d': 'hari', '1wk': 'minggu' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const shortName = (n) => String(n || '').replace(/^PT\.?\s*/i, '').replace(/\s*Tbk\.?$/i, '');

const CATS = [
  { id: 'all', label: 'Semua', min: 0, max: Infinity },
  { id: 'c1', label: '< 500', min: 0, max: 500 },
  { id: 'c2', label: '500 – 1.000', min: 500, max: 1000 },
  { id: 'c3', label: '1.000 – 1.500', min: 1000, max: 1500 },
  { id: 'c4', label: '1.500 – 2.000', min: 1500, max: 2000 },
  { id: 'c5', label: '2.000 – 3.000', min: 2000, max: 3000 },
  { id: 'c6', label: '> 3.000', min: 3000, max: Infinity },
];
const RANGES = {
  '15m': [['1D', 1], ['3D', 3], ['1W', 7], ['ALL', 0]],
  '1h': [['1W', 7], ['2W', 14], ['1M', 30], ['ALL', 0]],
  '1d': [['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365], ['ALL', 0]],
  '1wk': [['6M', 182], ['1Y', 365], ['3Y', 1095], ['ALL', 0]],
};
const DEF_RANGE = { '15m': '3D', '1h': '1M', '1d': '6M', '1wk': '3Y' };

// ---------- state ----------
const state = {
  tf: '1d', code: 'BBCA', cat: 'all', sig: 'all', ind: 'all', hidden: '0', liq: '100000000', only: true, rtab: 'an',
  sort: { key: 'score', dir: -1 }, range: { ...DEF_RANGE }, showDiv: true, showSR: true, type: 'candle', mode: 'all', st: 'ok',
  ov: {
    ma1: { on: false, type: 'EMA', n: 20 }, ma2: { on: false, type: 'EMA', n: 50 }, ma3: { on: false, type: 'SMA', n: 200 },
    bb: { on: false, n: 20, k: 2 }, vwap: { on: false }, st: { on: false, n: 10, k: 3 }, psar: { on: false }, ich: { on: false },
    vol: { on: true }, macd: { on: true }, stoch: { on: true }, rsi: { on: false, n: 14 },
  },
};
try { Object.assign(state, JSON.parse(localStorage.getItem('idxdiv2') || '{}')); } catch {}
if (!RANGES[state.tf]) state.tf = '1d';
state.range = { ...DEF_RANGE, ...state.range };
{ const def = { ...state.ov }; try { const sv = JSON.parse(localStorage.getItem('idxdiv2') || '{}').ov || {}; for (const k of Object.keys(def)) def[k] = { ...def[k], ...(sv[k] || {}) }; } catch {} state.ov = def; }
if (!['candle', 'line', 'area'].includes(state.type)) state.type = 'candle';
Object.assign(state, { data: null, view: [], stock: null, analysis: null, anError: '', ai: {}, aiLoading: false });
const save = () => { try { const { tf, code, cat, sig, ind, hidden, liq, only, rtab, sort, range, showDiv, showSR, type, ov, mode, st } = state; localStorage.setItem('idxdiv2', JSON.stringify({ tf, code, cat, sig, ind, hidden, liq, only, rtab, sort, range, showDiv, showSR, type, ov, mode, st })); } catch {} };

// ---------- chart ----------
const chartEl = $('#chart');
const wrapEl = $('.chart-wrap');
const themeLayout = () => ({ background: { type: 'solid', color: COL.bg }, textColor: COL.mut, fontSize: 11, panes: { separatorColor: COL.line, separatorHoverColor: COL.cross } });
const themeCross = () => ({ vertLine: { color: COL.cross, labelBackgroundColor: COL.cross }, horzLine: { color: COL.cross, labelBackgroundColor: COL.cross } });
const chart = LW.createChart(chartEl, {
  autoSize: true,
  layout: themeLayout(),
  grid: { vertLines: { color: COL.grid }, horzLines: { color: COL.grid } },
  rightPriceScale: { borderColor: COL.line, scaleMargins: { top: 0.08, bottom: 0.08 } },
  timeScale: { borderColor: COL.line, rightOffset: 6, timeVisible: false, secondsVisible: false },
  crosshair: { mode: LW.CrosshairMode.Normal, ...themeCross() },
  localization: { priceFormatter: (p) => (Math.abs(p) >= 200 ? nf0.format(p) : p.toFixed(2)) },
});
const S = {};                 // S.main (candle/line/area), S.vol
let dyn = [], priceLines = [], markersApi = null, cur = null;
let oscPanes = [], overlayLegend = [], legendEls = [];
const candleColors = () => ({ upColor: COL.up, downColor: COL.dn, borderUpColor: COL.up, borderDownColor: COL.dn, wickUpColor: COL.up, wickDownColor: COL.dn });
const MA_COL = { ma1: '#f5a623', ma2: '#4da3ff', ma3: '#b57cff' };

S.vol = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false }, 0);
chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });

function ensureMain() {
  if (S.main && S.mainType === state.type) return;
  if (S.main) { try { markersApi.detach(); } catch {} chart.removeSeries(S.main); }
  S.mainType = state.type;
  const pl = { priceLineColor: COL.cross, priceLineStyle: LW.LineStyle.Dotted };
  if (state.type === 'line') S.main = chart.addSeries(LW.LineSeries, { color: COL.tx, lineWidth: 2, ...pl }, 0);
  else if (state.type === 'area') S.main = chart.addSeries(LW.AreaSeries, { lineColor: COL.sup, topColor: rgba(COL.sup, 0.32), bottomColor: rgba(COL.sup, 0), lineWidth: 2, ...pl }, 0);
  else S.main = chart.addSeries(LW.CandlestickSeries, { ...candleColors(), ...pl }, 0);
  markersApi = LW.createSeriesMarkers(S.main, []);
}

const priceH = () => chart.panes()[0]?.getHeight() || 0;
function layoutPanes() {
  const panes = chart.panes();
  const H = chartEl.clientHeight - 26;
  if (H < 200) return;
  const nOsc = panes.length - 1;
  if (nOsc > 0) {
    const per = Math.round((H * Math.min(0.5, nOsc * 0.2)) / nOsc);
    for (let i = 1; i < panes.length; i++) panes[i].setHeight(per);
    panes[0].setHeight(H - per * nOsc);
  }
  let top = 4;
  panes.forEach((p, i) => { const el = legendEls[i]; if (el) el.style.top = top + 'px'; top += p.getHeight() + 1; });
}
new ResizeObserver(layoutPanes).observe(chartEl);

function buildLegends() {
  const box = $('#lgs');
  box.innerHTML = '';
  legendEls = [];
  for (let i = 0; i <= oscPanes.length; i++) { const el = document.createElement('div'); el.className = 'legend'; box.appendChild(el); legendEls.push(el); }
}
function legendText(i) {
  if (!cur || !legendEls.length) return;
  const c = cur.candles, idx = i < 0 ? c.t.length - 1 : i;
  const ch = idx > 0 ? ((c.c[idx] - c.c[idx - 1]) / c.c[idx - 1]) * 100 : 0;
  const ovs = overlayLegend.map((o) => `<span style="color:${o.color}">${o.label} <b>${o.arr[idx] == null ? '—' : fPrice(o.arr[idx])}</b></span>`).join('');
  legendEls[0].innerHTML = `<span>O <b>${fPrice(c.o[idx])}</b></span><span>H <b>${fPrice(c.h[idx])}</b></span><span>L <b>${fPrice(c.l[idx])}</b></span><span>C <b class="${cls(ch)}">${fPrice(c.c[idx])}</b></span><span class="${cls(ch)}">${fPct(ch)}</span><span>Vol <b>${nf0.format(c.v[idx])}</b></span>${ovs}`;
  oscPanes.forEach((p, k) => { if (legendEls[k + 1]) legendEls[k + 1].innerHTML = p.html(idx); });
}
chart.subscribeCrosshairMove((p) => { if (!cur) return; if (!p.time) return legendText(-1); const i = cur.timeIdx.get(p.time); legendText(i == null ? -1 : i); });

function clearDyn() {
  for (const l of priceLines) { try { S.main.removePriceLine(l); } catch {} }
  priceLines = [];
  for (const s of dyn) chart.removeSeries(s);
  dyn = [];
}
const visDivs = (d) => (d?.divs || []).filter((v) => state.hidden === '1' || v.mode === 'regular');
const add = (type, opt, pane = 0) => { const s = chart.addSeries(type, opt, pane); dyn.push(s); return s; };
const lineOpt = (color, extra = {}) => ({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });

function futureTimes(c, tf, k) {
  const out = [];
  if (tf !== '1d' && tf !== '1wk') return out;
  let t = c.t[c.t.length - 1];
  while (out.length < k) {
    t += tf === '1wk' ? 7 * 86400 : 86400;
    const dow = new Date(t * 1000).getUTCDay();
    if (tf === '1d' && (dow === 0 || dow === 6)) continue;
    out.push(t);
  }
  return out;
}

function buildOverlays(d) {
  const c = d.candles, n = c.t.length, ov = state.ov;
  const pts = (arr, T = c.t, off = 0) => { const out = []; for (let i = 0; i < n; i++) { const j = i + off; if (arr[i] != null && j >= 0 && j < T.length) out.push({ time: T[j], value: arr[i] }); } return out; };
  const line = (arr, color, w = 1, extra = {}) => { const s = add(LW.LineSeries, lineOpt(color, { lineWidth: w, ...extra })); s.setData(pts(arr)); return s; };
  for (const k of ['ma1', 'ma2', 'ma3']) {
    if (!ov[k].on) continue;
    const arr = (ov[k].type === 'EMA' ? IND.ema : IND.sma)(c.c, ov[k].n);
    line(arr, MA_COL[k]); overlayLegend.push({ label: `${ov[k].type} ${ov[k].n}`, color: MA_COL[k], arr });
  }
  if (ov.bb.on) {
    const b = IND.bollinger(c.c, ov.bb.n, ov.bb.k);
    line(b.up, rgba('#4da3ff', 0.85)); line(b.lo, rgba('#4da3ff', 0.85)); line(b.mid, rgba('#ff8f1f', 0.8));
    overlayLegend.push({ label: `BB ${ov.bb.n},${ov.bb.k}`, color: '#4da3ff', arr: b.mid });
  }
  if (ov.vwap.on && intraday(d.tf)) {
    const arr = IND.vwap(c.t, c.h, c.l, c.c, c.v);
    line(arr, '#e04dff', 1.5); overlayLegend.push({ label: 'VWAP', color: '#e04dff', arr });
  }
  if (ov.st.on) {
    const s = IND.supertrend(c.h, c.l, c.c, ov.st.n, ov.st.k);
    const data = [];
    for (let i = 0; i < n; i++) {
      if (s.line[i] == null) continue;
      if (i > 0 && s.dir[i - 1] != null && s.dir[i - 1] !== s.dir[i]) data.push({ time: c.t[i] }); // putus saat balik arah
      else data.push({ time: c.t[i], value: s.line[i], color: s.dir[i] === 1 ? COL.up : COL.dn });
    }
    add(LW.LineSeries, lineOpt(COL.up, { lineWidth: 2 })).setData(data);
    overlayLegend.push({ label: `Supertrend ${ov.st.n},${ov.st.k}`, color: COL.up, arr: s.line });
  }
  if (ov.psar.on) {
    const s = IND.psar(c.h, c.l);
    const data = []; for (let i = 1; i < n; i++) if (s.sar[i] != null) data.push({ time: c.t[i], value: s.sar[i], color: s.dir[i] === 1 ? COL.up : COL.dn });
    add(LW.LineSeries, lineOpt(COL.up, { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2 })).setData(data);
    overlayLegend.push({ label: 'PSAR', color: COL.mut, arr: s.sar });
  }
  if (ov.ich.on) {
    const I = IND.ichimoku(c.h, c.l), T = c.t.concat(futureTimes(c, d.tf, 26));
    line(I.tenkan, '#2962ff'); line(I.kijun, '#ff5252');
    add(LW.LineSeries, lineOpt(rgba(COL.up, 0.65))).setData(pts(I.spanA, T, 26));
    add(LW.LineSeries, lineOpt(rgba(COL.dn, 0.65))).setData(pts(I.spanB, T, 26));
    const chik = []; for (let i = 26; i < n; i++) chik.push({ time: c.t[i - 26], value: c.c[i] });
    add(LW.LineSeries, lineOpt(rgba('#9e9e9e', 0.8))).setData(chik);
    overlayLegend.push({ label: 'Ichimoku', color: '#2962ff', arr: I.tenkan });
  }
}

const f2 = (v, d = 2) => (v == null ? '—' : v.toFixed(d));
function buildOscillators(d) {
  const c = d.candles, n = c.t.length, ov = state.ov;
  const series = (arr) => { const out = []; for (let i = 0; i < n; i++) if (arr[i] != null) out.push({ time: c.t[i], value: arr[i] }); return out; };
  const fixed01 = { priceFormat: { type: 'custom', formatter: (v) => v.toFixed(0) }, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) };
  const oscIdx = {};
  let pane = 1;
  if (ov.macd.on) {
    const p = pane++; oscIdx.MACD = p;
    const h = add(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, p);
    h.setData(d.macd.hist.map((v, i) => { if (v == null) return null; const pv = d.macd.hist[i - 1] ?? 0; return { time: c.t[i], value: v, color: rgba(v >= 0 ? COL.up : COL.dn, (v >= 0 ? v >= pv : v <= pv) ? 0.85 : 0.38) }; }).filter(Boolean));
    add(LW.LineSeries, lineOpt('#5aa9ff'), p).setData(series(d.macd.line));
    add(LW.LineSeries, lineOpt('#ffb020'), p).setData(series(d.macd.signal));
    const m = d.macd;
    oscPanes.push({ html: (i) => `<span>MACD (12,26,9) <b>${f2(m.line[i])}</b> sinyal <b>${f2(m.signal[i])}</b> hist <b class="${cls(m.hist[i])}">${f2(m.hist[i])}</b></span>` });
  }
  if (ov.stoch.on) {
    const p = pane++; oscIdx.StochRSI = p;
    const k = add(LW.LineSeries, lineOpt('#5aa9ff', fixed01), p), dd = add(LW.LineSeries, lineOpt('#ffb020', fixed01), p);
    k.setData(series(d.stoch.k)); dd.setData(series(d.stoch.d));
    for (const lv of [80, 50, 20]) k.createPriceLine({ price: lv, color: COL.line, lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: false });
    const st = d.stoch;
    oscPanes.push({ html: (i) => `<span>StochRSI (14,14,3,3) K <b>${f2(st.k[i], 1)}</b> D <b>${f2(st.d[i], 1)}</b></span>` });
  }
  if (ov.rsi.on) {
    const p = pane++;
    const arr = IND.rsi(c.c, ov.rsi.n);
    const s = add(LW.LineSeries, lineOpt('#b57cff', { ...fixed01, lineWidth: 1.5 }), p);
    s.setData(series(arr));
    for (const lv of [70, 50, 30]) s.createPriceLine({ price: lv, color: COL.line, lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: false });
    oscPanes.push({ html: (i) => `<span>RSI (${ov.rsi.n}) <b>${f2(arr[i], 1)}</b></span>` });
  }
  return oscIdx;
}

function renderChart(d, keepRange) {
  const c = d.candles;
  const prevRange = keepRange ? chart.timeScale().getVisibleLogicalRange() : null;
  clearDyn(); ensureMain();
  chart.timeScale().applyOptions({ timeVisible: intraday(d.tf) });
  S.main.setData(state.type === 'candle' ? c.t.map((t, i) => ({ time: t, open: c.o[i], high: c.h[i], low: c.l[i], close: c.c[i] })) : c.t.map((t, i) => ({ time: t, value: c.c[i] })));
  S.vol.setData(state.ov.vol.on ? c.t.map((t, i) => ({ time: t, value: c.v[i], color: rgba(c.c[i] >= c.o[i] ? COL.up : COL.dn, 0.25) })) : []);
  cur = { ...d, timeIdx: new Map(c.t.map((t, i) => [t, i])) };
  overlayLegend = []; oscPanes = [];
  buildOverlays(d);
  const oscIdx = buildOscillators(d);

  const mk = [];
  if (state.showDiv) {
    const divs = visDivs(d).filter((v) => oscIdx[v.ind] != null);
    for (const v of divs) {
      const base = v.kind === 'bull' ? COL.up : COL.dn;
      const opt = { color: v.active ? base : rgba(base, 0.4), lineWidth: v.active ? 2 : 1, lineStyle: v.mode === 'hidden' ? LW.LineStyle.Dashed : LW.LineStyle.Solid, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
      add(LW.LineSeries, opt, 0).setData([{ time: v.t1, value: v.p1 }, { time: v.t2, value: v.p2 }]);
      add(LW.LineSeries, opt, oscIdx[v.ind]).setData([{ time: v.u1, value: v.v1 }, { time: v.u2, value: v.v2 }]);
    }
    const groups = new Map();
    for (const v of divs) {
      const key = v.t2 + v.kind;
      const g = groups.get(key) || { t: v.t2, kind: v.kind, tags: new Set(), active: false };
      g.tags.add(v.ind); g.active ||= v.active;
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const bull = g.kind === 'bull', base = bull ? COL.up : COL.dn;
      mk.push({ time: g.t, position: bull ? 'belowBar' : 'aboveBar', shape: bull ? 'arrowUp' : 'arrowDown', color: g.active ? base : rgba(base, 0.45), text: [...g.tags].sort().join(' + ') });
    }
    mk.sort((a, b) => a.time - b.time);
  }
  markersApi.setMarkers(mk);

  if (state.showSR) {
    d.sr.supports.forEach((l, i) => priceLines.push(S.main.createPriceLine({ price: l.price, color: rgba(COL.sup, 0.85), lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title: `S${i + 1}` })));
    d.sr.resistances.forEach((l, i) => priceLines.push(S.main.createPriceLine({ price: l.price, color: rgba(COL.res, 0.85), lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title: `R${i + 1}` })));
    const p = state.analysis?.plan;
    if (p && state.analysis.code === d.code && state.analysis.tf === d.tf) { // level rencana entry
      priceLines.push(S.main.createPriceLine({ price: p.stop, color: rgba(COL.dn, 0.9), lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: true, title: 'SL' }));
      priceLines.push(S.main.createPriceLine({ price: p.zone[0], color: rgba(COL.up, 0.9), lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: true, title: p.mode === 'now' ? 'Buy' : 'Tunggu' }));
      priceLines.push(S.main.createPriceLine({ price: p.zone[1], color: rgba(COL.up, 0.9), lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: false, title: '' }));
    }
  }
  buildLegends();
  layoutPanes();
  if (prevRange) chart.timeScale().setVisibleLogicalRange(prevRange); else applyRange();
  legendText(-1);
  drawings.markDirty();
}

function applyRange() {
  const d = state.stock;
  if (!d?.candles) return;
  const c = d.candles, n = c.t.length;
  const days = (RANGES[state.tf].find((r) => r[0] === state.range[state.tf]) || [0, 0])[1];
  let from = 0;
  if (days) { const target = c.t[n - 1] - days * 86400; while (from < n - 1 && c.t[from] < target) from++; }
  chart.timeScale().setVisibleLogicalRange({ from: from - 0.5, to: n - 1 + 6 });
}
function renderRangeBar() {
  $('#rangeBar').innerHTML = '<div class="rg">' + RANGES[state.tf].map(([k]) => `<button data-r="${k}" class="${state.range[state.tf] === k ? 'on' : ''}">${k}</button>`).join('') + '</div>';
}
$('#rangeBar').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.range[state.tf] = b.dataset.r; save(); renderRangeBar(); applyRange(); });

// ---------- tipe chart & panel indikator ----------
const rerender = () => { if (state.stock) renderChart(state.stock, true); };
function syncType() { document.querySelectorAll('#typeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.ty === state.type)); }
$('#typeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.dataset.ty === state.type) return; state.type = b.dataset.ty; save(); syncType(); rerender(); });

function renderIndPanel() {
  const ov = state.ov;
  const num = (k, f, min, max, step = 1) => `<input type="number" data-k="${k}" data-f="${f}" min="${min}" max="${max}" step="${step}" value="${ov[k][f]}">`;
  const row = (k, label, color, params = '', note = '', disabled = false) =>
    `<div class="ind-row ${disabled ? 'off' : ''}"><label class="nm"><input type="checkbox" data-k="${k}" ${ov[k].on ? 'checked' : ''} ${disabled ? 'disabled' : ''}><i class="sw" style="background:${color}"></i>${label}${note ? ` <small>${note}</small>` : ''}</label><span class="prm">${params}</span></div>`;
  const ma = (k, label) => row(k, label, MA_COL[k], `<select data-k="${k}" data-f="type"><option ${ov[k].type === 'EMA' ? 'selected' : ''}>EMA</option><option ${ov[k].type === 'SMA' ? 'selected' : ''}>SMA</option></select>${num(k, 'n', 2, 400)}`);
  $('#indPanel').innerHTML = `<h5>Overlay di chart harga</h5>
    ${ma('ma1', 'Moving average 1')}${ma('ma2', 'Moving average 2')}${ma('ma3', 'Moving average 3')}
    ${row('bb', 'Bollinger Bands', '#4da3ff', `${num('bb', 'n', 2, 200)}×${num('bb', 'k', 0.5, 5, 0.5)}`)}
    ${row('st', 'Supertrend', COL.up, `${num('st', 'n', 2, 100)}×${num('st', 'k', 0.5, 10, 0.5)}`)}
    ${row('psar', 'Parabolic SAR', COL.mut)}
    ${row('ich', 'Ichimoku (garis)', '#2962ff', '', '9·26·52')}
    ${row('vwap', 'VWAP', '#e04dff', '', intraday(state.tf) ? 'reset harian' : 'hanya 15m / 1H', !intraday(state.tf))}
    <h5>Panel indikator</h5>
    ${row('vol', 'Volume', COL.mut)}${row('macd', 'MACD', '#5aa9ff', '', '12·26·9')}${row('stoch', 'Stochastic RSI', '#ffb020', '', '14·14·3·3')}
    ${row('rsi', 'RSI', '#b57cff', num('rsi', 'n', 2, 100))}
    <div class="ind-row"><small>Garis divergence MACD / StochRSI hanya digambar bila panelnya aktif.</small></div>`;
}
const indPanel = $('#indPanel');
$('#indBtn').addEventListener('click', () => { indPanel.hidden = !indPanel.hidden; if (!indPanel.hidden) renderIndPanel(); $('#indBtn').classList.toggle('on', !indPanel.hidden); });
document.addEventListener('mousedown', (e) => { if (!indPanel.hidden && !indPanel.contains(e.target) && !$('#indBtn').contains(e.target)) { indPanel.hidden = true; $('#indBtn').classList.remove('on'); } });
indPanel.addEventListener('change', (e) => {
  const el = e.target, k = el.dataset.k;
  if (!k || !state.ov[k]) return;
  if (el.type === 'checkbox') state.ov[k].on = el.checked;
  else if (el.dataset.f === 'type') state.ov[k].type = el.value;
  else { const v = parseFloat(el.value); if (!isFinite(v)) return; state.ov[k][el.dataset.f] = Math.min(+el.max, Math.max(+el.min, v)); el.value = state.ov[k][el.dataset.f]; }
  save(); rerender();
});

// ---------- alat gambar ----------
const dDel = $('#dDel'), dColor = $('#dColor');
const drawings = createDrawings({
  wrap: wrapEl, chart, getMain: () => S.main, getCandles: () => cur?.candles, getPriceH: priceH, fmt: fPrice,
  onTool: (t) => document.querySelectorAll('#dtools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)),
  onSelect: (d) => { dDel.disabled = !d; if (d) dColor.value = d.color; },
});
$('#dtools').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.tool) drawings.setTool(b.dataset.tool === drawings.getTool() ? 'cursor' : b.dataset.tool);
  else if (b.id === 'dDel') drawings.deleteSelected();
  else if (b.id === 'dClear' && drawings.count() && confirm('Hapus semua garis yang Anda gambar di emiten ini?')) drawings.clearAll();
});
dColor.addEventListener('input', () => drawings.setColor(dColor.value));

// ---------- tema: toggle ----------
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('idxtheme', t); } catch {}
  readPalette();
  chart.applyOptions({ layout: themeLayout(), grid: { vertLines: { color: COL.grid }, horzLines: { color: COL.grid } }, rightPriceScale: { borderColor: COL.line }, timeScale: { borderColor: COL.line }, crosshair: themeCross() });
  S.mainType = null; // bangun ulang series utama dengan warna tema baru
  if (state.stock) renderChart(state.stock, true);
}
$('#themeBtn').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));

// ---------- screener ----------
function derive(r) {
  const ds = r.divs.filter((d) => state.hidden === '1' || d.m === 'regular');
  const pick = (k, i) => ds.filter((d) => d.k === k && d.i === i).sort((a, b) => a.age - b.age)[0] || null;
  const inds = state.ind === 'MACD' ? ['MACD'] : state.ind === 'StochRSI' ? ['StochRSI'] : ['MACD', 'StochRSI'];
  const side = (k) => {
    const m = pick(k, 'MACD'), s = pick(k, 'StochRSI');
    let hits = inds.filter((i) => (i === 'MACD' ? m : s));
    if (state.ind === 'both' && hits.length < 2) hits = [];
    return { hits, get: (i) => (i === 'MACD' ? m : s) };
  };
  const bull = side('bull'), bear = side('bear');
  const supPct = r.sup ? ((r.sup - r.price) / r.price) * 100 : null;
  const resPct = r.res ? ((r.res - r.price) / r.price) * 100 : null;
  const pts = (sd, trigKind, lvlPct) => {
    if (!sd.hits.length) return 0;
    let p = 0;
    for (const i of sd.hits) { const d = sd.get(i); p += (d.m === 'regular' ? 1 : 0.6) + (1 - d.age / 12) * 0.3; }
    if (r.trig === trigKind) p += 0.5;
    if (lvlPct != null && Math.abs(lvlPct) <= 3) p += 0.3;
    return p;
  };
  const bs = pts(bull, 'bull', supPct), es = pts(bear, 'bear', resPct);
  let sig = 'none', score = 0;
  if (bs && es) { sig = 'mixed'; score = Math.max(bs, es) * 0.5; } else if (bs) { sig = 'bull'; score = bs; } else if (es) { sig = 'bear'; score = es; }
  return { ...r, supPct, resPct, bull, bear, sig, score };
}

const SETUP_ST = { ready: 'Siap', build: 'Mulai terkonfirmasi', early: 'Dini', ext: 'Sudah naik jauh' };
const ST_SETS = { ok: ['ready', 'build'], ready: ['ready'], early: ['early'], ext: ['ext'], all: ['ready', 'build', 'early', 'ext'] };
function setupScore(r) {
  const su = r.setup, rr = Math.max(su.rb, su.rp);
  return { ready: 30, build: 18, early: 6, ext: 0 }[su.st] + su.n * 4 + Math.max(0, Math.min(3, rr)) * 2 + (r.fv ? { cheap: 4, fair: 1, rich: -3 }[r.fv.v] || 0 : 0);
}
function computeView() {
  if (!state.data) { state.view = []; return { cats: {} }; }
  const besok = state.mode === 'besok';
  let rows;
  if (besok) {
    const okSet = ST_SETS[state.st] || ST_SETS.ok;
    rows = state.data.rows.filter((r) => r.setup && r.avgVal >= +state.liq && okSet.includes(r.setup.st)).map((r) => ({ ...r, sscore: setupScore(r) }));
  } else {
    rows = state.data.rows.filter((r) => r.avgVal >= +state.liq).map(derive);
    if (state.sig !== 'all') rows = rows.filter((r) => (state.sig === 'bull' ? r.bull.hits.length : r.bear.hits.length));
    if (state.only) rows = rows.filter((r) => r.sig !== 'none');
  }
  const cats = {};
  for (const c of CATS) cats[c.id] = rows.filter((r) => r.price >= c.min && r.price < c.max).length;
  const cat = CATS.find((c) => c.id === state.cat) || CATS[0];
  const view = rows.filter((r) => r.price >= cat.min && r.price < cat.max);
  const { key, dir } = state.sort;
  const val = (r) => (besok ? ({ bounce: r.setup.b, n: r.setup.n, rr: Math.max(r.setup.rb, r.setup.rp) }[key] ?? r[key]) : r[key]);
  view.sort((a, b) => {
    const x = val(a) ?? -Infinity, y = val(b) ?? -Infinity;
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return c * dir || (besok ? b.sscore - a.sscore : b.score - a.score) || b.avgVal - a.avgVal;
  });
  state.view = view;
  return { cats };
}

function divCell(r) {
  if (r.sig === 'none') return '<span class="mut">—</span>';
  const one = (sd, kind) => {
    const letters = [...sd.hits].sort().join(' + ');
    const ds = sd.hits.map((h) => sd.get(h));
    const age = Math.min(...ds.map((d) => d.age));
    const type = ds.some((d) => d.m === 'regular') ? 'Regular' : 'Hidden';
    return `<div class="dvcell"><span class="chip ${kind}" title="${sd.hits.join(' + ')}">${kind === 'bull' ? '▲ Bullish' : '▼ Bearish'} ${letters}${r.trig === kind ? ' ⚡' : ''}</span><small>${type} · ${age} ${BAR_LABEL[state.tf]} lalu</small></div>`;
  };
  return (r.bull.hits.length ? one(r.bull, 'bull') : '') + (r.bear.hits.length ? one(r.bear, 'bear') : '');
}
const THEAD = {
  all: '<th data-k="code" class="l">Emiten</th><th data-k="price">Harga</th><th data-k="chgPct">Chg</th><th data-k="score" class="l">Divergence</th><th data-k="supPct">Support</th><th data-k="resPct">Resist</th>',
  besok: '<th data-k="code" class="l">Emiten</th><th data-k="price">Harga</th><th data-k="n" class="l">Konfirmasi</th><th data-k="sscore" class="l">Status</th><th class="l">Beli besok</th><th>Stop loss</th><th data-k="rr">Target 1 · R:R</th><th class="l">Valuasi</th>',
};
const CF = [['stoch', 'StochRSI↑'], ['macd', 'MACD↑'], ['ema', '>EMA20'], ['brk', 'Breakout'], ['vol', 'Volume↑']];
const VAL_TXT = { cheap: 'Murah', fair: 'Wajar', rich: 'Mahal' };
function setupRow(r) {
  const su = r.setup, rr = Math.max(su.rb, su.rp);
  const buy = su.st === 'ready' || su.st === 'build'
    ? `<b>Tembus ${fPrice(su.trg)}</b><small class="sub">atau pullback ${fPrice(su.z[0])}–${fPrice(su.z[1])}</small>`
    : su.st === 'ext' ? `<span class="mut">Tunggu pullback</span><small class="sub">${fPrice(su.z[0])}–${fPrice(su.z[1])}</small>`
      : '<span class="mut">Tunggu konfirmasi</span>';
  return `<tr data-code="${r.code}" class="${r.code === state.code ? 'sel' : ''}">
    <td class="l"><div class="sym"><b>${r.code}</b><span>${esc(shortName(r.name))}</span></div></td>
    <td>${fPrice(r.price)}<small class="sub ${cls(r.chgPct)}">${fPct(r.chgPct)}</small></td>
    <td class="l"><div class="cfs">${CF.map(([k, l]) => `<span class="cf ${su.f[k] ? 'on' : ''}">${l}</span>`).join('')}</div></td>
    <td class="l"><span class="badge st-${su.st}">${SETUP_ST[su.st]}</span><small class="sub">${su.n}/5 · <span class="${su.b >= 0 ? 'up' : 'dn'}">${fPct(su.b, 1)}</span> dari pivot · ${su.age} ${BAR_LABEL[state.tf]} lalu</small></td>
    <td class="l">${buy}</td>
    <td class="dn">${fPrice(su.sl)}<small class="sub">${fPct(((su.sl - r.price) / r.price) * 100, 1)}</small></td>
    <td>${fPrice(su.t1)}<small class="sub">R:R ${nf1.format(rr)}</small></td>
    <td class="l">${r.fv ? `<span class="badge ${r.fv.v}">${VAL_TXT[r.fv.v]}</span><small class="sub">kualitas ${esc(r.fv.q.toLowerCase())}</small>` : '<span class="mut">—</span>'}</td></tr>`;
}
function renderScreener() {
  const { cats } = computeView();
  const besok = state.mode === 'besok';
  $('#catTabs').innerHTML = CATS.map((c) => `<button data-c="${c.id}" class="${state.cat === c.id ? 'on' : ''}">${c.label}<em>${cats[c.id] ?? 0}</em></button>`).join('');
  const rows = state.view, total = state.data ? state.data.rows.length : 0;
  $('#scCount').textContent = state.data ? `${rows.length} ${besok ? 'setup' : 'ditampilkan'} dari ${total} emiten` : '';
  $('#tbl thead tr').innerHTML = THEAD[besok ? 'besok' : 'all'];
  document.querySelectorAll('#tbl th').forEach((th) => { th.classList.toggle('sorted', th.dataset.k === state.sort.key); th.dataset.dir = state.sort.dir > 0 ? '↑' : '↓'; });
  $('#modeSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === state.mode));
  $('#stSeg').hidden = !besok; $('#sigSeg').hidden = besok;
  $('#stSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.st === state.st));
  $('#sigSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.s === state.sig));
  const empty = $('#tblEmpty');
  if (!rows.length) {
    const sc = state.data?.scan;
    empty.hidden = false;
    empty.textContent = !state.data ? 'Memuat data…' : sc?.running && !total ? `Mengambil data bursa… ${sc.done}/${sc.total}`
      : besok ? 'Belum ada setup bullish divergence dengan status ini. Coba pilih status "Semua" atau longgarkan filter likuiditas.'
        : state.only ? 'Tidak ada divergence aktif dengan filter ini. Longgarkan filter atau matikan "Hanya yang ada divergence".' : 'Tidak ada data.';
  } else empty.hidden = true;
  if (besok) { $('#tbody').innerHTML = rows.map(setupRow).join(''); return; }
  const lv = (p, pc) => (p ? `<span class="lvl">${fPrice(p)}<small>${pc > 0 ? '+' : ''}${nf1.format(pc)}%</small></span>` : '<span class="mut">—</span>');
  $('#tbody').innerHTML = rows.map((r) => `<tr data-code="${r.code}" class="${r.code === state.code ? 'sel' : ''}">
      <td class="l"><div class="sym"><b>${r.code}</b><span>${esc(shortName(r.name))}</span></div></td>
      <td>${fPrice(r.price)}</td><td class="${cls(r.chgPct)}">${fPct(r.chgPct)}</td>
      <td class="l">${divCell(r)}</td><td>${lv(r.sup, r.supPct)}</td><td>${lv(r.res, r.resPct)}</td></tr>`).join('');
}

function renderHead() {
  const d = state.stock;
  $('#chSym').textContent = state.code;
  $('#chName').textContent = shortName(d?.name);
  if (!d?.last) { $('#chPrice').textContent = ''; $('#chChg').textContent = ''; return; }
  $('#chPrice').textContent = fPrice(d.last.price);
  $('#chChg').innerHTML = `<span class="${cls(d.last.chg)}">${d.last.chg > 0 ? '+' : ''}${fPrice(d.last.chg)} (${fPct(d.last.chgPct)})</span>`;
}

// ---------- tab Analisis ----------
const TREND = { up: 'Tren naik', down: 'Tren turun', side: 'Sideways' };
function fmtMetric(m) {
  if (m.value == null) return '—';
  if (m.fmt === '%') return nf1.format(m.value * 100) + '%';
  if (m.fmt === 'x') return nf2.format(m.value) + '×';
  return fPrice(m.value);
}
const refMetric = (m) => (m.ref == null ? '' : `sektor ${m.fmt === '%' ? nf1.format(m.ref * 100) + '%' : nf1.format(m.ref) + '×'}`);

function verdictHtml(an) {
  const p = an.plan;
  return `<div class="verdict ${p.level}"><div class="v-label">${esc(p.action)}</div><div class="v-sub">${esc(p.sub)}</div>
    <div class="v-meta"><span class="mini">${TF_LABEL[an.tf]}</span><span class="mini">${TREND[p.trend]}</span>${an.val?.available && an.val.fair ? `<span class="mini">Valuasi ${esc(an.val.verdictLabel.toLowerCase())}</span>` : ''}</div></div>`;
}

function valuationHtml(an) {
  const v = an.val, price = an.price;
  if (!v.available) return `<div class="sec"><h4>Valuasi fundamental</h4><div class="none-txt">${esc(v.reason)}</div></div>`;
  let body = '';
  if (v.fair) {
    const lo = Math.min(v.low, price, v.fair) * 0.88, hi = Math.max(v.high, price, v.fair) * 1.12;
    const pos = (x) => +(((x - lo) / (hi - lo)) * 100).toFixed(1);
    const conf = { high: 'tinggi', medium: 'sedang', low: 'rendah' }[v.confidence];
    body += `<div class="val-head"><div><span class="mut">Nilai wajar</span> <b>≈ ${fPrice(v.fair)}</b></div><span class="badge ${v.verdict}">${esc(v.verdictLabel)}</span></div>
      <div class="fb"><div class="fb-track"><div class="fb-range" style="left:${pos(v.low)}%;width:${pos(v.high) - pos(v.low)}%"></div></div>
        <i class="fb-fair" style="left:${pos(v.fair)}%"></i><i class="fb-px" style="left:${pos(price)}%"></i>
        <span class="fb-lbl t" style="left:${Math.min(86, Math.max(14, pos(price)))}%">Harga ${fPrice(price)}</span>
        <span class="fb-lbl" style="left:${Math.min(86, Math.max(14, pos(v.fair)))}%">Wajar ${fPrice(v.fair)}</span></div>
      <div class="fb-note">Rentang wajar ${fPrice(v.low)} – ${fPrice(v.high)} · harga ${v.mos >= 0 ? 'diskon' : 'premi'} <b class="${v.mos >= 0 ? 'up' : 'dn'}">${Math.abs(v.mos * 100).toFixed(0)}%</b> · keyakinan ${conf}${v.buyBelow ? `<br>Harga dengan margin of safety 15%: ≤ <b>${fPrice(v.buyBelow)}</b>` : ''}</div>`;
  } else body += `<div class="none-txt">${esc((v.notes || []).join(' '))}</div>`;
  body += `<div class="metrics">${v.metrics.map((m) => `<div class="metric"><small>${m.label}</small><b>${fmtMetric(m)}</b><em>${refMetric(m) || '&nbsp;'}</em></div>`).join('')}</div>`;
  const q = v.quality;
  const det = `<details class="more"><summary>Detail metode, kualitas &amp; asumsi</summary>
    ${v.methods.map((m) => `<div class="mrow ${m.dropped ? 'drop' : ''}"><span>${esc(m.name)}${m.dropped ? ' <span class="mut">(diabaikan: outlier)</span>' : ''}</span><b>${fPrice(m.value)}</b><span class="how">${esc(m.how)}</span></div>`).join('') || '<div class="none-txt">Tidak ada metode yang bisa dihitung.</div>'}
    ${q.score != null ? `<div class="note">Kualitas fundamental: <b>${q.label}</b> (${q.score}/100)</div><div class="checks">${q.items.map((i) => `<span class="${i.pass ? 'ok' : 'no'}">${esc(i.label)}</span>`).join('')}</div>` : ''}
    ${v.target ? `<div class="note">Konsensus analis (referensi saja, tidak masuk perhitungan): target rata-rata ${fPrice(v.target.mean)} (${fPct(v.target.upside * 100, 1)}), ${v.target.n} analis${v.target.rec ? ', rekomendasi ' + esc(v.target.rec.replace('_', ' ')) : ''}.</div>` : ''}
    ${(v.notes || []).map((n) => `<div class="note">${esc(n)}</div>`).join('')}
    <div class="note">Asumsi: biaya ekuitas ${(v.assumptions.coe * 100).toFixed(0)}%, pertumbuhan jangka panjang ${(v.assumptions.g * 100).toFixed(0)}%, median sektor dari ${v.sector.n} emiten sejenis${v.sector.n < 5 ? ' (kurang dari 5, memakai default)' : ''}. Sumber data: Yahoo Finance.</div></details>`;
  return `<div class="sec"><h4>Valuasi fundamental ${an.profile ? `<span class="tag">${esc(an.profile.sector)}</span>` : ''}</h4>${body}${det}</div>`;
}

function planHtml(an) {
  const p = an.plan;
  const row = (label, val, pct, c, extra) => `<tr class="${c || ''}"><td>${label}</td><td><b>${val}</b><small>${pct}</small>${extra || ''}</td></tr>`;
  return `<div class="sec"><h4>Rencana entry</h4><table class="plan">
    ${row(p.mode === 'now' ? 'Zona beli' : 'Zona tunggu', `${fPrice(p.zone[0])} – ${fPrice(p.zone[1])}`, `${fPct(p.zonePct[0], 1)} s/d ${fPct(p.zonePct[1], 1)}`)}
    ${row('Stop loss', fPrice(p.stop), `${fPct(p.stopPct, 1)} · risiko ${nf1.format(p.riskPct)}%`, 'sl')}
    ${row('Target 1', fPrice(p.t1), fPct(p.t1Pct, 1), 'tp', `<span class="rr">R:R ${nf1.format(p.rr1)}</span>`)}
    ${row('Target 2', fPrice(p.t2), fPct(p.t2Pct, 1), 'tp', `<span class="rr">R:R ${nf1.format(p.rr2)}</span>`)}
    ${p.fundamentalBuyBelow ? row('Harga fundamental ideal', `≤ ${fPrice(p.fundamentalBuyBelow)}`, 'margin of safety 15%') : ''}
  </table>
  <details class="more" open><summary>Faktor penentu</summary><ul class="factors">${p.reasons.map((r) => `<li class="${r.t}">${esc(r.s)}</li>`).join('')}</ul></details></div>`;
}

const aiKey = () => `${state.code}|${state.tf}`;
function aiHtml(an) {
  const r = state.ai[aiKey()];
  let body = '', tag = '<span class="tag">Mesin aturan</span>';
  if (r?.ok) {
    tag = '<span class="tag ai">Claude</span>';
    const li = (a) => (a.length ? `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
    body = `<div class="ai-txt"><div class="hl">${esc(r.headline)}</div>
      <p><b>Ringkasan</b>${esc(r.summary)}</p><p><b>Valuasi — apakah harga wajar?</b>${esc(r.valuation)}</p><p><b>Timing &amp; harga masuk</b>${esc(r.timing)}</p>
      <p><b>Risiko</b></p>${li(r.risks)}<p><b>Pantau</b></p>${li(r.watch)}
      <div class="mut" style="font-size:10.5px">${esc(r.model || '')} · keyakinan ${esc({ low: 'rendah', medium: 'sedang', high: 'tinggi' }[r.confidence] || r.confidence)}${r.cached ? ' · dari cache' : ''}</div></div>
      <button class="btn ghost" id="aiRefresh" ${state.aiLoading ? 'disabled' : ''}>${state.aiLoading ? 'Menganalisis…' : 'Perbarui analisis'}</button>`;
  } else {
    body = `<div class="none-txt">Kesimpulan di atas dihitung mesin aturan dari data fundamental dan teknikal. Minta Claude menafsirkan data yang sama menjadi penjelasan naratif.</div>
      <button class="btn" id="aiBtn" ${state.aiLoading ? 'disabled' : ''}>${state.aiLoading ? 'Claude sedang menganalisis…' : 'Analisis dengan Claude'}</button>`;
    if (r && !r.ok) {
      body += r.code === 'auth'
        ? '<div class="hint"><b>API key belum diset.</b> Buat file <code>.env</code> di folder proyek berisi <code>ANTHROPIC_API_KEY=sk-ant-...</code>, lalu restart server (<code>npm start</code>). Bagian lain dashboard tetap berfungsi tanpa AI.</div>'
        : `<div class="hint">${esc(r.error)}</div>`;
    } else if (an.ai && !an.ai.configured) body += '<div class="hint">Butuh <code>ANTHROPIC_API_KEY</code> di file <code>.env</code> (lihat README).</div>';
  }
  return `<div class="sec"><h4>Analisis ${tag}</h4>${body}</div>`;
}

const SETUP_CLS = { ready: 'good', build: 'neutral', early: '', ext: 'bad' };
function setupHtml(an) {
  const s = an.setup;
  if (!s) return '<div class="sec"><h4>Rencana entry besok</h4><div class="none-txt">Belum ada bullish divergence yang valid (maks 15 bar terakhir) pada timeframe ini, jadi belum ada setup untuk besok.</div></div>';
  const rich = an.val?.available && an.val.verdict === 'rich';
  const row = (label, val, small, c) => `<tr class="${c || ''}"><td>${label}</td><td><b>${val}</b><small>${small || ''}</small></td></tr>`;
  return `<div class="sec"><h4>Rencana entry besok <span class="tag">${s.count}/5 konfirmasi</span></h4>
    <div class="verdict ${SETUP_CLS[s.state]}"><div class="v-label">${esc(s.label)}</div><div class="v-sub">${esc(s.sub)}</div>
      <div class="v-meta"><span class="mini">${fPct(s.bounce, 1)} dari pivot ${fPrice(s.pivot)}</span><span class="mini">${nf1.format(s.bounceATR)}× ATR</span><span class="mini">${s.inds.join(' + ')} · ${s.age} ${BAR_LABEL[an.tf]} lalu</span></div></div>
    <ul class="factors cfgrid">${s.conf.map((c) => `<li class="${c.ok ? 'good' : 'bad'}" title="${esc(c.hint)}">${esc(c.name)}</li>`).join('')}</ul>
    <table class="plan">
      ${row('Pemicu breakout', `tembus ${fPrice(s.trigger)}`, `R:R ${nf1.format(s.rrBreak)}`)}
      ${row('Zona pullback', `${fPrice(s.pull[0])} – ${fPrice(s.pull[1])}`, `R:R ${nf1.format(s.rrPull)}`)}
      ${row('Stop loss', fPrice(s.sl), `risiko ${nf1.format(s.riskPct)}%`, 'sl')}
      ${row('Target 1', fPrice(s.t1), '', 'tp')}${row('Target 2', fPrice(s.t2), '', 'tp')}
    </table>
    ${rich ? '<div class="note">Valuasi di atas nilai wajar: perlakukan sebagai trading pendek dengan ukuran posisi kecil.</div>' : ''}
    ${state.data?.marketOpen ? '<div class="note">Bursa sedang buka: bar hari ini belum final (termasuk volume), status bisa berubah saat penutupan. Paling akurat dicek setelah penutupan.</div>' : ''}
  </div>`;
}

function renderAnalysis() {
  const el = $('#paneAn'), an = state.analysis;
  if (!an) {
    el.innerHTML = state.anError ? `<div class="none-txt">${esc(state.anError)}</div>` : '<div class="skel"></div><div class="skel" style="width:70%"></div><div class="skel"></div><div class="skel" style="width:50%"></div>';
    return;
  }
  el.innerHTML = verdictHtml(an) + setupHtml(an) + valuationHtml(an) + planHtml(an) + aiHtml(an) +
    '<p class="disc">Alat bantu analisis, bukan rekomendasi investasi. Nilai wajar adalah estimasi dari data Yahoo Finance dan asumsi yang bisa meleset; lakukan riset sendiri dan kelola risiko.</p>';
}

// ---------- tab Sinyal ----------
function renderSignals() {
  const d = state.stock, el = $('#paneSig');
  if (!d) { el.innerHTML = '<div class="none-txt">Memuat…</div>'; return; }
  const act = visDivs(d).filter((v) => v.active);
  const bull = act.filter((v) => v.kind === 'bull'), bear = act.filter((v) => v.kind === 'bear');
  const names = (a) => [...new Set(a.map((v) => v.ind))].join(' + ');
  const conf = (a) => (new Set(a.map((v) => v.ind)).size > 1 ? 'terkonfirmasi 2 indikator' : '1 indikator');
  let head;
  if (bull.length && !bear.length) head = `<div class="verdict good"><div class="v-label">Bullish divergence</div><div class="v-sub">${names(bull)} — ${conf(bull)}${d.trig === 'bull' ? ' · StochRSI cross up' : ''}</div></div>`;
  else if (bear.length && !bull.length) head = `<div class="verdict bad"><div class="v-label">Bearish divergence</div><div class="v-sub">${names(bear)} — ${conf(bear)}${d.trig === 'bear' ? ' · StochRSI cross down' : ''}</div></div>`;
  else if (bull.length && bear.length) head = '<div class="verdict neutral"><div class="v-label">Sinyal campuran</div><div class="v-sub">Divergence bullish dan bearish sama-sama aktif.</div></div>';
  else head = '<div class="verdict"><div class="v-label" style="color:var(--mut)">Tidak ada divergence aktif</div><div class="v-sub">Pada timeframe ini belum ada sinyal.</div></div>';

  const list = visDivs(d).slice(0, 8);
  const dl = list.length ? list.map((v) => `<div class="dv-row ${v.active ? 'act' : 'old'}"><span class="chip ${v.kind}">${v.kind === 'bull' ? '▲ Bull' : '▼ Bear'}</span>
      <div><b>${v.ind}</b> <span class="mut">${v.mode === 'regular' ? 'Regular' : 'Hidden'}</span><div class="meta">${fDate(v.t1, d.tf)} → ${fDate(v.t2, d.tf)} · ${fPrice(v.p1)} → ${fPrice(v.p2)}</div></div>
      <div class="age">${v.active ? '● aktif · ' : ''}${v.age} ${BAR_LABEL[d.tf]} lalu</div></div>`).join('') : '<div class="none-txt">Tidak ada divergence terdeteksi di histori yang dipindai.</div>';

  const price = d.last.price;
  const sr = (l, t, i) => `<div class="sr-row ${t}"><span class="tag">${t === 'res' ? 'R' : 'S'}${i + 1}</span><span class="px">${fPrice(l.price)}</span><span class="pc">${l.touches}× sentuh · ${fPct(((l.price - price) / price) * 100, 1)}</span></div>`;
  const rs = d.sr.resistances.map((l, i) => sr(l, 'res', i)).reverse().join('') || '<div class="none-txt">Tidak ada resistance terdekat.</div>';
  const ss = d.sr.supports.map((l, i) => sr(l, 'sup', i)).join('') || '<div class="none-txt">Tidak ada support terdekat.</div>';
  const pf = d.perf || {};
  const perf = ['1W', '1M', '3M', '6M', 'YTD', '1Y'].map((k) => `<div class="${pf[k] == null ? '' : pf[k] >= 0 ? 'p' : 'n'}">${pf[k] == null ? '—' : fPct(pf[k], 1)}<small>${k}</small></div>`).join('');
  el.innerHTML = head + `<div class="sec"><h4>Riwayat divergence</h4>${dl}</div><div class="sec"><h4>Support &amp; resistance</h4>${rs}<div class="sr-now"><span>Harga sekarang</span><b>${fPrice(price)}</b></div>${ss}</div><div class="sec"><h4>Performa</h4><div class="perf">${perf}</div></div>`;
}

function setTab(t) {
  state.rtab = t; save();
  document.querySelectorAll('#rTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  $('#paneAn').hidden = t !== 'an'; $('#paneSig').hidden = t !== 'sig';
}
$('#rTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.t); });
$('#paneAn').addEventListener('click', (e) => { if (e.target.closest('#aiBtn')) loadAi(false); else if (e.target.closest('#aiRefresh')) loadAi(true); });

// ---------- load data ----------
let stockSeq = 0, anSeq = 0;
async function loadStock(silent) {
  const seq = ++stockSeq, code = state.code, tf = state.tf;
  if (!silent) { $('#chLoading').hidden = false; $('#chEmpty').hidden = true; }
  try {
    const r = await fetch(`/api/stock/${code}?tf=${tf}`);
    if (seq !== stockSeq) return;
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Gagal memuat');
    const d = await r.json();
    if (d.tooShort) throw new Error(`Data ${code} terlalu pendek untuk analisis di timeframe ini.`);
    const same = silent && cur && cur.code === d.code && cur.tf === d.tf;
    state.stock = d;
    $('#chEmpty').hidden = true;
    renderChart(d, same); renderHead(); renderSignals();
  } catch (e) {
    if (seq !== stockSeq) return;
    if (!silent) { state.stock = null; $('#chEmpty').hidden = false; $('#chEmpty').textContent = e.message; renderHead(); renderSignals(); }
  } finally { if (seq === stockSeq) $('#chLoading').hidden = true; }
}

async function loadAnalysis(silent) {
  const seq = ++anSeq, code = state.code, tf = state.tf;
  if (!silent) { state.analysis = null; state.anError = ''; renderAnalysis(); }
  try {
    const r = await fetch(`/api/analysis/${code}?tf=${tf}`);
    if (seq !== anSeq) return;
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Gagal memuat analisis');
    state.analysis = d; state.anError = '';
    renderAnalysis();
    if (state.stock && state.stock.code === d.code && state.stock.tf === d.tf) renderChart(state.stock, true); // gambar level entry
  } catch (e) {
    if (seq !== anSeq) return;
    if (!silent) { state.analysis = null; state.anError = e.message; renderAnalysis(); }
  }
}

async function loadAi(force) {
  const key = aiKey();
  state.aiLoading = true; renderAnalysis();
  try {
    const r = await fetch(`/api/ai/${state.code}?tf=${state.tf}${force ? '&refresh=1' : ''}`);
    const d = await r.json();
    state.ai[key] = r.ok ? d : { ok: false, code: 'error', error: d.error || 'Gagal memuat analisis AI' };
  } catch (e) { state.ai[key] = { ok: false, code: 'network', error: 'Gagal menghubungi server: ' + e.message }; }
  state.aiLoading = false;
  renderAnalysis();
}

function selectStock(code, scroll) {
  code = code.toUpperCase().replace(/\.JK$/, '');
  if (!code) return;
  state.code = code; state.stock = null; cur = null; state.aiLoading = false; save(); drawings.setSymbol(code);
  document.querySelectorAll('#tbody tr').forEach((tr) => tr.classList.toggle('sel', tr.dataset.code === code));
  if (scroll) $(`#tbody tr[data-code="${code}"]`)?.scrollIntoView({ block: 'nearest' });
  renderHead();
  loadStock(false); loadAnalysis(false);
}
function step(dir) {
  const v = state.view;
  if (!v.length) return;
  const i = v.findIndex((r) => r.code === state.code);
  selectStock(v[i < 0 ? (dir > 0 ? 0 : v.length - 1) : (i + dir + v.length) % v.length].code, true);
}

let pollTimer = null;
async function pollScreener() {
  clearTimeout(pollTimer);
  const tf = state.tf;
  let running = false;
  try {
    const d = await (await fetch(`/api/screener?tf=${tf}`)).json();
    if (tf === state.tf) {
      state.data = d; running = d.scan.running;
      renderStatus(); renderScreener();
      $('#codeList').innerHTML = d.rows.map((r) => `<option value="${r.code}">${esc(r.name)}</option>`).join('');
    }
  } catch {}
  pollTimer = setTimeout(pollScreener, running ? 3000 : 20000);
}
function renderStatus() {
  const d = state.data;
  if (!d) return;
  const m = $('#mkt');
  m.textContent = (d.marketOpen ? 'Bursa buka' : 'Bursa tutup') + (d.asOf ? ' · ' + new Date(d.asOf).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '');
  m.classList.toggle('open', d.marketOpen);
  $('#scanBar').hidden = !d.scan.running;
  $('#scanTxt').textContent = `Scan ${d.scan.done}/${d.scan.total}`;
}

// ---------- events ----------
$('#tfSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.dataset.tf === state.tf) return;
  state.tf = b.dataset.tf; state.data = null; state.stock = null; cur = null; state.aiLoading = false; save(); if (!indPanel.hidden) renderIndPanel();
  syncControls(); renderScreener(); renderRangeBar(); loadStock(false); loadAnalysis(false); pollScreener();
});
$('#catTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.cat = b.dataset.c; save(); renderScreener(); });
$('#modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.dataset.m === state.mode) return; state.mode = b.dataset.m; state.sort = state.mode === 'besok' ? { key: 'sscore', dir: -1 } : { key: 'score', dir: -1 }; save(); renderScreener(); });
$('#stSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.st = b.dataset.st; save(); renderScreener(); });
$('#sigSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.sig = b.dataset.s; save(); renderScreener(); });
$('#tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr'); if (tr) selectStock(tr.dataset.code, false); });
$('#tbl thead').addEventListener('click', (e) => {
  const th = e.target.closest('th'); if (!th) return;
  const k = th.dataset.k;
  if (!k) return;
  if (state.sort.key === k) state.sort.dir *= -1; else state.sort = { key: k, dir: k === 'code' || k === 'supPct' ? 1 : -1 };
  save(); renderScreener();
});
for (const [id, key] of [['fInd', 'ind'], ['fHidden', 'hidden'], ['fLiq', 'liq']]) {
  $('#' + id).addEventListener('change', (e) => { state[key] = e.target.value; save(); renderScreener(); renderSignals(); if (key === 'hidden' && state.stock) renderChart(state.stock, true); });
}
$('#fOnly').addEventListener('change', (e) => { state.only = e.target.checked; save(); renderScreener(); });
for (const [id, key] of [['tgDiv', 'showDiv'], ['tgSR', 'showSR']]) {
  $('#' + id).addEventListener('click', () => { state[key] = !state[key]; save(); syncControls(); if (state.stock) renderChart(state.stock, true); });
}
document.addEventListener('click', (e) => { const a = $('#adv'); if (a.open && !a.contains(e.target)) a.open = false; });
$('#prevBtn').addEventListener('click', () => step(-1));
$('#nextBtn').addEventListener('click', () => step(1));
const symInput = $('#symInput');
symInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { selectStock(symInput.value.trim()); symInput.blur(); } });
symInput.addEventListener('change', () => { const v = symInput.value.trim(); if (v.length >= 3) selectStock(v); });
document.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, select, textarea')) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); step(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
  else if (e.key === '/') { e.preventDefault(); symInput.focus(); symInput.select(); }
});

function syncControls() {
  document.querySelectorAll('#tfSeg button').forEach((b) => b.classList.toggle('on', b.dataset.tf === state.tf));
  $('#fInd').value = state.ind; $('#fHidden').value = state.hidden; $('#fLiq').value = state.liq; $('#fOnly').checked = state.only;
  $('#tgDiv').classList.toggle('on', state.showDiv); $('#tgSR').classList.toggle('on', state.showSR);
}

setInterval(() => { if (state.data?.marketOpen && !document.hidden) { loadStock(true); loadAnalysis(true); } }, 60000);

syncControls(); syncType(); drawings.setSymbol(state.code); renderRangeBar(); renderScreener(); setTab(state.rtab); renderAnalysis(); renderHead();
loadStock(false); loadAnalysis(false); pollScreener();

