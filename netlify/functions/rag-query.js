// netlify/functions/rag-query.js
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const EMB_MODEL = 'text-embedding-3-small';
const CHAT_MODEL = 'gpt-4o-mini';

function json(status, body){ return { statusCode: status, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }; }

async function driveFindFileByName(token, folderId, name){
  const url=new URL('https://www.googleapis.com/drive/v3/files');
  url.search=new URLSearchParams({
    q:`'${folderId}' in parents and name='${name.replace(/'/g,"\\'")}' and trashed=false`,
    fields:'files(id,name)', pageSize:'1',
    includeItemsFromAllDrives:'true', supportsAllDrives:'true'
  }).toString();
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
  const j=await r.json(); if(!r.ok) throw new Error(j.error?.message || r.statusText);
  return j.files?.[0] || null;
}
async function driveDownloadTextById(token, fileId){
  const url=`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok) throw new Error('Download failed: '+(await r.text()));
  return await r.text();
}

async function embed(input){
  const r=await fetch('https://api.openai.com/v1/embeddings',{
    method:'POST', headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify({ model: EMB_MODEL, input })
  });
  const j=await r.json(); if(!r.ok) throw new Error(j.error?.message || r.statusText);
  return j.data[0].embedding;
}
function cosine(a,b){ let dot=0,na=0,nb=0; for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return dot/(Math.sqrt(na)*Math.sqrt(nb)||1); }
async function chatAnswer(question, snippets, citations){
  const context = snippets.map((s,i)=>`[${i+1}] (${citations[i].file} • ${citations[i].ref})\n${s}`).join('\n\n');
  const messages = [
    { role:'system', content:'Jsi užitečný asistent. Odpovídej česky a drž se poskytnutého kontextu. Když něco v kontextu není, řekni to.' },
    { role:'user', content:`Otázka:\n${question}\n\nKontext:\n${context}\n\nOdpověz věcně a v bodech, pokud se to hodí.` }
  ];
  const r=await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST', headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify({ model: CHAT_MODEL, messages, temperature: 0.2 })
  });
  const j=await r.json(); if(!r.ok) throw new Error(j.error?.message || r.statusText);
  return j.choices[0].message.content.trim();
}

exports.handler = async (event)=>{
  try{
    if(event.httpMethod!=='POST') return json(405,{error:'Method Not Allowed'});
    if(!OPENAI_API_KEY) return json(500,{error:'OPENAI_API_KEY is missing'});

    const h=event.headers||{};
    const auth=h.authorization||h.Authorization||'';
    const driveToken=(auth||'').replace(/^Bearer\s+/i,'').trim();
    if(!driveToken) return json(401,{error:'Missing Google token (Authorization: Bearer <access_token>)'});

    const { folderId, question, topK=6 } = JSON.parse(event.body||'{}');
    if(!folderId || !question) return json(400,{error:'Missing folderId or question'});

    const idx = await driveFindFileByName(driveToken, folderId, 'index.jsonl');
    if(!idx) return json(400,{error:'Index (index.jsonl) nebyl v cílové složce nalezen.'});
    const raw = await driveDownloadTextById(driveToken, idx.id);

    const rows = raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>{
      const j=JSON.parse(l);
      return { emb:j.embedding, file:j.file, ref:j.ref, fileId:j.fileId, snippet:j.snippet||'' };
    });
    if(!rows.length) return json(400,{error:'Index je prázdný.'});

    const qvec = await embed(question);
    const scored = rows.map(r=>({ ...r, score: cosine(qvec, r.emb) }))
                       .sort((a,b)=>b.score-a.score)
                       .slice(0, Math.max(1, Math.min(20, topK)));

    const snippets = scored.map(r=>r.snippet || '').map(s => s.slice(0, 1200));
    const cites = scored.map((r,i)=>({ ref:`${i+1}`, file:r.file }));

    const answer = await chatAnswer(question, snippets, scored);
    return json(200,{ answer, citations: cites });
  }catch(e){
    console.error('[rag-query] ERROR', e);
    return json(500,{ error:e.message || String(e) });
  }
};
