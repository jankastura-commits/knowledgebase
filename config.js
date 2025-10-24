window.APP_CONFIG = {
  GOOGLE_CLIENT_ID: "392751314439-f6mg5q2bbsjj5j6lb2kr4o9qs8h6r4t2.apps.googleusercontent.com",
  GOOGLE_DRIVE_FOLDER_ID: "1lZNPwpQke_GnC7ER0-CfxtHegpUa346a",
  MIME_WHITELIST: ["application/vnd.google-apps.document", "text/plain", "text/markdown", "application/json", "application/pdf"],
  ANSWER_ENDPOINT: "/.netlify/functions/answer",
  INGEST_URL_ENDPOINT: "/.netlify/functions/ingest",
  TRANSCRIBE_ENDPOINT: "/.netlify/functions/transcribe",
  EXTRACT_PDF_ENDPOINT: "/.netlify/functions/extract-pdf"
  
};

// shim pro admin – převod APP_CONFIG -> CONFIG
window.CONFIG = {
  GOOGLE_CLIENT_ID: window.APP_CONFIG.GOOGLE_CLIENT_ID,
  GOOGLE_API_KEY: "SEM_VLOŽ_TVŮJ_PICKER_API_KEY"
};
