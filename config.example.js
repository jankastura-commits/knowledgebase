// Rename this file to `config.js` and fill in your values.
// See README for instructions.
window.APP_CONFIG = {
  GOOGLE_CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
  GOOGLE_DRIVE_FOLDER_ID: "YOUR_FOLDER_ID",
  MIME_WHITELIST: ["application/vnd.google-apps.document", "text/plain", "text/markdown", "application/json"],
  ANSWER_ENDPOINT: "/.netlify/functions/answer",
  INGEST_URL_ENDPOINT: "/.netlify/functions/ingest",
  TRANSCRIBE_ENDPOINT: "/.netlify/functions/transcribe"
};