const path = require("path");
const express = require("express");
const { createDb, initDb } = require("./db");
const { config } = require("./config");
const { createPublicRouter } = require("./routes/public");
const { createAdminRouter } = require("./routes/admin");
const { startScheduler } = require("./scheduler");
const { createBot, startBot } = require("./telegram");

function createCorsMiddleware() {
  const allowedOrigins = [config.appOrigin, config.apiOrigin].filter(Boolean);

  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    }

    if (req.method === "OPTIONS") {
      return res.status(204).send();
    }

    return next();
  };
}

async function bootstrap() {
  const app = express();
  const db = createDb();
  initDb(db);

  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use(createCorsMiddleware());
  app.use(express.json({ limit: "500kb" }));

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  app.use("/api/admin", createAdminRouter(db));
  app.use("/api", createPublicRouter(db));

  const publicDir = path.join(process.cwd(), "public");
  app.use(express.static(publicDir));

  app.get(/.*/, (req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "Route not found" });
    }
    return res.sendFile(path.join(publicDir, "index.html"));
  });

  startScheduler(db);

  const bot = createBot();
  if (bot) {
    startBot(bot).catch((error) => {
      console.error("[telegram] failed to start bot:", error);
    });
  }

  app.listen(config.port, () => {
    console.log(`[server] listening on port ${config.port}`);
  });
}

bootstrap().catch((error) => {
  console.error("[server] startup failed:", error);
  process.exit(1);
});
