(() => {
  const cfg = window.APP_CONFIG || {};
  const state = { token:null, files:[], filtered:[], selectedIds:new Set(), linkContexts:[] };
  const els = {
    folderIdCode:document.getElementById("folderIdCode"),
    fileList:document.getElementById("fileList"),
    searchInput:document.getElementById("searchInput"),
    mimeFilter:document.getElementById("mimeFilter"),
    signinBtn:document.getElementById("signinBtn"),
    refreshBtn:document.getElementById("refreshBtn"),
    status:document.getElementById("status"),
    messages:document.getElementById("messages"),
    form:document.getElementById("chatForm"),
    question:document.getElementById("question"),
    citations:document.getElementById("citations"),
    urlInput:document.getElementById("urlInput"),
    addUrlBtn:document.getElementById("addUrlBtn"),
    urlList:document.getElementById("urlList"),
    driveFileId:document.getElementById("driveFileId"),
    transcribeBtn:document.getElementById("transcribeBtn"),
  };
  function logStatus(m){ const ts=new Date().toLocaleTimeString(); els.status.textContent = `[${ts}] ${m}\n` + els.status.textContent; }
  function renderFiles(list){ els.fileList.innerHTML=""; list.forEach(f=>{ const li=document.createElement("li"); li.className="file"; li.innerHTML=`<label style='display:flex;gap:8px;align-items:flex-start'><input type='checkbox' ${(state.selectedIds.has(f.id)?"checked":"")} data-id='${f.id}'><div><div class='name'>${f.name}</div><div class='meta'>${f.mimeType} · ${new Date(f.modifiedTime).toLocaleDateString()} · ${(f.size?(f.size/1024).toFixed(0)+' kB':'')}</div></div></label>`; li.querySelector("input").addEventListener("change",(e)=>{const id=e.target.getAttribute("data-id"); if(e.target.checked) state.selectedIds.add(id); else state.selectedIds.delete(id);}); els.fileList.appendChild(li); }); }
  function renderUrlList(){ els.urlList.innerHTML=""; state.linkContexts.forEach((c,i)=>{ const li=document.createElement("li"); li.className="file"; li.innerHTML=`<div class='name'>[${i+1}] ${c.title||c.url}</div><div class='meta'>${c.url}</div>`; els.urlList.appendChild(li); }); }
  function applyFilters(){ const q=(els.searchInput.value||"").toLowerCase(); const mime=els.mimeFilter.value; const list=state.files.filter(f=>f.name.toLowerCase().includes(q)&&(!mime||f.mimeType===mime)); state.filtered=list; renderFiles(list); }
  async function listFilesInFolder(folderId){ const q=encodeURIComponent(`'${folderId}' in parents and trashed=false`); const fields=encodeURIComponent("files(id,name,mimeType,modifiedTime,size)"); const url=`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=200&orderBy=modifiedTime desc`; const res=await fetch(url,{headers:{Authorization:"Bearer "+state.token}}); if(!res.ok) throw new Error("Drive list failed: "+await res.text()); const data=await res.json(); state.files=data.files||[]; state.selectedIds=new Set(state.files.slice(0,8).map(f=>f.id)); logStatus("Načteno souborů: "+state.files.length); applyFilters(); }
  async function fetchFileText(file){
    if(file.mimeType==="application/vnd.google-apps.document"){
      const url=`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`;
      const r=await fetch(url,{headers:{Authorization:"Bearer "+state.token}});
      if(!r.ok) throw new Error("Export failed: "+await r.text()); return await r.text();
    }
    if(["text/plain","text/markdown","application/json"].includes(file.mimeType)){
      const url=`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
      const r=await fetch(url,{headers:{Authorization:"Bearer "+state.token}});
      if(!r.ok) throw new Error("Download failed: "+await r.text()); return await r.text();
    }
    if(file.mimeType==="application/pdf"){
      const r=await fetch(cfg.EXTRACT_PDF_ENDPOINT||"/.netlify/functions/extract-pdf",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileId:file.id,driveAccessToken:state.token})});
      if(!r.ok) throw new Error("PDF extract failed: "+await r.text()); const data=await r.json(); return data.content||"";
    }
    return "";
  }
  async function getSelectedContexts(){
    const ids=[...state.selectedIds];
    const keep=new Set((cfg.MIME_WHITELIST&&cfg.MIME_WHITELIST.length?cfg.MIME_WHITELIST:["application/vnd.google-apps.document","text/plain","text/markdown","application/json","application/pdf"]));
    const files=state.files.filter(f=>ids.includes(f.id)&&keep.has(f.mimeType));
    const ctx=[]; for(const f of files){ try{ const text=await fetchFileText(f); const clean=text.replace(/\s+/g," ").slice(0,16000); if(clean.trim()){ ctx.push({id:f.id,title:f.name,mimeType:f.mimeType,url:f.mimeType.startsWith("application/vnd.google-apps")?`https://docs.google.com/document/d/${f.id}/edit`:`https://drive.google.com/file/d/${f.id}/view`,content:clean}); } }catch(e){ logStatus("Soubor přeskočen: "+f.name+" ("+e.message+")"); } } return ctx.slice(0,16);
  }
  function addMessage(role,text){ const div=document.createElement("div"); div.className="msg "+(role==="user"?"user":"bot"); div.textContent=text; els.messages.appendChild(div); els.messages.scrollTop=els.messages.scrollHeight; }
  function renderCitations(items){ els.citations.innerHTML=""; items.forEach((c,i)=>{ const el=document.createElement("div"); el.className="cite"; el.innerHTML=`<div class='title'>[${i+1}] ${c.title}</div><div class='meta'><a href='${c.url}' target='_blank'>Otevřít zdroj</a></div><div class='snippet'>${(c.snippet||"").slice(0,300)}</div>`; els.citations.appendChild(el); }); }
  let tokenClient=null; function initAuth(){ els.folderIdCode.textContent=cfg.GOOGLE_DRIVE_FOLDER_ID||"(nenastaveno)"; tokenClient=google.accounts.oauth2.initTokenClient({client_id:cfg.GOOGLE_CLIENT_ID,scope:"https://www.googleapis.com/auth/drive.readonly",callback:async (t)=>{ state.token=t.access_token; logStatus("Přihlášení OK"); if(cfg.GOOGLE_DRIVE_FOLDER_ID){ await listFilesInFolder(cfg.GOOGLE_DRIVE_FOLDER_ID);} else { logStatus("⚠️ Nastavte GOOGLE_DRIVE_FOLDER_ID v config.js"); } }}); }
  async function signIn(){ tokenClient.requestAccessToken(); }
  els.addUrlBtn.addEventListener("click", async ()=>{ const url=(els.urlInput.value||"").trim(); if(!url)return; addMessage("user","Přidán odkaz: "+url); try{ logStatus("Stahuji "+url+" …"); const r=await fetch(cfg.INGEST_URL_ENDPOINT||"/.netlify/functions/ingest",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url})}); if(!r.ok) throw new Error(await r.text()); const data=await r.json(); state.linkContexts.push(data); renderUrlList(); logStatus("Odkaz připraven: "+(data.title||url)); }catch(e){ logStatus("Chyba odkazu: "+e.message);} finally{ els.urlInput.value=""; } });
  els.transcribeBtn.addEventListener("click", async ()=>{ const fileId=(els.driveFileId.value||"").trim(); if(!fileId||!state.token) return; addMessage("user","Přepis audio souboru: "+fileId); try{ logStatus("Přepisuji audio (Drive) …"); const r=await fetch(cfg.TRANSCRIBE_ENDPOINT||"/.netlify/functions/transcribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileId,driveAccessToken:state.token})}); if(!r.ok) throw new Error(await r.text()); const data=await r.json(); state.linkContexts.push(data); renderUrlList(); logStatus("Přepis hotov: "+data.title); }catch(e){ logStatus("Chyba přepisu: "+e.message);} finally{ els.driveFileId.value=""; } });
  els.searchInput.addEventListener("input",applyFilters);
  els.mimeFilter.addEventListener("change",applyFilters);
  els.refreshBtn.addEventListener("click", async ()=>{ if(!state.token||!cfg.GOOGLE_DRIVE_FOLDER_ID) return; await listFilesInFolder(cfg.GOOGLE_DRIVE_FOLDER_ID); });
  els.form.addEventListener("submit", async (e)=>{ e.preventDefault(); const q=els.question.value.trim(); if(!q) return; addMessage("user",q); els.question.value=""; logStatus("Připravuji kontext…"); const contexts=await getSelectedContexts(); const all=[...contexts, ...state.linkContexts].slice(0,16); logStatus("Volám model…"); const r=await fetch(cfg.ANSWER_ENDPOINT||"/.netlify/functions/answer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:q,contexts:all})}); if(!r.ok){ addMessage("bot","Chyba: "+await r.text()); return; } const data=await r.json(); addMessage("bot",data.answer||"(bez odpovědi)"); renderCitations(data.citations||[]); });
  window.addEventListener("load",()=>{ if(window.google&&google.accounts&&google.accounts.oauth2){ initAuth(); } else { logStatus("Čekám na Google skript…"); setTimeout(()=>{ if(window.google&&google.accounts&&google.accounts.oauth2) initAuth(); else logStatus("⚠️ Nepodařilo se načíst Google Identity Services."); },1200); } });
  document.getElementById("signinBtn").addEventListener("click",signIn);
})();