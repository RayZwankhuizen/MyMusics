const maxUrlLength = 8192;
const apiPaths = new Set(["/stations", "/station-search", "/stream-search", "/station-images/find", "/station-images", "/health", "/nowplaying", "/nowplaying/events", "/metadata", "/lyrics", "/genius-art"]);

function isApiRequest(req) {
  return req.path === "/api" || req.path.startsWith("/api/") || req.path.startsWith("/library/")
    || apiPaths.has(req.path) && (req.path !== "/station-images" || req.method === "POST");
}

function apiRequest(req, res, next) {
  if (!isApiRequest(req)) return next();
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0"
  });
  if (req.originalUrl.length > maxUrlLength) return res.status(414).json({ error: "API request URL is too long." });
  next();
}

function apiNotFound(req, res, next) {
  if (!isApiRequest(req)) return next();
  res.status(404).json({ error: "API endpoint not found." });
}

function apiError(error, req, res, next) {
  if (!isApiRequest(req) || res.headersSent) return next(error);
  const originalStatus = Number(error.status || error.statusCode);
  const status = Number.isInteger(originalStatus) && originalStatus >= 400 && originalStatus <= 599 ? originalStatus : 500;
  const code = error.type;
  const message = code === "entity.too.large" ? "Request body is too large."
    : code === "entity.parse.failed" ? "Request body must be valid JSON."
      : code === "request.aborted" ? "Request body was interrupted."
        : status >= 400 && status < 500 ? error.message : "The server could not complete this request.";
  if (status >= 500) console.error("Unhandled API error:", error);
  res.status(status).json({ error: message || "The server could not complete this request." });
}

module.exports = { apiRequest, apiNotFound, apiError };
