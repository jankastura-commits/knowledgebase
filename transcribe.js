export default async (req, context) => {
  try {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const { fileId, driveAccessToken } = await req.json();
    if (!fileId || !driveAccessToken) return new Response("Missing fileId or driveAccessToken", { status: 400 });
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const audioRes = await fetch(driveUrl, { headers: { Authorization: "Bearer " + driveAccessToken } });
    if (!audioRes.ok) return new Response("Drive fetch failed: " + await audioRes.text(), { status: 500 });
    const arrayBuf = await audioRes.arrayBuffer();
    const blob = new Blob([arrayBuf], { type: "audio/mpeg" });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return new Response("Missing OPENAI_API_KEY", { status: 500 });
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", blob, "audio.mp3");
    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{"Authorization":`Bearer ${apiKey}`},body:form});
    if (!resp.ok) return new Response("Transcription error: " + await resp.text(), { status: 500 });
    const data = await resp.json();
    const text = data.text || "";
    const title = "Přepis audia z Drive (" + fileId + ")";
    const url = `https://drive.google.com/file/d/${fileId}/view`;
    return Response.json({ title, url, content: text.slice(0,40000), snippet: text.slice(0,360) });
  } catch (e) { return new Response("Server error: " + e.message, { status: 500 }); }
};