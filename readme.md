# FIN Chat Light+ (MVP s odkazy a přepisem audia)

Rozšíření o:
- **Externí odkazy (URL)** – server stáhne stránku a extrahuje hlavní text.
- **Přepis audia z Google Drive** (mp3/mp4/m4a) přes OpenAI Whisper → text, který se zapojí do dotazování.

## Nové endpointy
- `/.netlify/functions/ingest` – `POST { url }` → `{ title, url, content, snippet }`
- `/.netlify/functions/transcribe` – `POST { fileId, driveAccessToken }` → `{ title, url, content, snippet }`

> YouTube/Vimeo: používáme odkazované webové stránky nebo veřejně dostupné transcript‑stránky. Samotné video nestahujeme (respekt TOS). Pokud potřebujete zvuk, nahrajte jej do Drive a použijte **Přepis audia**.

## Konfigurace
Doplňte `config.js` (viz `config.example.js`).

## Proměnné prostředí
`OPENAI_API_KEY` – pro Chat Completions i Whisper (audio transcriptions).
