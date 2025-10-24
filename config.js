window.APP_CONFIG = {
  GOOGLE_CLIENT_ID: "392751314439-f6mg5q2bbsjj5j6lb2kr4o9qs8h6r4t2.apps.googleusercontent.com",
  GOOGLE_DRIVE_FOLDER_ID: "1lZNPwpQke_GnC7ER0-CfxtHegpUa346a",
  MIME_WHITELIST: ["application/vnd.google-apps.document", "text/plain", "text/markdown", "application/json", "application/pdf"],
  ANSWER_ENDPOINT: "/.netlify/functions/answer",
  INGEST_URL_ENDPOINT: "/.netlify/functions/ingest",
  TRANSCRIBE_ENDPOINT: "/.netlify/functions/transcribe",
  EXTRACT_PDF_ENDPOINT: "/.netlify/functions/extract-pdf"
  
};

// /.netlify/functions/public-config
exports.handler = async () => {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY
    })
  };
};
