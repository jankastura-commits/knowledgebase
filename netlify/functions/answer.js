// netlify/functions/answer.js
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }
    if (!OPENAI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'OPENAI_API_KEY is missing on server' }) };
    }

    const { question, url } = JSON.parse(event.body || '{}');
    if (!question) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing "question"' }) };
    }

    // — minimální volání OpenAI (chat) —
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: url ? `URL: ${url}\n\nQuestion: ${question}` : question }
        ]
      })
    });

    const j = await r.json();
    if (!r.ok) {
      return { statusCode: r.status, body: JSON.stringify({ error: j }) };
    }

    const text = j.choices?.[0]?.message?.content || '(empty)';
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: text })
    };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
