# SRE Troubleshoot Relay

Game multiplayer realtime untuk latihan troubleshooting incident ala SRE. Satu tim
menyelesaikan sebuah incident secara **bergiliran** — tiap pemain memasukkan command/
jawaban untuk satu langkah, dapat **clue bertahap**, dan setiap input **divalidasi oleh LLM**
(via [9Router](https://9router.com), OpenAI-compatible).

## Stack
- **Next.js** (App Router, `output: standalone`) — UI single-page + API route handlers
- **Postgres** (`pg`) untuk state room/pemain/log
- **9Router** (OpenAI-compatible) untuk grading jawaban — fallback keyword bila LLM down
- Realtime via **short-polling** (1.5s) — pas untuk game turn-based

## Cara main
1. Host **Buat Room** → dapat kode 6 huruf, bagikan ke tim.
2. Anggota tim **Gabung** pakai kode + nickname + karakter (emoji).
3. Host pilih skenario incident → **Mulai**.
4. Giliran berputar round-robin. Pemain yang sedang giliran mengetik command/jawaban.
   - Benar → skor naik, lanjut langkah & pemain berikutnya.
   - Salah → feedback + clue makin jelas; setelah `MAX_ATTEMPTS` jawaban dibuka & lanjut.
5. Semua langkah selesai → recap skor tim. Host bisa **Main Lagi**.

## ENV
Lihat `.env.example`:
- `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `LLM_MODEL` — endpoint 9Router (harus reachable dari server)
- `MAX_ATTEMPTS` — default 3
- `DATABASE_URL` (+ `DB_SSL`) — di nrapken di-inject otomatis saat DB di-attach

## Skenario
Data-driven di `data/scenarios.json`. Tambah case baru = tambah entри (objective, clues
bertahap, expected, keywords untuk fallback).

## Lokal
```bash
npm install
cp .env.example .env   # isi nilainya
npm run build && npm start
```
