export default async (req, context) => {
  try {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const { url } = await req.json();
    if (!url || !/^https?:\/\//i.test(url)) return new Response("Invalid URL", { status: 400 });
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return new Response("Fetch failed: " + (await res.text()), { status: 500 });
    const ctype = res.headers.get("content-type") || "";
    if (!/(text\/html|text\/plain)/i.test(ctype)) return new Response("Unsupported content-type: " + ctype, { status: 415 });
    const raw = await res.text();
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const ogTitle = raw.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const title = (ogTitle && ogTitle[1]) || (titleMatch && titleMatch[1]) || url;
    let cleaned = raw.replace(/<!--([\s\S]*?)-->/g," ").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ");
    const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    let bodyHtml = (articleMatch && articleMatch[1]) || (cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]) || cleaned;
    const text = bodyHtml.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
    const content = text.slice(0,20000); const snippet = content.slice(0,360);
    return Response.json({ title, url, content, snippet });
  } catch (e) { return new Response("Server error: " + e.message, { status: 500 }); }
};