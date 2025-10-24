# Upload & Ingest – patch (admin + Netlify funkce)

Tento patch přidá do adminu možnost **nahrát libovolné soubory** a automaticky je převést na text,
uložit do `/text` (a volitelně originály do `/source`) a **aktualizovat `manifest.jsonl`**.
Potom můžeš postavit RAG index (jako dřív).

## Co je v balíčku
- `admin.html` – obsahuje novou kartu „Nahrát libovolné soubory“
- `admin.js` – klientská logika pro upload a volání funkce
- `netlify/functions/admin-upload-convert.js` – serverless převod + manifest

## Kam soubory dát
- Kořen repozitáře: `admin.html`, `admin.js`
- `netlify/functions/`: `admin-upload-convert.js`
- V `package.json` měj závislosti:
  ```json
  {
    "dependencies": {
      "pdf-parse": "^1.1.1",
      "mammoth": "^1.6.0"
    }
  }
  ```
  (Pokud tam nejsou, doplň je a commitni.)

## Jak použít
1) Deployni (Netlify si nainstaluje závislosti podle `package.json`).
2) Otevři `/admin.html` → Připoj read/write → vyber **cílovou složku (dataset)**.
3) Na kartě **„Nahrát libovolné soubory“** vyber soubory → „Nahrát & převést“.
   - Do datasetu se vytvoří podsložky **`/text`** a **`/source`** (pokud je máš zapnuté „uložit originály“).
   - Do kořene datasetu se aktualizuje **`manifest.jsonl`** (1 řádek = 1 soubor).
4) Karta **„Postavit/aktualizovat index“** – vytvoří/aktualizuje `rag-index.jsonl` z obsahu `/text`.
5) Karta **„Dotazovat“** – ptej se, s citacemi.

## Poznámky
- OCR fallback je zatím vypnutý (připravené zaškrtávátko). Lze doplnit přes Google Vision API nebo Tesseract.
- Manifest se vždy **přečte a celý přepíše** s přidaným řádkem (jednoduché a spolehlivé řešení pro Netlify).
