// Pengambil data OHLCV dari Yahoo Finance (kode IDX = <KODE>.JK)
const TF = {
  '15m': { interval: '15m', range: '1mo', perDay: 26 },
  '1h': { interval: '60m', range: '3mo', perDay: 7 },
  '1d': { interval: '1d', range: '1y', perDay: 1 },
  '1wk': { interval: '1wk', range: '5y', perDay: 0.2 },
};

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class NotFound extends Error {}

async function fetchCandles(code, tf, attempt = 0) {
  const cfg = TF[tf];
  const host = HOSTS[attempt % HOSTS.length];
  const url = `https://${host}/v8/finance/chart/${encodeURIComponent(code)}.JK?range=${cfg.range}&interval=${cfg.interval}&includePrePost=false`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    if (attempt < 3) { await sleep(400 * (attempt + 1)); return fetchCandles(code, tf, attempt + 1); }
    throw e;
  }
  if (res.status === 404) throw new NotFound(code);
  if (res.status === 429 || res.status >= 500) {
    if (attempt < 3) { await sleep(800 * (attempt + 1)); return fetchCandles(code, tf, attempt + 1); }
    throw new Error(`HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r || !r.timestamp) throw new NotFound(code);
  const off = r.meta?.gmtoffset ?? 25200; // tampilkan waktu WIB
  const q = r.indicators.quote[0];
  const c = { t: [], o: [], h: [], l: [], c: [], v: [] };
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], cl = q.close[i];
    if (o == null || h == null || l == null || cl == null) continue;
    c.t.push(r.timestamp[i] + off);
    c.o.push(o); c.h.push(h); c.l.push(l); c.c.push(cl); c.v.push(q.volume[i] || 0);
  }
  return { name: r.meta?.longName || r.meta?.shortName || code, c };
}

module.exports = { fetchCandles, NotFound, TF };
