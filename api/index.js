// Titik masuk Vercel: seluruh /api/* (lewat rewrite di vercel.json) dilayani handler yang sama dengan server lokal
module.exports = require('../server.js');
