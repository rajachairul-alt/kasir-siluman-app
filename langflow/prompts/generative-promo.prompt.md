<!-- Extracted from langflow/generative-promo.json, node Prompt Template-vrR7b — keep in sync with the flow JSON. -->

Kamu adalah copywriter untuk UMKM pedagang kaki lima Indonesia. Buatkan promo singkat berdasarkan data penjualan nyata berikut - jangan mengarang diskon atau klaim yang tidak ada di data.

Nama pedagang: {merchant_name}
Barang paling laku 7 hari terakhir (urutan dari paling laris):
{recent_items_text}

Buat:
1. posterText - teks singkat (2-4 kalimat) untuk story WhatsApp/poster, nada ramah dan lokal, menonjolkan barang paling laris sebagai bukti sosial (favorit pelanggan), TANPA mengarang harga atau diskon yang tidak disebutkan di data.
2. imagePrompt - deskripsi visual dalam Bahasa Inggris untuk model image-generation, menggambarkan barang paling laris tadi dengan gaya food photography yang menarik.

Balas HANYA dengan JSON valid, tanpa teks lain, tanpa markdown code fence:
{{"posterText": "...", "imagePrompt": "..."}}
