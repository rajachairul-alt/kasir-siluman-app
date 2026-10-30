# Uji Akurasi Pipeline Suara Kasir Siluman (v1)

Dibuat 2026-10-30 dengan `eval/voice/voice_eval.mjs`. 55 rekaman dari raja (55); 46 kondisi tenang dan 9 kondisi bising.
Penutur membacakan kalimat dari `phrases.csv`. Ini **bukan** rekaman transaksi pedagang asli.

5 rekaman belum punya hasil karena gagal diproses, dan tidak dihitung di bawah.

## Ringkasan

| | Pipeline (Whisper + Granite) | Baseline (regex + kamus, tanpa model bahasa) |
|---|---|---|
| Nominal tepat | 36/55 (65%) | 36/55 (65%) |
| Jenis ucapan tepat (transaksi / tutup buku) | 52/55 (95%) | 51/55 (93%) |
| **Benar penuh** (nominal dan jenis) | **35/55 (64%)**, CI 95% 50–75% | 33/55 (60%), CI 95% 47–72% |

Baseline dijalankan pada transkrip Whisper yang sama, jadi selisih keduanya adalah sumbangan Granite dalam menafsirkan ucapan. Kalau Whisper salah dengar, keduanya ikut salah. CI 95% memakai interval Wilson.

## Per kelas angka

| Kelas | n | Pipeline benar penuh | Baseline benar penuh | Confidence rata-rata |
|---|---|---|---|---|
| angka-lengkap | 12 | 10/12 (83%) | 10/12 (83%) | 0.78 |
| istilah-pasar | 9 | 3/9 (33%) | 4/9 (44%) | 0.49 |
| ratusan-setengah | 6 | 3/6 (50%) | 4/6 (67%) | 0.60 |
| tutup-buku | 8 | 7/8 (88%) | 6/8 (75%) | 0.81 |
| bukan-transaksi | 7 | 6/7 (86%) | 5/7 (71%) | 0.00 |
| tanpa-kata-ribu | 4 | 3/4 (75%) | 2/4 (50%) | 0.90 |
| kali-jumlah | 6 | 1/6 (17%) | 0/6 (0%) | 0.75 |
| nominal-besar | 3 | 2/3 (67%) | 2/3 (67%) | 0.90 |

## Per kondisi

| Kondisi | n | Pipeline benar penuh | Baseline benar penuh |
|---|---|---|---|
| bising | 9 | 4/9 (44%) | 4/9 (44%) |
| tenang | 46 | 31/46 (67%) | 29/46 (63%) |

## Kalau confidence dipakai sebagai ambang

Dihitung dari ucapan yang menghasilkan nominal. Ucapan di bawah ambang bisa dimintakan konfirmasi ke pedagang (rencana B2, belum ada di aplikasi).

| Ambang | Diterima otomatis | Benar di antara yang diterima |
|---|---|---|
| tanpa ambang | 37/37 (100%) | 29/37 (78%) |
| ≥ 0.5 | 37/37 (100%) | 29/37 (78%) |
| ≥ 0.7 | 37/37 (100%) | 29/37 (78%) |
| ≥ 0.9 | 37/37 (100%) | 29/37 (78%) |

## Waktu proses

Median 15.5 detik, p90 53.0 detik per rekaman (unggah ke Langflow, Whisper, Granite).

## Kesalahan pipeline

| Rekaman | Ucapan | Harapan | Hasil pipeline | Transkrip Whisper |
|---|---|---|---|---|
| raja__B01 | Es teh lima ribu | Rp5.000 | null | Estekli Maríku. |
| raja__B03 | Mie ayam lima belas ribu | Rp15.000 | null | Mér alam lima blessur í þiggin. |
| raja__B04 | Nasi bungkus goceng | Rp5.000 | null | Naci, bungkus, kocen |
| raja__P12 | Es kelapa ceban | Rp10.000 | null | Eskelapa jepen |
| raja__P14 | Martabak manis noban | Rp20.000 | null | Martabak Manis Nalban |
| raja__P15 | Es batu noceng | Rp2.000 | Rp9.000 | es batu nocek |
| raja__P17 | Nasi kotak gocap | Rp50.000 | null | nasi kotak gocak |
| raja__P19 | Teh tarik tiga ribu lima ratus | Rp3.500 | Rp37.500 | teh tarik tiga libu rima ratus |
| raja__P20 | Cilok seribu lima ratus | Rp1.500 | null | cilok seribu lima radus |
| raja__P21 | Es campur tujuh setengah | Rp7.500 | null | es campur tujuh setengah |
| raja__P25 | Kopi susu dua belas | Rp12.000 | Rp10.000 | Kopi susu dua pulas |
| raja__P28 | Es teh tiga, masing-masing lima ribu | Rp15.000 | Rp5.000 | ST3 masing-masing 5.000 |
| raja__P32 | Kopi dua, tiga ribuan | Rp6.000 | Rp3.000 | Kopi dua tiga ribuan. |
| raja__P34 | Tumpeng seratus dua puluh ribu | Rp120.000 | tutup buku Rp122.000 | Tumpung seratus dua puluh ribu |
| raja__P46 | Tutup dulu payungnya, mau hujan | null | tutup buku null | tutup dulu payungnya mau hujan |
| raja__B10 | Bakso dua mangkok, semangkok lima belas ribu | Rp30.000 | null | Pak, selalu tua man kok, lima plus lukis. |
| raja__B12 | Segitu aja hari ini, total lima ratus dua puluh ribu | tutup buku Rp520.000 | null | Gitu Eka Harini, að kalli maratu, keupulihrisu. |
| raja__P16 | Ayam bakar sepaket goban | Rp50.000 | null | ayam bakar sepaket goban |
| raja__P29 | Nasi bungkus goceng dua | Rp10.000 | Rp20.000 | Nasi bungkus kojeng 2 |
| raja__P30 | Bakso dua mangkok, semangkok lima belas ribu | Rp30.000 | Rp15.000 | pak su dua mangkok semangkok lima belas ribu |
