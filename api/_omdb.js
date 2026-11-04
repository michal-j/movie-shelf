// Shared OMDb helpers for the serverless functions. The leading underscore
// keeps Vercel from exposing this file as its own /api route.

// OMDb returns text HTML-escaped ("Dan O&apos;Bannon"). Stored as-is that
// shows up literally in the UI, so decode the entities OMDb is known to emit.
function decodeEntities(s) {
  if (typeof s !== "string") return s;
  return s
    .replace(/&apos;|&#0?39;|&#x27;/gi, "'")
    .replace(/&quot;|&#0?34;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&"); // last, so "&amp;apos;" doesn't double-decode
}

module.exports = { decodeEntities };
