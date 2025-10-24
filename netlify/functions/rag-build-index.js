// netlify/functions/rag-build-index.js
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const EMBEDDING_MODEL = 'text-embedding-3-small';

function json(status, body){ return { statusCode: status, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }; }
function chunkText(text, size=1500, overlap=200){
  const out=[]; let i=0;
  while(i<text.length){
    const end=Math.min(text.length, i+size);
    out.push(text.slice(i,end));
    if(end===text.length) break;
    i=end-overlap;
  }
  return out;
}

async function driveListTextFiles(token, folderId){
  const url=new URL('https://www.googleapis.com/drive/v3/files');
  url.search=new URLSearchParams({
    q:`'${folderId}' in parents and trashed = false`,
    fields:'files(id,name,mimeType,size)',
    includeItemsFromAllDrives:'true', supportsAllDrives:'true', pageSize:'1000'
  }).toString();
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
  const j=await r.json(); if(!r.ok) throw new Error(j.error?.message || r.statusText);
  return (j.files||[]).filter(f =>
    f.mimeType==='text/plain' ||
    f.name.toLowerCase().endsWith('.txt') ||
    f.mimeType==='application/vnd.google-apps.document'
  );
}
async function driveDownloadText(token, file){
  if(file.mimeType==='application/vnd.google-apps.document'){
    const url=`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain&supportsAllDrives=true`;
    const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}}); if(!r.ok) throw new Error('Export failed'); return await r.text();
  }
  const url=`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`;
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}}); if(!r.ok) throw new Error('Download failed'); return await r.text();
}
async function openaiEmbedBatch(inputs){
  const r=await fetch('https://api.openai.com/v1/embeddings',{
    method:'POST', headers:{'Authorization':`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs })
  });
  const j=await r.json(); if(!r.ok) throw new Error(j.error?.message || r.statusText);
  return j.data.map(d=>d.embedding);
}
async function driveSearch(token, folderId, name){
  const url=new URL('https://www.googleapis.com/drive/v3/files');
  url.search=new URLSearchParams({
    q:`'${folderId}' in parents and name='${name.replace(/'/g,"\\'")}' and trashed=false`,
    fields:'files(id,name)', pageSize:'1', includeItemsFromAllDrives:'true', supportsAllDrives:'true'
  }).toString();
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
  const j=await r.json(); if(!r.ok) throw new Error(j.error?.message || r.statusText);
  return j.files?.[0] || null;
}
async function driveUpdateMedia(token, fileId, content){
  const r=await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`,{
    method:'PATCH', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body: content
  }); if(!r.ok) throw new Error('Index update failed: '+(await r.text()));
}
async function driveCreateJsonFile(token, folderId, name, content){
  const boundary='b-'+Math.random().toString(16).slice(2);
  const meta={name, parents:[folderId], mimeType:'application/json'};
  const head=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`+
             `--${boundary}\r\nContent-Type: application/json\r\n\r\n`;
  const tail=`\r\n--${boundary}--`;
  const body=Buffer.concat([Buffer.from(head), Buffer.from(content,'utf8'), Buffer.from(tail)]);
  const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',{
    method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':`multipart/related; boundary=${boundary}`}, body
  });
  const j=await r.json(); if(!r.ok) throw new Error(j.error?.message || r.statusText); return j.id;
}

exports.handler = async (event) => {
  try{
    if(event.httpMethod!=='POST') return json(405,{error:'Method Not Allowed'});
    if(!OPENAI_API_KEY) return json(500,{error:'OPENAI_API_KEY is missing'});

    const h = event.headers || {};
    const auth = h.authorization || h.Authorization || h['x-authorization'] || '';
    const token = (auth || '').replace(/^Bearer\s+/i,'').trim();
    if(!token) return json(401,{error:'Missing Google token (Authorization: Bearer <access_token>)'});

    const { folderId, chunkSize=1500, chunkOverlap=200 } = JSON.parse(event.body||'{}');
    if(!folderId) return json(400,{error:'Missing folderId'});

    const files = await driveListTextFiles(token, folderId);
    if(!files.length) return json(400,{error:'V cílové složce nejsou žádné .txt ani Google Docs.'});

    const chunks=[]; const MAX_CHUNKS=5000;
    for(const f of files){
      try{
        const txt = await driveDownloadText(token, f);
        const parts = chunkText(txt, chunkSize, chunkOverlap);
        parts.forEach((t,i)=>{
          chunks.push({ text:t, file:f.name, fileId:f.id, ref:`${f.name}#${i+1}` });
        });
        if(chunks.length>MAX_CHUNKS) break;
      }catch(e){ console.warn('[build] skip', f.name, e.message); }
    }
    if(!chunks.length) return json(400,{error:'Nepodařilo se získat žádné textové chunky.'});

    const BATCH=64, lines=[];
    for(let i=0;i<chunks.length;i+=BATCH){
      const batch=chunks.slice(i,i+BATCH);
      const vectors=await openaiEmbedBatch(batch.map(b=>b.text));
      for(let j=0;j<vectors.length;j++){
        const c=batch[j];
        const snippet = c.text.replace(/\s+/g,' ').trim().slice(0, 800);
        lines.push(JSON.stringify({
          embedding: vectors[j],
          file: c.file,
          fileId: c.fileId,
          ref: c.ref,
          snippet
        })+'\n');
      }
    }

    const name='index.jsonl';
    const content = lines.join('');
    const existing = await driveSearch(token, folderId, name);
    if(existing) await driveUpdateMedia(token, existing.id, content);
    else await driveCreateJsonFile(token, folderId, name, content);

    return json(200,{ ok:true, chunks:chunks.length });
  }catch(e){
    console.error('[rag-build-index] ERROR', e);
    return json(500,{ error:e.message || String(e) });
  }
};
