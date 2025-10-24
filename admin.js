// === admin.js (čistá verze) ===

// Globální stav (jediná deklarace)
let tokenRead = null;
let tokenWrite = null;
let srcFolder = null;
let dstFolder = null;

function getEl(id){ return document.getElementById(id); }

function ensureConfig(){
  if (!window.CONFIG) { alert('Config se ještě nenačetl.'); return false; }
  if (!CONFIG.GOOGLE_CLIENT_ID) { alert('Chybí GOOGLE_CLIENT_ID (Netlify env).'); return false; }
  if (!CONFIG.GOOGLE_API_KEY)   { alert('Chybí GOOGLE_API_KEY (Netlify env).'); return false; }
  return true;
}
async function waitForGIS(maxMs=8000){
  const t0=Date.now(); return new Promise((res,rej)=>{(function tick(){
    if (window.google && google.accounts && google.accounts.oauth2) return res();
    if (Date.now()-t0>maxMs) return rej(new Error('Google Identity Services se nenačetly.'));
    setTimeout(tick,120);
  })()});
}
function openFolderPicker(oauthToken, onPick){
  gapi.load('picker', ()=>{
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true).setSelectFolderEnabled(true);
    const picker = new google.picker.PickerBuilder()
      .setTitle('Vyber složku').addView(view)
      .setOAuthToken(oauthToken).setDeveloperKey(CONFIG.GOOGLE_API_KEY)
      .setCallback(d=>{
        if(d.action===google.picker.Action.PICKED){
          const x=d.docs[0]; onPick({id:x.id,name:x.name});
        }
      }).build();
    picker.setVisible(true);
  });
}

// Připojit read/write
async function connectRead(){
  try{
    if(!ensureConfig()) return; await waitForGIS();
    const c = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      prompt: 'consent',
      callback: (r)=>{ if(!r?.access_token) return alert('Nepřišel access_token (read)'); tokenRead=r.access_token; alert('Připojeno (read)'); }
    }); c.requestAccessToken();
  }catch(e){ alert('Chyba READ: '+e.message); }
}
async function connectWrite(){
  try{
    if(!ensureConfig()) return; await waitForGIS();
    const c = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      prompt: 'consent',
      callback: (r)=>{ if(!r?.access_token) return alert('Nepřišel access_token (write)'); tokenWrite=r.access_token; alert('Připojeno (write)'); }
    }); c.requestAccessToken();
  }catch(e){ alert('Chyba WRITE: '+e.message); }
}

// Výběr složek
function pickSource(){
  if(!tokenRead) return alert('Nejdřív „Připojit (read)“.');
  openFolderPicker(tokenRead, f=>{ srcFolder=f; getEl('srcLbl').textContent = `${f.name} (${f.id})`; });
}
function pickDest(){
  if(!tokenRead) return alert('Nejdřív „Připojit (read)“.');
  openFolderPicker(tokenRead, f=>{ dstFolder=f; getEl('dstLbl').textContent = `${f.name} (${f.id})`; });
}

// Upload & převod (lokální soubory)
const fileInput = getEl('filePick');
if (fileInput) {
  fileInput.addEventListener('change', () => {
    const list = getEl('uploadList');
    const files = [...fileInput.files];
    const rows = files.map(f => `• ${f.name} (${Math.round(f.size/1024)} kB)`);
    if (list) list.innerHTML = rows.length ? rows.join('<br>') : '—';
  });
}
function toBase64(buf){
  let binary=''; const bytes=new Uint8Array(buf); const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk){
    binary += String.fromCharCode.apply(null, bytes.subarray(i,i+chunk));
  }
  return btoa(binary);
}
async function startUploadConvert(){
  if(!dstFolder)  return alert('Vyber cílovou složku (dataset).');
  if(!tokenWrite) return alert('Nejdřív „Připojit (write)“.');
  if(!fileInput || !fileInput.files?.length) return alert('Vyber soubory.');

  const saveOriginal = !!getEl('saveOriginal')?.checked;
  const asGDoc       = !!getEl('asGDoc')?.checked;
  const useOCR       = !!getEl('useOCR')?.checked;

  const log = getEl('uploadLog'); if (log) log.textContent = `Odesílám ${fileInput.files.length} souborů…\n`;

  const files=[...fileInput.files], POOL=2, queue=files.slice();
  async function runOne(file){
    log && (log.textContent += `• ${file.name} …\n`);
    try{
      const buf = await file.arrayBuffer();
      const r = await fetch('/.netlify/functions/admin-upload-convert', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+tokenWrite},
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
    }catch(e){ log && (log.textContent += `  ✖ Chyba: ${e.message}\n`); }
  }
  const workers = Array.from({length:Math.min(POOL, queue.length)}, async ()=>{ while(queue.length){ await runOne(queue.shift()); }});
  await Promise.all(workers);
  log && (log.textContent += '\nHotovo. Nyní můžeš „Postavit/aktualizovat index“.\n');
}

// Ingest celé zdrojové složky (Drive → Cíl)
async function listDriveFiles(folderId, token) {
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.search = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,size)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    pageSize: '1000'
  }).toString();
  const r = await fetch(url, { headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok) throw new Error('Drive list failed: '+r.status);
  const j = await r.json(); return j.files || [];
}
async function downloadFileToBase64(file, token) {
  const isGDoc   = file.mimeType === 'application/vnd.google-apps.document';
  const isGSheet = file.mimeType === 'application/vnd.google-apps.spreadsheet';
  const isGSlide = file.mimeType === 'application/vnd.google-apps.presentation';

  let url, contentType;
  if (isGDoc) { url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`; contentType='text/plain'; }
  else if (isGSheet || isGSlide) { throw new Error('Sheets/Slides aktuálně přeskočeny'); }
  else { url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`; contentType = file.mimeType || 'application/octet-stream'; }

  const r = await fetch(url, { headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok) throw new Error('Download failed: '+r.status);
  const buf = await r.arrayBuffer();
  // → base64
  let binary=''; const bytes=new Uint8Array(buf); const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk){ binary += String.fromCharCode.apply(null, bytes.subarray(i,i+chunk)); }
  return { base64:btoa(binary), contentType };
}
async function startIngestFromSource() {
  if(!srcFolder)  return alert('Vyber zdrojovou složku.');
  if(!dstFolder)  return alert('Vyber cílovou složku (dataset).');
  if(!tokenRead)  return alert('Klikni „Připojit (read)“.');
  if(!tokenWrite) return alert('Klikni „Připojit (write)“.');

  const saveOriginal = !!getEl('saveOriginal')?.checked;
  const asGDoc       = !!getEl('asGDoc')?.checked;
  const useOCR       = !!getEl('useOCR')?.checked;

  const log = getEl('uploadLog'); const listBox = getEl('uploadList');
  log && (log.textContent = 'Načítám obsah zdrojové složky…\n');

  try{
    const files = await listDriveFiles(srcFolder.id, tokenRead);
    listBox && (listBox.textContent = files.length ? files.map(f=>`• ${f.name} (${f.mimeType||'?'})`).join('\n') : '—');

    const POOL=2, queue=files.slice();
    async function processOne(file){
      try{
        if(file.mimeType === 'application/vnd.google-apps.folder'){ log && (log.textContent += `✖ Přeskočeno (složka): ${file.name}\n`); return; }
        const { base64, contentType } = await downloadFileToBase64(file, tokenRead);
        const r = await fetch('/.netlify/functions/admin-upload-convert', {
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+tokenWrite},
          body: JSON.stringify({
            destFolderId: dstFolder.id,
            fileName: file.name,
            mimeType: contentType,
            dataBase64: base64,
            options: { saveOriginal, asGDoc, useOCR }
          })
        });
        const j = await r.json(); if(!r.ok) throw new Error(j.error || r.statusText);
        log && (log.textContent += `✔ ${file.name} → ${j.outputName}\n`);
      }catch(e){ log && (log.textContent += `✖ ${file.name}: ${e.message}\n`); }
    }
    const workers = Array.from({length:Math.min(POOL,queue.length)}, async ()=>{ while(queue.length){ await processOne(queue.shift()); }});
    await Promise.all(workers);
    log && (log.textContent += '\nHotovo. Teď klikni „Postavit/aktualizovat index“.\n');
  }catch(e){
    log && (log.textContent += 'Chyba při načítání: '+e.message+'\n'); alert('Chyba: '+e.message);
  }
}

// === buildIndex (posílá Authorization + vypíše token do konzole) ===
async function buildIndex(){
  if(!dstFolder)  return alert('Vyber cílovou složku (tam se uloží index).');
  if(!tokenWrite) return alert('Nejdřív „Připojit (write)“.');

  const chunkSize    = parseInt(document.getElementById('chunkSize')?.value || '1500', 10);
  const chunkOverlap = parseInt(document.getElementById('chunkOverlap')?.value || '200', 10);
  const log = document.getElementById('indexLog');
  if (log) log.textContent = 'Stavím index…\n';

  // DEBUG: ukaž, že máme token
  console.log('[buildIndex] tokenWrite length:', (tokenWrite||'').length);
  console.log('[buildIndex] dstFolder.id:', dstFolder?.id);

  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 60000);

  try{
    const r = await fetch('/.netlify/functions/rag-build-index', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer ' + tokenWrite   // <<< TADY se posílá OAuth token
      },
      body: JSON.stringify({ folderId: dstFolder.id, chunkSize, chunkOverlap }),
      signal: ctrl.signal
    });
    clearTimeout(t);

    // vždy čti jako text a zkus JSON – ať se chyba nikdy "neschová"
    const raw = await r.text();
    let j=null; try{ j=JSON.parse(raw); } catch {}
    if(!r.ok){
      const msg = (j && (j.error?.message || j.error)) || raw || r.statusText || ('HTTP '+r.status);
      log && (log.textContent += 'Chyba: ' + msg);
      console.error('[buildIndex] ERROR', msg);
      return;
    }
    const chunks = j?.chunks ?? '(neznámé)';
    log && (log.textContent += `✔ Index hotový (chunks: ${chunks}).`);
  }catch(e){
    log && (log.textContent += `Chyba: ${e.name==='AbortError'?'časový limit vypršel':e.message}`);
    console.error('[buildIndex] CATCH', e);
  }
}


// Dotazování
async function ask(){
  if(!dstFolder) return alert('Vyber cílovou složku (kde je index).');
  if(!tokenRead)  return alert('Nejdřív „Připojit (read)“.');
  const q=(getEl('q')?.value||'').trim(); const topK=parseInt(getEl('topK')?.value||'6',10); if(!q) return;
  const out=getEl('ans'); out && (out.textContent='Přemýšlím…');

  const r = await fetch('/.netlify/functions/rag-query', {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+tokenRead},
    body: JSON.stringify({ folderId: dstFolder.id, question: q, topK })
  });
  const j = await r.json(); if(!r.ok){ out && (out.textContent='Chyba: '+(j.error||r.statusText)); return; }
  const cites=(j.citations||[]).map(c=>`[${c.ref}] ${c.file}`).join('\n');
  out && (out.textContent = j.answer + (cites?`\n\nZdroje:\n${cites}`:''));
}

// Expose
window.connectRead=connectRead;
window.connectWrite=connectWrite;
window.pickSource=pickSource;
window.pickDest=pickDest;
window.startUploadConvert=startUploadConvert;
window.startIngestFromSource=startIngestFromSource;
window.buildIndex=buildIndex;
window.ask=ask;
