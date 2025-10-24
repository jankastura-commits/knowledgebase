// /.netlify/functions/admin-upload-convert
// Přijme soubor (base64), převede na text (PDF/DOCX/TXT/HTML), uloží do /text a aktualizuje manifest.
// Volitelně uloží originál do /source.
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const crypto = require('crypto');

function b64ToBuffer(b64){ return Buffer.from(b64, 'base64'); }

async function ensureChildFolder(token, parentId, name){
  const listURL = new URL('https://www.googleapis.com/drive/v3/files');
  listURL.search = new URLSearchParams({
    q: `'${parentId}' in parents and name = '${name.replace(/'/g,"\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,name)',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    pageSize: '1'
  }).toString();
  const H = { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' };
  const r = await fetch(listURL, { headers: H });
  const j = await r.json();
  if (j.files && j.files[0]) return j.files[0].id;

  // create
  const cr = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method:'POST', headers: H, body: JSON.stringify({
      name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId]
    })
  });
  const cj = await cr.json();
  if (!cr.ok) throw new Error(cj.error?.message || 'Folder create failed');
  return cj.id;
}

function stripHtml(html){
  return String(html||'').replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi,' ')
                         .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi,' ')
                         .replace(/<[^>]+>/g,' ')
                         .replace(/\s+/g,' ')
                         .trim();
}

async function uploadText(token, folderId, baseName, text, asGDoc){
  const boundary = 'b-' + Math.random().toString(16).slice(2);
  const metadata = {
    name: asGDoc ? `${baseName} (text)` : `${baseName}.txt`,
    parents: [folderId],
    mimeType: asGDoc ? 'application/vnd.google-apps.document' : 'text/plain'
  };
  const media = Buffer.from(text, 'utf8');
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`+
               `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(head), media, Buffer.from(tail)]);
  const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
    method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':`multipart/related; boundary=${boundary}` }, body
  });
  const j = await up.json();
  if (!up.ok) throw new Error(j.error?.message || 'Upload text failed');
  return { id: j.id, name: metadata.name };
}

async function uploadOriginal(token, folderId, fileName, mimeType, buf){
  const boundary = 'b-' + Math.random().toString(16).slice(2);
  const metadata = { name: fileName, parents: [folderId] };
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`+
               `--${boundary}\r\nContent-Type: ${mimeType||'application/octet-stream'}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(head), buf, Buffer.from(tail)]);
  const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
    method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':`multipart/related; boundary=${boundary}` }, body
  });
  const j = await up.json();
  if (!up.ok) throw new Error(j.error?.message || 'Upload original failed');
  return { id: j.id, name: fileName };
}

async function readFileText(buf, mimeType, fileName){
  const nameLower = (fileName||'').toLowerCase();
  if ((mimeType && mimeType.includes('pdf')) || nameLower.endsWith('.pdf')){
    const res = await pdfParse(buf);
    return (res.text||'').trim();
  }
  if ((mimeType && (mimeType.includes('word')||mimeType.includes('msword'))) || nameLower.endsWith('.docx') || nameLower.endsWith('.doc')){
    const r = await mammoth.extractRawText({ buffer: buf });
    return (r.value||'').trim();
  }
  if (mimeType && mimeType.startsWith('text/')){
    return buf.toString('utf8');
  }
  if ((mimeType && mimeType.includes('html')) || nameLower.endsWith('.html') || nameLower.endsWith('.htm')){
    return stripHtml(buf.toString('utf8'));
  }
  if (nameLower.endsWith('.csv') || nameLower.endsWith('.tsv')){
    return buf.toString('utf8');
  }
  // fallback: try utf8
  return buf.toString('utf8');
}

async function getFile(token, fileId){
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers:{ Authorization:`Bearer ${token}` }});
  if (!r.ok) throw new Error(`Read file ${fileId} failed: ${r.status}`);
  return await r.text();
}

async function writeManifestLine(token, datasetFolderId, lineObj){
  // find or create manifest.jsonl
  const listURL = new URL('https://www.googleapis.com/drive/v3/files');
  listURL.search = new URLSearchParams({
    q: `'${datasetFolderId}' in parents and name = 'manifest.jsonl' and trashed = false`,
    fields: 'files(id,name)',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    pageSize: '1'
  }).toString();
  const H = { Authorization: `Bearer ${token}` };
  const r = await fetch(listURL, { headers: H });
  const j = await r.json();
  let id = j.files && j.files[0] && j.files[0].id;

  const newLine = JSON.stringify(lineObj) + "\n";
  let content = newLine;
  if (id){
    // read previous and append
    try{
      const old = await getFile(token, id);
      content = old + newLine;
    }catch{ /* ignore */ }
    // update (PATCH multipart)
    const boundary = 'b-' + Math.random().toString(16).slice(2);
    const metadata = { name: 'manifest.jsonl', parents:[datasetFolderId], mimeType:'application/json' };
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`+
                 `--${boundary}\r\nContent-Type: application/json\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const body = Buffer.concat([Buffer.from(head), Buffer.from(content,'utf8'), Buffer.from(tail)]);
    const up = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart&supportsAllDrives=true`, {
      method:'PATCH', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':`multipart/related; boundary=${boundary}` }, body
    });
    const uj = await up.json();
    if (!up.ok) throw new Error(uj.error?.message || 'Manifest update failed');
    return uj.id;
  } else {
    // create
    const boundary = 'b-' + Math.random().toString(16).slice(2);
    const metadata = { name: 'manifest.jsonl', parents:[datasetFolderId], mimeType:'application/json' };
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`+
                 `--${boundary}\r\nContent-Type: application/json\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const body = Buffer.concat([Buffer.from(head), Buffer.from(content,'utf8'), Buffer.from(tail)]);
    const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
      method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':`multipart/related; boundary=${boundary}` }, body
    });
    const uj = await up.json();
    if (!up.ok) throw new Error(uj.error?.message || 'Manifest create failed');
    return uj.id;
  }
}

exports.handler = async (event)=>{
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try{
    const auth = event.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return { statusCode: 401, body: JSON.stringify({ error:'Missing Bearer token (drive.file)' }) };

    const { destFolderId, fileName, mimeType, dataBase64, options={} } = JSON.parse(event.body || '{}');
    if (!destFolderId || !fileName || !dataBase64) return { statusCode: 400, body: JSON.stringify({ error:'Missing destFolderId/fileName/dataBase64' }) };

    const buf = b64ToBuffer(dataBase64);
    const baseName = fileName.replace(/\.[^/.]+$/, '');

    // ensure subfolders
    const textFolderId = await ensureChildFolder(token, destFolderId, 'text');
    const sourceFolderId = options.saveOriginal ? await ensureChildFolder(token, destFolderId, 'source') : null;

    // convert to text
    let text = await readFileText(buf, mimeType, fileName);
    if (!text || !text.trim()) {
      if (options.useOCR) {
        // Placeholder pro OCR (zatím neaktivní)
        // text = await ocrFallback(buf, mimeType);
        return { statusCode: 501, body: JSON.stringify({ error:'OCR fallback není zapnutý v této verzi' }) };
      }
      return { statusCode: 400, body: JSON.stringify({ error:'Nepodařilo se získat text z souboru' }) };
    }

    // hash
    const sha256 = crypto.createHash('sha256').update(text, 'utf8').digest('hex');

    // save text
    const out = await uploadText(token, textFolderId, baseName, text, !!options.asGDoc);

    // save original (optional)
    let originalId = null;
    if (options.saveOriginal) {
      const org = await uploadOriginal(token, sourceFolderId, fileName, mimeType, buf);
      originalId = org.id;
    }

    // write manifest line
    const line = {
      createdAt: new Date().toISOString(),
      originalName: fileName,
      mimeType: mimeType || 'unknown',
      outputId: out.id,
      outputName: out.name,
      saveOriginal: !!options.saveOriginal,
      originalId,
      sha256,
      bytes: buf.length,
      status: 'ok'
    };
    const manifestId = await writeManifestLine(token, destFolderId, line);

    return { statusCode: 200, body: JSON.stringify({ ok:true, outputId: out.id, outputName: out.name, manifestId }) };
  }catch(e){
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
