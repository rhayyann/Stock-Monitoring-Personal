/* Alat gambar di atas chart (garis tren, horizontal, ray, kotak, Fibonacci).
   Titik disimpan sebagai {t: waktu bar, o: offset bar (pecahan), p: harga} sehingga tetap menempel
   pada data walau jendela candle bergeser, dan bisa digambar melewati bar terakhir. */
function createDrawings(ctx) {
  const { wrap, chart, getMain, getCandles, getPriceH, fmt, onTool, onSelect } = ctx;
  const canvas = document.createElement('canvas');
  canvas.className = 'draw-canvas';
  wrap.appendChild(canvas);
  const g = canvas.getContext('2d');
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const TWO_POINT = new Set(['trend', 'ray', 'rect', 'fib']);

  let list = [], sel = null, tool = 'cursor', pending = null, drag = null, dirty = true, sig = '', symbol = '', color = '#f5a623', uid = 1;

  const key = () => 'idxdraw:' + symbol;
  const persist = () => { try { localStorage.setItem(key(), JSON.stringify(list)); } catch {} };
  const load = () => { try { list = JSON.parse(localStorage.getItem(key()) || '[]'); } catch { list = []; } uid = list.reduce((m, d) => Math.max(m, d.id), 0) + 1; };

  // ---------- konversi koordinat ----------
  const plotW = () => wrap.clientWidth - (chart.priceScale('right').width() || 0);
  function barIndex(t) {
    const c = getCandles(); if (!c) return 0;
    let lo = 0, hi = c.t.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c.t[m] < t) lo = m + 1; else hi = m; }
    return lo > 0 && Math.abs(c.t[lo - 1] - t) < Math.abs(c.t[lo] - t) ? lo - 1 : lo;
  }
  const lgOf = (pt) => barIndex(pt.t) + pt.o;
  function mk(lg, p) {
    const c = getCandles(); const n = c.t.length;
    const i = Math.max(0, Math.min(n - 1, Math.round(lg)));
    return { t: c.t[i], o: lg - i, p };
  }
  function toXY(pt) {
    const main = getMain(); if (!main || !getCandles()) return null;
    const x = chart.timeScale().logicalToCoordinate(lgOf(pt)), y = main.priceToCoordinate(pt.p);
    return x == null || y == null ? null : { x, y };
  }
  function fromXY(x, y) {
    const main = getMain(); if (!main || !getCandles()) return null;
    const lg = chart.timeScale().coordinateToLogical(x), p = main.coordinateToPrice(y);
    return lg == null || p == null ? null : mk(lg, p);
  }
  const rel = (e) => { const r = wrap.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const inPlot = (q) => q.x >= 0 && q.x <= plotW() && q.y >= 0 && q.y <= getPriceH();

  // ---------- geometri ----------
  const distSeg = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  function shape(d) { // piksel
    const P = d.pts.map(toXY);
    if (P.some((v) => !v)) return null;
    const W = plotW();
    if (d.type === 'hline') return { type: 'hline', y: P[0].y, W };
    const [a, b] = P;
    if (d.type === 'ray') {
      const dx = b.x - a.x, dy = b.y - a.y;
      const end = Math.abs(dx) < 1e-6 ? { x: b.x, y: dy >= 0 ? 1e5 : -1e5 } : { x: W + 50, y: a.y + (dy / dx) * (W + 50 - a.x) };
      return { type: 'ray', a, b, end: dx < 0 ? { x: -50, y: a.y + (dy / dx) * (-50 - a.x) } : end };
    }
    return { type: d.type, a, b };
  }
  function hit(q) {
    for (let k = list.length - 1; k >= 0; k--) {
      const d = list[k], s = shape(d); if (!s) continue;
      if (d.id === sel) { // handle titik
        const hs = d.type === 'hline' ? [{ x: s.W - 24, y: s.y }] : [s.a, s.b];
        for (let i = 0; i < hs.length; i++) if (Math.hypot(q.x - hs[i].x, q.y - hs[i].y) < 9) return { d, mode: 'pt', k: d.type === 'hline' ? 0 : i };
      }
      let near = false;
      if (s.type === 'hline') near = Math.abs(q.y - s.y) < 6;
      else if (s.type === 'trend') near = distSeg(q, s.a, s.b) < 6;
      else if (s.type === 'ray') near = distSeg(q, s.a, s.end) < 6;
      else if (s.type === 'rect') { const x0 = Math.min(s.a.x, s.b.x), x1 = Math.max(s.a.x, s.b.x), y0 = Math.min(s.a.y, s.b.y), y1 = Math.max(s.a.y, s.b.y); near = q.x >= x0 - 5 && q.x <= x1 + 5 && q.y >= y0 - 5 && q.y <= y1 + 5; }
      else if (s.type === 'fib') {
        const x0 = Math.min(s.a.x, s.b.x) - 5, x1 = Math.max(s.a.x, s.b.x) + 5;
        near = q.x >= x0 && q.x <= x1 && FIB.some((L) => Math.abs(q.y - (s.b.y + (s.a.y - s.b.y) * L)) < 5);
      }
      if (near) return { d, mode: 'move' };
    }
    return null;
  }

  // ---------- gambar ----------
  function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  function drawOne(d, s, preview) {
    g.strokeStyle = d.color; g.fillStyle = d.color; g.lineWidth = d.id === sel ? 2.2 : 1.6; g.setLineDash(preview ? [5, 4] : []);
    g.font = '11px "Segoe UI", system-ui, sans-serif'; g.textBaseline = 'middle';
    if (s.type === 'hline') {
      g.beginPath(); g.moveTo(0, s.y); g.lineTo(s.W, s.y); g.stroke();
      const txt = fmt(d.pts[0].p), w = g.measureText(txt).width + 10;
      g.setLineDash([]); g.fillRect(s.W - w - 4, s.y - 9, w, 18);
      g.fillStyle = '#111'; g.fillText(txt, s.W - w + 1, s.y + 0.5);
    } else if (s.type === 'trend') {
      g.beginPath(); g.moveTo(s.a.x, s.a.y); g.lineTo(s.b.x, s.b.y); g.stroke();
    } else if (s.type === 'ray') {
      g.beginPath(); g.moveTo(s.a.x, s.a.y); g.lineTo(s.end.x, s.end.y); g.stroke();
    } else if (s.type === 'rect') {
      const x = Math.min(s.a.x, s.b.x), y = Math.min(s.a.y, s.b.y), w = Math.abs(s.a.x - s.b.x), h = Math.abs(s.a.y - s.b.y);
      g.fillStyle = rgba(d.color, 0.12); g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
    } else if (s.type === 'fib') {
      const x0 = Math.min(s.a.x, s.b.x), x1 = Math.max(s.a.x, s.b.x);
      const pA = d.pts[0].p, pB = d.pts[1].p;
      FIB.forEach((L, i) => {
        const y = s.b.y + (s.a.y - s.b.y) * L, price = pB + (pA - pB) * L;
        g.globalAlpha = i === 0 || i === FIB.length - 1 ? 1 : 0.75;
        g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
        g.globalAlpha = 1; g.fillStyle = d.color;
        g.fillText(`${(L * 100).toFixed(1).replace('.0', '')}%  ${fmt(price)}`, x0 + 4, y - 8);
        if (i < FIB.length - 1) { const yN = s.b.y + (s.a.y - s.b.y) * FIB[i + 1]; g.fillStyle = rgba(d.color, i % 2 ? 0.05 : 0.09); g.fillRect(x0, Math.min(y, yN), x1 - x0, Math.abs(yN - y)); }
      });
      g.setLineDash([3, 4]); g.beginPath(); g.moveTo(s.a.x, s.a.y); g.lineTo(s.b.x, s.b.y); g.stroke();
    }
    g.setLineDash([]);
    if (d.id === sel && !preview) { // handle
      const hs = s.type === 'hline' ? [{ x: s.W - 24, y: s.y }] : [s.a, s.b];
      for (const h of hs) { g.fillStyle = '#fff'; g.strokeStyle = d.color; g.lineWidth = 2; g.beginPath(); g.arc(h.x, h.y, 4.5, 0, 7); g.fill(); g.stroke(); }
    }
  }
  function draw() {
    const w = wrap.clientWidth, h = wrap.clientHeight, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.save(); g.beginPath(); g.rect(0, 0, plotW(), getPriceH()); g.clip();
    for (const d of list) { const s = shape(d); if (s) drawOne(d, s, false); }
    if (pending) { const d = { id: 0, type: pending.type, color: pending.color, pts: pending.pts }; const s = shape(d); if (s) drawOne(d, s, true); }
    g.restore();
    dirty = false;
  }
  function frame() {
    requestAnimationFrame(frame);
    const main = getMain(), c = getCandles();
    if (!main || !c) return;
    const lr = chart.timeScale().getVisibleLogicalRange();
    const last = c.c[c.c.length - 1];
    const s = [lr ? lr.from.toFixed(2) + lr.to.toFixed(2) : '', main.priceToCoordinate(last)?.toFixed(1), main.priceToCoordinate(last * 1.07)?.toFixed(1), wrap.clientWidth, wrap.clientHeight, getPriceH()].join('|');
    if (s !== sig || dirty) { sig = s; draw(); }
  }
  requestAnimationFrame(frame);

  // ---------- interaksi ----------
  function setTool(t) { tool = t; pending = null; if (t !== 'cursor') { sel = null; onSelect?.(null); } onTool?.(t); dirty = true; }
  function select(id) { sel = id; dirty = true; onSelect?.(id ? list.find((d) => d.id === id) : null); }
  function add(d) { d.id = uid++; list.push(d); persist(); select(d.id); }

  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.dtools, .legend, .loading, .empty')) return;
    const q = rel(e);
    if (!inPlot(q)) return;
    if (tool !== 'cursor') {
      const pt = fromXY(q.x, q.y); if (!pt) return;
      e.stopPropagation(); e.preventDefault();
      if (tool === 'hline') { add({ type: 'hline', color, pts: [pt] }); setTool('cursor'); return; }
      if (!pending) { pending = { type: tool, color, pts: [pt, pt] }; dirty = true; return; }
      pending.pts[1] = pt;
      add({ type: pending.type, color: pending.color, pts: pending.pts });
      setTool('cursor');
      return;
    }
    const h = hit(q);
    if (h) {
      e.stopPropagation(); e.preventDefault();
      select(h.d.id);
      const lg0 = chart.timeScale().coordinateToLogical(q.x), p0 = getMain().coordinateToPrice(q.y);
      drag = { id: h.d.id, mode: h.mode, k: h.k, lg0, p0, orig: h.d.pts.map((p) => ({ lg: lgOf(p), p: p.p })) };
    } else if (sel) select(null);
  }, true);

  document.addEventListener('mousemove', (e) => {
    if (!pending && !drag) return;
    const q = rel(e);
    if (pending) { const pt = fromXY(Math.min(q.x, plotW()), Math.min(q.y, getPriceH())); if (pt) { pending.pts[1] = pt; dirty = true; } return; }
    const d = list.find((x) => x.id === drag.id); if (!d) return;
    const lg = chart.timeScale().coordinateToLogical(Math.min(q.x, plotW())), p = getMain().coordinateToPrice(q.y);
    if (lg == null || p == null) return;
    if (drag.mode === 'pt') d.pts[drag.k] = mk(d.type === 'hline' ? drag.orig[0].lg : lg, p);
    else { const dl = lg - drag.lg0, dp = p - drag.p0; d.pts = drag.orig.map((o) => mk(d.type === 'hline' ? o.lg : o.lg + dl, o.p + dp)); }
    dirty = true;
  });
  document.addEventListener('mouseup', () => { if (drag) { drag = null; persist(); } });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches?.('input, select, textarea')) return;
    if (e.key === 'Escape') { if (pending || tool !== 'cursor') setTool('cursor'); else if (sel) select(null); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); del(); }
  });

  function del() { if (!sel) return; list = list.filter((d) => d.id !== sel); sel = null; persist(); dirty = true; onSelect?.(null); }

  return {
    setSymbol(code) { symbol = code; load(); sel = null; pending = null; dirty = true; onSelect?.(null); },
    setTool,
    setColor(c) { color = c; const d = list.find((x) => x.id === sel); if (d) { d.color = c; persist(); dirty = true; } },
    deleteSelected: del,
    clearAll() { if (!list.length) return; list = []; sel = null; persist(); dirty = true; onSelect?.(null); },
    markDirty() { dirty = true; },
    count: () => list.length,
    getTool: () => tool,
  };
}

