// netlify/functions/admin-upload-convert.js
// Upload souboru do cílové složky, volitelně převést DOCX/PDF → Google Doc a uložit TXT.
// Zaktualizuje manifest.jsonl (create vs update; update bez parents!).

const fetch = global.fetch; // Netlify runtime
function json(status, body) {
  return { statusCode: status, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) };
}
function b64ToBuffer(b64){ return Buffer.from(b64, 'base64'); }

async function driveCreateMultipart(token, folderId, name, mimeType, dataBuffer, asGoogleDoc=false) {
  const boundary = 'b-' + Math.random().toString(16).slice(2);
  const metadata = {
    name,
    parents: [folderId],
    ...(asGoogleDoc ? { mimeType: 'application/vnd.google-apps.document' } : {})
  };
  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(head), dataBuffer, Buffer.from(tail)]);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
    method:'POST',
    headers:{ Authorization:`Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  const j = await r.json();
  if(!r.ok) throw new Error(j.error?.message || r.statusText);
  return j; // { id, name, mimeType, ... }
}

async function driveSearch(token, folderId, name){
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.search = new URLSearchParams({
    q: `'${folderId}' in parents and name = '${name.replace(/'/g,"\\'")}' and trashed = false`,
    fields: 'files(id,name)',
    pageSize: '1',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true'
  }).toString();
  const r = await fetch(url, { headers:{Authorization:`Bearer ${token}`}});
  const j = await r.json(); if(!r.ok) throw new Error(j.error?.message || r.statusText);
  return j.files?.[0] || null;
}
async function driveDownloadTextFromGDoc(token, fileId){
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain&supportsAllDrives=true`;
  const r = await fetch(url, { headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok) throw new Error('Export failed: '+(await r.text()));
  return await r.text();
}
async function driveUpdateMedia(token, fileId, content, contentType='application/json'){
  const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`, {
    method:'PATCH',
    headers:{ Authorization:`Bearer ${token}`, 'Content-Type': contentType },
    body: content
  });
  if(!r.ok) throw new Error('Update failed: '+(await r.text()));
}
async function driveCreateTextFile(token, folderId, name, content){
  const boundary = 'b-' + Math.random().toString(16).slice(2);
  const metadata = { name, parents:[folderId], mimeType:'text/plain' };
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
               `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(head), Buffer.from(content, 'utf8'), Buffer.from(tail)]);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
    method:'POST', headers:{Authorization:`Bearer ${token}`, 'Content-Type':`multipart/related; boundary=${boundary}`}, body
  });
  const j = await r.json(); if(!r.ok) throw new Error(j.error?.message || r.statusText);
  return j.id;
}

exports.handler = async (event) => {
  try{
    if(event.httpMethod!=='POST') return json(405,{error:'Method Not Allowed'});
    const auth = event.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i,'').trim();
    if(!token) return json(401,{error:'Missing Google token'});
    const { destFolderId, fileName, mimeType, dataBase64, options={} } = JSON.parse(event.body||'{}');
    if(!destFolderId || !fileName || !dataBase64) return json(400,{error:'Missing inputs'});

    const { asGDoc=false } = options;
    const buf = b64ToBuffer(dataBase64);

    // 1) upload (originál nebo rovnou převod na Google Doc)
    const convertible = /(\.docx?$|\.pdf)$/i.test(fileName) || /pdf|word/.test(mimeType||'');
    const asGoogleDoc = !!(asGDoc && convertible);

    const uploaded = await driveCreateMultipart(
      token, destFolderId, fileName, mimeType || 'application/octet-stream', buf, asGoogleDoc
    );
    let textFileId = null;

    // 2) pokud je to Google Doc → export do textu a ulož .txt do cílové složky
    if (uploaded.mimeType === 'application/vnd.google-apps.document') {
      const txt = await driveDownloadTextFromGDoc(token, uploaded.id);
      const txtName = fileName.replace(/\.[^.]+$/,'') + '.txt';
      textFileId = await driveCreateTextFile(token, destFolderId, txtName, txt);
    }

    // 3) manifest.jsonl (create vs update; u update bez parents!)
    const manifestName = 'manifest.jsonl';
    const existing = await driveSearch(token, destFolderId, manifestName);
    const line = JSON.stringify({
      fileId: uploaded.id,
      name: uploaded.name,
      mimeType: uploaded.mimeType,
      textFileId: textFileId || null,
      ts: Date.now()
    }) + '\n';

    if (existing) {
      const url = `https://www.googleapis.com/drive/v3/files/${existing.id}?alt=media&supportsAllDrives=true`;
      const cur = await fetch(url, { headers:{Authorization:`Bearer ${token}`}});
      const prev = cur.ok ? await cur.text() : '';
      await driveUpdateMedia(token, existing.id, prev + line, 'application/json');
    } else {
      await driveCreateTextFile(token, destFolderId, manifestName, line);
    }

    return json(200, { ok:true, outputName: uploaded.name, fileId: uploaded.id, textFileId });
  }catch(e){
    console.error('[admin-upload-convert] ERROR', e);
    return json(500, { error: e.message || String(e) });
  }
};
