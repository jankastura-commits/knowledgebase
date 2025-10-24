import fetch from "node-fetch";
import pdfParse from "pdf-parse";

export default async (req, context) => {
  try {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const { fileId, driveAccessToken } = await req.json();
    if (!fileId || !driveAccessToken) return new Response("Missing fileId or driveAccessToken", { status: 400 });

    const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await fetch(driveUrl, { headers: { Authorization: "Bearer " + driveAccessToken } });
    if (!res.ok) return new Response("Drive fetch failed: " + await res.text(), { status: 500 });
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const parsed = await pdfParse(buffer);
    const text = (parsed.text || "").replace(/\s+/g, " ").trim();

    return Response.json({ content: text.slice(0, 60000) });
  } catch (e) {
    return new Response("PDF parse error: " + e.message, { status: 500 });
  }
};