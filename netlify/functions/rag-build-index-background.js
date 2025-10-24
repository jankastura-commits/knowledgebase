// netlify/functions/rag-build-index-background.js
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();

// —— helper: batch embeddings (místo 1 po druhém) ——
const OPENAI_URL = 'https://api.openai.com/v1/embeddings';
const MODEL = 'text-embedding-3-large'; // nebo tvůj
async function embedBatch(inputs){
  const r = await fetch(OPENAI_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${OPENAI_API_KEY}`},
    body: JSON.stringify({ model: MODEL, input: inputs })
  });
  const j = await r.json();
  if(!r.ok) throw new Error(j.error?.message || `Embedding failed ${r.status}`);
  return j.data.map(d=>d.embedding);
}

exports.handler = async (event, context) => {
  try{
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }
    if (!OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY missing');
      return { statusCode: 500, body: JSON.stringify({ error: 'OPENAI_API_KEY is missing' }) };
    }
    const auth = event.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i,'').trim();
    if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Missing Google token' }) };

    const { folderId, chunkSize=1500, chunkOverlap=200 } = JSON.parse(event.body||'{}');
    if (!folderId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing folderId' }) };

    console.log('[build-bg] start', { folderId, chunkSize, chunkOverlap });

    // === tvá stávající logika čtení souborů z Drive + řezání textu ===
    // … načti texty → ulož do pole `texts`
    // Příklad logu:
    // console.log('[build-bg] files:', files.length, 'chunks:', texts.length);

    // === embeddings ve dávkách ===
    const texts = globalThis.__TEXTS__ || []; // TODO: nahraď svým zdrojem
    const BATCH = 64;
    const vectors = [];
    for (let i=0; i<texts.length; i+=BATCH){
      const embs = await embedBatch(texts.slice(i,i+BATCH));
      vectors.push(...embs);
    }

    // === ulož index zpět do Drive ===
    // … tvůj existující kód pro zápis indexu (např. index.jsonl) …

    console.log('[build-bg] done', { chunks: vectors.length });
    // Background funkce může vrátit 202, UI si může jen zapsat „odstartováno“
    return { statusCode: 202, body: JSON.stringify({ message:'Index build started (background)', chunks: vectors.length }) };
  }catch(e){
    console.error('[build-bg] ERROR', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
