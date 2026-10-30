# Uji akurasi pipeline suara

Mengukur seberapa sering pipeline **Voice to Transaction** (Groq Whisper → watsonx.ai Granite → Structured Output Parser) menghasilkan nominal dan jenis ucapan yang benar, lalu membandingkannya dengan baseline tanpa model bahasa (regex + kamus istilah pasar) yang dijalankan pada transkrip Whisper yang sama.

| File | Isi |
|---|---|
| `phrases.csv` | 60 kalimat uji: 46 kondisi tenang + 14 kondisi bising, dibagi per kelas angka, lengkap dengan nominal yang benar |
| `voice_eval.mjs` | Perekam, runner, laporan, dan selftest. Node 18+, tanpa dependensi tambahan |
| `recorder.html` | Halaman perekam yang dibuka oleh perintah `record` |
| `results/<tag>/` | `summary.md` (tabel siap tempel) dan `results.csv` (per rekaman) |
| `recordings/` | File audio. **Tidak di-commit** (diabaikan git) |

## Langkah

Semua perintah dijalankan dari folder `kasir-siluman-app`.

1. **Nyalakan Langflow dan ngrok** seperti saat demo. Runner memakai `LANGFLOW_BASE_URL`, `LANGFLOW_API_KEY`, `LANGFLOW_VOICE_TO_TRANSACTION_FLOW_ID`, dan `LANGFLOW_VOICE_STT_COMPONENT_ID` dari `.env`.
2. **Rekam.**
   ```
   node eval/voice/voice_eval.mjs record
   ```
   Buka http://localhost:5055 di Chrome, isi nama penutur (misalnya `raja`), lalu rekam kalimat satu per satu: Spasi untuk mulai/berhenti, Enter untuk simpan. Untuk 60 kalimat, perkirakan 20–30 menit.
   - **Kondisi tenang:** ruangan biasa.
   - **Kondisi bising (B01–B14):** putar video suara keramaian pasar dari HP di dekat laptop dengan volume sedang, atau rekam langsung di lapak.
   - **Penutur lain:** muat ulang halaman dan pakai nama lain. Minta izin dulu.
   - **Rekaman dari HP:** juga bisa dipakai. Simpan sebagai `eval/voice/recordings/<penutur>__<id>.<ext>`, misalnya `raja__P01.m4a`. Format yang diterima: m4a, mp3, wav, ogg, webm, dan opus dari WhatsApp.
3. **Uji asap dulu.** Rekam 1–2 kalimat, jalankan `node eval/voice/voice_eval.mjs run`, dan pastikan Langflow, Groq, dan watsonx.ai merespons.
4. **Jalankan semuanya.**
   ```
   node eval/voice/voice_eval.mjs run
   ```
   Pada uji coba, satu rekaman butuh median sekitar 13 detik, dan yang pertama bisa sampai 50 detik karena Langflow baru "bangun". Ditambah jeda 3 detik untuk batas kuota Groq, 60 rekaman selesai dalam sekitar 15–20 menit. Kalau ada yang gagal, jalankan perintah yang sama lagi; rekaman yang sudah berhasil tidak diproses ulang.
5. **Baca hasilnya** di `eval/voice/results/v1/summary.md`.

**Membandingkan versi:** setelah prompt atau flow diubah, jalankan `node eval/voice/voice_eval.mjs run v2`. Rekaman yang sama diproses ulang ke `results/v2/`, sedangkan `results/v1/` tetap utuh.

**Menyusun ulang laporan** tanpa memanggil Langflow: `node eval/voice/voice_eval.mjs report v1`. Pakai ini misalnya setelah memperbaiki nominal yang benar di `phrases.csv`.

**Setelah mengedit `phrases.csv`**, jalankan `node eval/voice/voice_eval.mjs selftest` untuk mengecek format file itu dan aturan baseline.

## Definisi

- **Nominal tepat:** `amount` dari pipeline sama persis dengan kolom `nominal`. Untuk kalimat bukan transaksi, yang benar adalah `null`.
- **Jenis ucapan tepat:** `isClosingReport` sama dengan kolom `tutup_buku`.
- **Benar penuh:** nominal dan jenis sama-sama tepat. Ini angka utama, ditampilkan dengan interval kepercayaan 95% (Wilson).
- **Baseline:** angka ditulis dengan digit (`25.000`, `25 ribu`, `15rb`) dan dengan kata (`dua puluh lima ribu`, `tiga setengah ribu`), plus kamus seceng/noceng/goceng/ceban/noban/goban/gocap/cepek. Kalau ada beberapa angka, yang diambil adalah yang terbesar. Angka di bawah 1.000 dianggap ribuan. Tutup buku dideteksi lewat kata yang sama dengan petunjuk di prompt (tutup, selesai, segitu aja, totalnya, total hari ini). Baseline tidak mengalikan jumlah barang dengan harga.
- **Ambang confidence:** berapa persen ucapan yang diterima otomatis, dan seberapa akurat yang diterima itu, kalau `confidence` dipakai sebagai ambang.

## Batasan yang perlu disebut saat presentasi

- Penutur membacakan naskah, bukan pedagang yang sedang melayani pembeli. Hasilnya cenderung lebih baik daripada kondisi lapak.
- Jumlah rekaman kecil, jadi perhatikan lebar interval kepercayaannya.
- Kalimat di kelas `tanpa-kata-ribu`, juga istilah gocap dan cepek, bergantung konteks. Lihat kolom `catatan` di `phrases.csv`.
- Setiap rekaman memakai satu panggilan Groq dan satu panggilan watsonx.ai dari kuota akunmu.
