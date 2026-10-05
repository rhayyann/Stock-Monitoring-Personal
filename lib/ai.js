// Narasi analisis oleh Claude. Angka (nilai wajar, zona entry, SL/TP) selalu berasal dari mesin hitung
// di server; Claude hanya menafsirkan dan menjelaskan data tersebut, bukan mengarang angka.
const Anthropic = require('@anthropic-ai/sdk');
const Client = Anthropic.default || Anthropic;

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const CACHE_MS = 30 * 60e3;
const cache = new Map();
let client = null;

const SYSTEM = `Kamu adalah analis saham Indonesia (IDX) yang disiplin dan jujur. Tugasmu menafsirkan data yang diberikan pengguna (JSON berisi fundamental, valuasi, divergence harga vs MACD/StochRSI, support/resistance, dan rencana entry hasil perhitungan mesin) menjadi analisis singkat dalam Bahasa Indonesia.

Aturan:
- Gunakan HANYA angka yang ada di data. Jangan mengarang angka, berita, atau aksi korporasi. Jika data tidak ada atau tidak andal, katakan itu.
- Valuasi harus berlandaskan fundamental (nilai wajar, PER/PBV vs sektor, ROE, DER, pertumbuhan laba, dividen, kualitas). Jelaskan apakah harga sekarang wajar, murah, atau mahal dan seberapa yakin (perhatikan confidence dan catatan data).
- Timing masuk berlandaskan divergence, trigger StochRSI, tren, support/resistance, dan R:R. Sebut zona beli, stop loss, dan target sesuai data (jangan ubah angkanya).
- Rekomendasi mesin ("plan.action") adalah titik awal. Boleh tidak sepakat jika ada alasan kuat dari data, dan jelaskan alasannya.
- Jika fundamental dan teknikal bertentangan (mis. timing bagus tapi valuasi mahal), tegaskan konfliknya dan konsekuensinya untuk ukuran posisi / horizon waktu.
- Tulis padat dan konkret, tanpa basa-basi, tanpa emoji. Ini alat bantu analisis, bukan nasihat investasi personal; jangan menjanjikan hasil.`;

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Satu kalimat kesimpulan, maks ~100 karakter' },
    stance: { type: 'string', enum: ['entry', 'bertahap', 'tunggu', 'hindari'] },
    summary: { type: 'string', description: '2-3 kalimat ringkasan menyeluruh (fundamental + teknikal)' },
    valuation: { type: 'string', description: 'Apakah harga wajar? Dasar fundamental dan tingkat keyakinan' },
    timing: { type: 'string', description: 'Kapan dan di harga berapa masuk; zona, stop loss, target, R:R' },
    risks: { type: 'array', items: { type: 'string' } },
    watch: { type: 'array', items: { type: 'string' }, description: 'Kondisi/level yang perlu dipantau' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['headline', 'stance', 'summary', 'valuation', 'timing', 'risks', 'watch', 'confidence'],
  additionalProperties: false,
};

class AiError extends Error { constructor(code, message) { super(message); this.code = code; } }

function configured() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
}

function getClient() { return (client ||= new Client()); }

function extract(resp) {
  if (resp.stop_reason === 'refusal') throw new AiError('refusal', 'Claude menolak menjawab permintaan ini.');
  const block = (resp.content || []).find((b) => b.type === 'text');
  if (!block) throw new AiError('empty', 'Respons AI kosong.');
  let txt = block.text.trim();
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) txt = m[0];
  let out;
  try { out = JSON.parse(txt); } catch { throw new AiError('parse', 'Respons AI bukan JSON valid.'); }
  for (const k of SCHEMA.required) if (out[k] == null) throw new AiError('parse', `Respons AI tidak lengkap (${k}).`);
  out.risks = [].concat(out.risks || []); out.watch = [].concat(out.watch || []);
  return out;
}

async function callClaude(body) {
  const c = getClient();
  try {
    // fallbacks: bila classifier keamanan menolak, API mengulang di model cadangan dalam satu panggilan
    return await c.beta.messages.create({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (e) {
    if (!(e instanceof Anthropic.BadRequestError)) throw e;
  }
  try {
    return await c.messages.create(body);
  } catch (e) {
    if (!(e instanceof Anthropic.BadRequestError) || !body.output_config?.format) throw e;
  }
  // terakhir: tanpa structured output, minta JSON lewat instruksi
  const { format, ...oc } = body.output_config;
  return c.messages.create({ ...body, output_config: oc, system: body.system + '\n\nBalas HANYA dengan satu objek JSON valid sesuai skema berikut:\n' + JSON.stringify(SCHEMA) });
}

async function narrate(key, payload, force) {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return { ...hit.data, cached: true };
  let resp;
  try {
    resp = await callClaude({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: 'user', content: 'Data hasil perhitungan mesin (JSON):\n' + JSON.stringify(payload) + '\n\nBuat analisis sesuai skema.' }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    });
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError || /authentication|api[_ ]key|credential/i.test(e.message || '')) throw new AiError('auth', 'Kredensial Claude API belum diset atau tidak valid.');
    if (e instanceof Anthropic.RateLimitError) throw new AiError('rate', 'Terkena rate limit Claude API, coba lagi sebentar lagi.');
    if (e instanceof Anthropic.APIError) throw new AiError('api', `Claude API error ${e.status}: ${e.message}`);
    throw new AiError('network', 'Gagal menghubungi Claude API: ' + (e.message || e));
  }
  const data = { ...extract(resp), model: resp.model || MODEL, at: Date.now() };
  cache.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { narrate, configured, AiError, MODEL };
