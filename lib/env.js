// Loader .env minimal (tanpa dependensi). Variabel yang sudah diset di environment tidak ditimpa.
const fs = require('fs');
const path = require('path');
try {
  const txt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (v && process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch {}
