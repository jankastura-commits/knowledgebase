// Admin JS with Upload & Ingest
let tokenRead=null, tokenWrite=null, srcFolder=null, dstFolder=null;

function ensureReady(){
  if (!window.CONFIG) { alert('Config se ještě nenačetl. Zkus to za vteřinu.'); return false; }
  return true;
}

function connectRead(){
  const c = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    callback: (r)=>{ tokenRead=r.access_token; alert('Připojeno (read)'); }
  });
  c.requestAccessToken();
}
function connectWrite(){
  const c = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/drive.file',
    callback: (r)=>{ tokenWrite=r.access_token; alert('Připojeno (write)'); }
  });
  c.requestAccessToken();
}
function pickSource(){
  if(!tokenRead) return alert('Nejprve Připojit (read)');
  gapi.load('picker', ()=>{
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true);
    const picker = new google.picker.PickerBuilder().setOAuthToken(tokenRead).setDeveloperKey(CONFIG.GOOGLE_API_KEY).addView(view)
      .setTitle('Vyber zdrojovou složku').setCallback(d=>{
        if(d.action===google.picker.Action.PICKED){ srcFolder={id:d.docs[0].id, name:d.docs[0].name}; document.getElementById('srcLbl').textContent = `${srcFolder.name} (${srcFolder.id})`; }
      }).build();
    picker.setVisible(true);
  });
}
function pickDest(){
  if(!tokenRead) return alert('Nejprve Připojit (read)');
  gapi.load('picker', ()=>{
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true);
    const picker = new google.picker.PickerBuilder().setOAuthToken(tokenRead).setDeveloperKey(CONFIG.GOOGLE_API_KEY).addView(view)
      .setTitle('Vyber cílovou složku (dataset)').setCallback(d=>{
        if(d.action===google.picker.Action.PICKED){ dstFolder={id:d.docs[0].id, name:d.docs[0].name}; document.getElementById('dstLbl').textContent = `${dstFolder.name} (${dstFolder.id})`; }
      }).build();
    picker.setVisible(true);
  });
}

// ============ Upload & Ingest ============
const filePick = ()=> document.getElementById('filePick');
filePick().addEventListener('change', () => {
  const list = document.getElementById('uploadList');
  const rows = [...filePick().files].map(f => `• ${f.name} (${Math.round(f.size/1024)} kB)`);
  list.innerHTML = rows.length ? rows.join('<br>') : '—';
});

function toBase64(buf){
  // Browser: convert ArrayBuffer → base64
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i=0;i<bytes.length;i+=chunkSize){
    binary += String.fromCharCode.apply(null, bytes.subarray(i,i+chunkSize));
  }
  return btoa(binary);
}

async function startUploadConvert(){
  if(!dstFolder) return alert('Vyber cílovou složku (dataset).');
  if(!tokenWrite) return alert('Připoj (write).');
  const saveOriginal = document.getElementById('saveOriginal').checked;
  const asGDoc = document.getElementById('asGDoc').checked;
  const useOCR = document.getElementById('useOCR').checked; // momentálně neaktivní

  const files = [...filePick().files];
  if (!files.length) return alert('Vyber soubory.');

  const log = document.getElementById('uploadLog');
  log.textContent = `Odesílám ${files.length} souborů…\n`;

  // limituj paralelismus
  const POOL = 2;
  const queue = files.map(f=>f);
  async function runOne(file){
    log.textContent += `• ${file.name} …\n`;
    try{
      const arrayBuf = await file.arrayBuffer();
      const r = await fetch('/.netlify/functions/admin-upload-convert', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+tokenWrite },
        body: JSON.stringify({
          destFolderId: dstFolder.id,
          fileName: file.name,
          mimeType: file.type || null,
          dataBase64: toBase64(arrayBuf),
          options: { saveOriginal, asGDoc, useOCR }
        })
      });
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || r.statusText);
      log.textContent += `  ✔ ${j.outputName} (manifest aktualizován)\n`;
    }catch(e){
      log.textContent += `  ✖ Chyba: ${e.message}\n`;
    }
  }
  const workers = Array.from({length:Math.min(POOL, queue.length)}, async ()=>{
    while(queue.length){ await runOne(queue.shift()); }
  });
  await Promise.all(workers);
  log.textContent += '\nHotovo. Nyní můžeš „Postavit/aktualizovat index“.\n';
}

// ============ Index & Chat (zůstává stejné) ============
async function buildIndex(){
  if(!dstFolder) return alert('Vyber cílovou složku (tam se uloží index).');
  if(!tokenWrite) return alert('Připoj (write).');
  const chunkSize = parseInt(document.getElementById('chunkSize').value||'1500',10);
  const chunkOverlap = parseInt(document.getElementById('chunkOverlap').value||'200',10);
  const log = document.getElementById('indexLog');
  log.textContent = 'Stavím index…\n';
  const r = await fetch('/.netlify/functions/rag-build-index', {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+tokenWrite},
    body: JSON.stringify({ folderId: dstFolder.id, chunkSize, chunkOverlap })
  });
  const j = await r.json();
  if(!r.ok){ log.textContent += 'Chyba: '+(j.error||r.statusText); return; }
  log.textContent += `✔ Index hotový (chunks: ${j.chunks}).`;
}

async function ask(){
  if(!dstFolder) return alert('Vyber cílovou složku (kde je index).');
  if(!tokenRead) return alert('Připoj (read).');
  const q = document.getElementById('q').value.trim();
  const topK = parseInt(document.getElementById('topK').value||'6',10);
  if(!q) return;
  const out = document.getElementById('ans');
  out.textContent = 'Přemýšlím…';
  const r = await fetch('/.netlify/functions/rag-query', {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+tokenRead},
    body: JSON.stringify({ folderId: dstFolder.id, question: q, topK })
  });
  const j = await r.json();
  if(!r.ok){ out.textContent = 'Chyba: '+(j.error||r.statusText); return; }
  const cites = (j.citations||[]).map(c=>`[${c.ref}] ${c.file}`).join('\n');
  out.textContent = j.answer + (cites ? `\n\nZdroje:\n${cites}` : '');
}

// expose
window.connectRead = connectRead;
window.connectWrite = connectWrite;
window.pickSource = pickSource;
window.pickDest = pickDest;
window.startUploadConvert = startUploadConvert;
window.buildIndex = buildIndex;
window.ask = ask;
