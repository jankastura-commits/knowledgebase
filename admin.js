// === admin.js (čistá verze) ===

// --- Globální stav (jedna jediná deklarace) ---
let tokenRead = null;
let tokenWrite = null;
let srcFolder = null;
let dstFolder = null;

// --- Helpers ---
function getEl(id){ return document.getElementById(id); }

function ensureConfig(){
  if (!window.CONFIG) { alert('Config se ještě nenačetl (/.netlify/functions/public-config).'); return false; }
  if (!CONFIG.GOOGLE_CLIENT_ID) { alert('Chybí GOOGLE_CLIENT_ID (Netlify env).'); return false; }
  if (!CONFIG.GOOGLE_API_KEY)   { alert('Chybí GOOGLE_API_KEY (Netlify env).'); return false; }
  return true;
}

async function waitForGIS(maxMs=8000){
  const t0 = Date.now();
  return new Promise((res, rej)=>{
    (function tick(){
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      if (Date.now()-t0 > maxMs) return rej(new Error('Google Identity Services se nenačetly.'));
      setTimeout(tick,120);
    })();
  });
}

function openFolderPicker(oauthToken, onPick){
  gapi.load('picker', () => {
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true).setSelectFolderEnabled(true);
    const picker = new google.picker.PickerBuilder()
      .setTitle('Vyber složku')
      .addView(view)
      .setOAuthToken(oauthToken)
      .setDeveloperKey(CONFIG.GOOGLE_API_KEY)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const d = data.docs[0];
          onPick({ id: d.id, name: d.name });
        }
      })
      .build();
    picker.setVisible(true);
  });
}

// --- Připojení k Drive (read/write) ---
async function connectRead(){
  try{
    if (!ensureConfig()) return;
    await waitForGIS();
    const c = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      prompt: 'consent',
      callback: (r)=>{ if(!r?.access_token) return alert('Nepřišel access_token (read)'); tokenRead=r.access_token; alert('Připojeno (read)'); }
    });
    c.requestAccessToken();
  }catch(e){ alert('Chyba READ: '+e.message); }
}

async function connectWrite(){
  try{
    if (!ensureConfig()) return;
    await waitForGIS();
    const c = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      prompt: 'consent',
      callback: (r)=>{ if(!r?.access_token) return alert('Nepřišel access_token (write)'); tokenWrite=r.access_token; alert('Připojeno (write)'); }
    });
    c.requestAccessToken();
  }catch(e){ alert('Chyba WRITE: '+e.message); }
}

// --- Výběr složek ---
function pickSource(){
  if(!tokenRead) return alert('Nejdřív „Připojit (read)“.');
  openFolderPicker(tokenRead, (f)=>{
    srcFolder = f;
    const el = getEl('srcLbl'); if (el) el.textContent = `${f.name} (${f.id})`;
  });
}

function pickDest(){
  if(!tokenRead) return alert('Nejdřív „Připojit (read)“.');
  openFolderPicker(tokenRead, (f)=>{
    dstFolder = f;
    const el = getEl('dstLbl'); if (el) el.textContent = `${f.name} (${f.id})`;
  });
}

// --- Upload & Ingest (volá Netlify funkci admin-upload-convert) ---
const fileInput = getEl('filePick');
if (fileInput) {
  fileInput.addEventListener('change', () => {
    const list = getEl('uploadList');
    const files = [...fileInput.files];
    const rows = files.map(f => `• ${f.name} (${Math.round(f.size/1024)} kB)`);
    if (list) list.innerHTML = rows.length ? rows.join('<br>') : '—';
  });
}

function toBase64(arrayBuffer){
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  for (let i=0; i<bytes.length; i+=chunkSize){
    binary += String.fromCharCode.apply(null, bytes.subarray(i,i+chunkSize));
  }
  return btoa(binary);
}

async function startUploadConvert(){
  if(!dstFolder)  return alert('Vyber cílovou složku (dataset).');
  if(!tokenWrite) return alert('Nejdřív „Připojit (write)“.');
  if(!fileInput || !fileInput.files?.length) return alert('Vyber soubory.');

  const saveOriginal = !!getEl('saveOriginal')?.checked;
  const asGDoc       = !!getEl('asGDoc')?.checked;
  const useOCR       = !!getEl('useOCR')?.checked; // zatím neaktivní

  const log = getEl('uploadLog'); if (log) log.textContent = `Odesílám ${fileInput.files.length} souborů…\n`;

  const files = [...fileInput.files];
  const POOL = 2;
  const queue = files.slice();

  async function runOne(file){
    log && (log.textContent += `• ${file.name} …\n`);
    try{
      const buf = await file.arrayBuffer();
      const r = await fetch('/.netlify/functions/admin-upload-convert', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+tokenWrite },
        body: JSON.stringify({
          destFolderId: dstFolder.id,
          fileName: file.name,
          mimeType: file.type || null,
          dataBase64: toBase64(buf),
          options: { saveOriginal, asGDoc, useOCR }
        })
      });
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || r.statusText);
      log && (log.textContent += `  ✔ ${j.outputName} (manifest aktualizován)\n`);
    }catch(e){
      log && (log.textContent += `  ✖ Chyba: ${e.message}\n`);
    }
  }

  const workers = Array.from({length:Math.min(POOL, queue.length)}, async ()=>{
    while(queue.length){ await runOne(queue.shift()); }
  });
  await Promise.all(workers);

  log && (log.textContent += '\nHotovo. Nyní můžeš „Postavit/aktualizovat index“.\n');
}

// --- Build index (rag-build-index) ---
async function buildIndex(){
  if(!dstFolder)  return alert('Vyber cílovou složku (tam se uloží index).');
  if(!tokenWrite) return alert('Nejdřív „Připojit (write)“.');

  const chunkSize    = parseInt(document.getElementById('chunkSize')?.value || '1500', 10);
  const chunkOverlap = parseInt(document.getElementById('chunkOverlap')?.value || '200', 10);
  const log = document.getElementById('indexLog');
  if (log) log.textContent = 'Stavím index…\n';

  // 60s timeout, ať UI nikdy nezůstane viset
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 60000);

  try{
    const r = await fetch('/.netlify/functions/rag-build-index', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tokenWrite},
      body: JSON.stringify({ folderId: dstFolder.id, chunkSize, chunkOverlap }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    const j = await r.json().catch(()=> ({}));
    if(!r.ok){
      log && (log.textContent += 'Chyba: '+(j.error?.message || j.error || r.statusText));
      return;
    }
    log && (log.textContent += `✔ Index hotový (chunks: ${j.chunks}).`);
  }catch(e){
    log && (log.textContent += `Chyba: ${e.name==='AbortError'?'časový limit vypršel':' '+e.message}\nZkus znovu nebo použij background verzi (viz níže).`);
  }
}

// --- Dotazování (rag-query) ---
async function ask(){
  if(!dstFolder) return alert('Vyber cílovou složku (kde je index).');
  if(!tokenRead)  return alert('Nejdřív „Připojit (read)“.');

  const q    = (getEl('q')?.value || '').trim();
  const topK = parseInt(getEl('topK')?.value || '6', 10);
  if(!q) return;

  const out = getEl('ans'); if (out) out.textContent = 'Přemýšlím…';

  const r = await fetch('/.netlify/functions/rag-query', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+tokenRead },
    body: JSON.stringify({ folderId: dstFolder.id, question: q, topK })
  });
  const j = await r.json();
  if(!r.ok){ out && (out.textContent = 'Chyba: ' + (j.error||r.statusText)); return; }

  const cites = (j.citations||[]).map(c=>`[${c.ref}] ${c.file}`).join('\n');
  out && (out.textContent = j.answer + (cites ? `\n\nZdroje:\n${cites}` : ''));
}

// --- Export do window pro onclick v HTML ---
window.connectRead = connectRead;
window.connectWrite = connectWrite;
window.pickSource = pickSource;
window.pickDest = pickDest;
window.startUploadConvert = startUploadConvert;
window.buildIndex = buildIndex;
window.ask = ask;

// === /admin.js ===
