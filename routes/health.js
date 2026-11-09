module.exports = function registerHealthRoute(app, version) {
  app.get("/health", (_req, res) => res.json({ status: "ok", version }));
};
