const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();

function badEnv(msg) {
  return { statusCode: 500, body: JSON.stringify({ error: msg }) };
}

exports.handler = async (event) => {
  if (!OPENAI_API_KEY) {
    return badEnv('OPENAI_API_KEY is missing on the server. Set it in Netlify → Environment variables and redeploy.');
  }

  // … zbytek tvého kódu …

  // PŘI VOLÁNÍ OPENAI:
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini', // nebo tvůj model
      messages: [{ role: 'user', content: question }]
    })
  });

  // … zbytek zpracování …
};

export default async (req, context) => {
  try {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const { question, contexts = [] } = await req.json();
    if (!question || !Array.isArray(contexts)) return new Response("Bad request", { status: 400 });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return new Response("Missing OPENAI_API_KEY", { status: 500 });
    const joined = contexts.map((c,i)=>`[${i+1}] ${c.title} :: ${c.url}\n` + (c.content||"").slice(0,8000)).join("\n\n---\n\n");
    const payload = { model:"gpt-4o-mini", temperature:0.2, messages:[
      {role:"system",content:"Jsi asistent pro finanční a firemní data. Odpovídej česky, stručně, s odrážkami a citacemi [1], [2]. Když to ve zdrojích není, řekni to."},
      {role:"user",content:`DOTAZ: ${question}\n\nDOSTUPNÉ ZDROJE:\n${joined}\n\nInstrukce:\n- Odpověz max v 8 větách, ideálně odrážky.\n- U klíčových tvrzení citace [číslo].\n- Při rozporu zdrojů to uveď.`}
    ]};
    const resp = await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
    if (!resp.ok) return new Response("OpenAI error: " + await resp.text(), { status: 500 });
    const data = await resp.json();
    const answer = data.choices?.[0]?.message?.content || "";
    const citations = contexts.map(c=>({title:c.title,url:c.url,snippet:(c.content||"").slice(0,240)}));
    return Response.json({answer,citations});
  } catch (e) { return new Response("Server error: " + e.message, { status: 500 }); }
};
