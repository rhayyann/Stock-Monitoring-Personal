# IDX Divergence Monitor

Dashboard monitoring saham IDX untuk mencari entry berdasarkan **divergence harga vs MACD & StochRSI**, **support / resistance**, **valuasi fundamental** (apakah harga wajar?), dan **rencana entry** (zona beli, stop loss, target). Tema terang/gelap. Data real dari Yahoo Finance (kode `.JK`, tertunda ±10 menit).

## Jalankan

```bash
npm install     # sekali saja (lightweight-charts sudah disalin ke public/vendor)
npm start       # lalu buka http://localhost:3000
```

Scan pertama ±5–30 detik (388 emiten, 10 request paralel), setelahnya data di-cache ke `data/` dan di-refresh otomatis di background (tiap 5 menit saat bursa buka). Pindah emiten = instan karena dilayani dari cache.

## Analisis fundamental & waktu masuk
Tab **Analisis** di panel kanan menggabungkan fundamental dan teknikal:
- **Nilai wajar** dari beberapa metode (hasil dirata-rata berbobot, outlier dibuang): P/B wajar dari ROE, P/E wajar sektor (disesuaikan growth & kualitas), P/B median sektor, Graham number, dan diskonto dividen. Median sektor dihitung dari emiten sejenis di universe. Konsensus analis hanya ditampilkan sebagai referensi.
- **Kualitas fundamental**: checklist (laba, ROE, margin, DER, current ratio, arus kas, pertumbuhan laba, dividen).
- **Rencana entry**: zona beli dari pivot divergence / support dan ATR, stop loss, target 1-2 dari resistance, R:R, semuanya dibulatkan ke fraksi harga BEI. Rekomendasi (ENTRY / AKUMULASI / TUNGGU / HINDARI) menggabungkan timing teknikal dengan valuasi, mis. timing bagus tapi valuasi mahal menjadi "ENTRY TAKTIKAL".
- **Analisis dengan Claude** (opsional): tombol di panel mengirim angka hasil perhitungan di atas ke Claude, yang menulis penjelasan naratif (apakah harga wajar, kapan & di harga berapa masuk, risiko, hal yang dipantau). Claude tidak membuat angka sendiri. Butuh API key: salin `.env.example` menjadi `.env`, isi `ANTHROPIC_API_KEY`, restart server. Hasil di-cache 30 menit per emiten. Model default `claude-opus-5-5` (ubah lewat `ANTHROPIC_MODEL`).

Keterbatasan: data fundamental Yahoo untuk IDX kadang tidak lengkap atau tertinggal; emiten yang melapor dalam USD dikoreksi (nilai buku diturunkan dari EPS/ROE). Nilai wajar adalah estimasi berasumsi (biaya ekuitas 12%, growth jangka panjang 5%, bisa diubah di `.env`), bukan angka pasti.

## Cara kerja sinyal
- **Divergence** dicari dari pivot swing harga (3 bar kiri / 2 bar kanan) dan nilai indikator di pivot yang sama.
  - Regular bullish: harga LL, indikator HL (hanya dari zona negatif MACD / StochRSI < 35)
  - Regular bearish: harga HH, indikator LH (MACD positif / StochRSI > 65)
  - Hidden (opsional di filter): kebalikannya, sinyal lanjutan tren.
  - Garis antar-pivot tidak boleh "tertembus" candle/indikator; divergence batal jika harga menembus pivot ke-2.
  - **Aktif** = pivot ke-2 maksimal 8 bar yang lalu dan belum invalid.
- **Trigger**: StochRSI K cross D dalam 3 bar terakhir (cross up dari area bawah 50 untuk bull, cross down dari atas 50 untuk bear).
- **Support/Resistance**: klaster pivot swing (toleransi mengikuti ATR), butuh ≥ 2 sentuhan.
- **Skor** = jumlah indikator yang diverge (+ bobot regular > hidden, + kesegaran, + trigger, + dekat S/R).

Parameter ada di `lib/analysis.js` (`CFG`). `MACD_SOURCE=line npm start` untuk memakai garis MACD (default histogram).

## Chart: indikator opsional, alat gambar, tipe chart
- **Tipe chart**: Candle / Line / Area (tombol di kanan atas chart). Garis divergence, marker, dan level S/R tetap tampil di semua tipe.
- **Indikator** (tombol "Indikator"): overlay di harga — 3 moving average (EMA/SMA, periode bebas), Bollinger Bands, Supertrend, Parabolic SAR, Ichimoku (garis, tanpa awan berwarna), VWAP (hanya 15m/1H); panel terpisah — Volume, MACD, Stochastic RSI, RSI. Parameter bisa diubah di panel. Garis divergence MACD/StochRSI hanya digambar bila panel indikatornya aktif. Pengaturan tersimpan di browser.
- **Alat gambar** (toolbar kiri chart): garis tren, garis horizontal, ray, kotak, Fibonacci retracement. Klik alat lalu klik di chart (2 klik, horizontal 1 klik). Klik garis untuk memilih, seret badan garis atau titik ujungnya untuk memindah, `Del` untuk menghapus, `Esc` untuk membatalkan. Warna bisa dipilih. Gambar tersimpan per emiten di browser (localStorage) dan menempel pada tanggal/harga, jadi tetap pada tempatnya saat pindah timeframe.
- Label sinyal ditulis lengkap: `MACD`, `StochRSI`, atau `MACD + StochRSI` (kedua indikator sama-sama diverge, sinyal lebih kuat). Ikon ⚡ = StochRSI baru cross searah.

## Deploy ke Vercel
Repo ini siap di-import ke Vercel (`vercel.json` + `api/[...path].js`, tanpa build command). Di Vercel, aplikasi berjalan sebagai fungsi serverless sehingga ada perbedaan dari mode lokal:
- Tidak ada proses background. Scan data dikerjakan bertahap di dalam request `/api/screener` (maks ±8 dtk per request, UI otomatis memanggil ulang sampai selesai), jadi **muat pertama setelah instance dingin terasa lebih lambat** (±10-20 dtk). Cache hanya hidup di instance yang sama (memori + folder sementara `/tmp`) dan hilang saat instance di-recycle.
- Isi `ANTHROPIC_API_KEY` di Project Settings → Environment Variables bila ingin tombol "Analisis dengan Claude" (file `.env` tidak ikut ter-deploy).
- Fungsi diset `maxDuration: 60` (cukup untuk scan dan panggilan Claude); batas plan bisa berbeda.
- Bila ingin cache permanen dan refresh otomatis di background, jalankan sebagai server biasa (`npm start`) di hosting yang mendukung proses long-running (Render, Railway, Fly.io, VPS).

## Kustomisasi
- Tambah emiten: buat `data/custom-tickers.json` berisi `["ABCD","EFGH"]`.
- Kategori harga: `CATS` di `public/app.js`.
- Shortcut: `↑ / ↓` pindah emiten di daftar, `/` fokus ke pencarian.

> Alat bantu analisis, bukan rekomendasi investasi.
