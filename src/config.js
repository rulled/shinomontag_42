const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

function parseAdminIds(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
}

const config = {
  port: Number(process.env.PORT || 3000),
  botToken: process.env.BOT_TOKEN || "",
  appSecret: process.env.APP_SECRET || "change-me-please",
  adminIds: parseAdminIds(process.env.ADMIN_IDS || ""),
  miniAppUrl: process.env.MINI_APP_URL || "https://app.example.com",
  appOrigin: process.env.APP_ORIGIN || "https://app.example.com",
  apiOrigin: process.env.API_ORIGIN || "https://api.example.com",
  dbPath: process.env.DB_PATH || path.join(process.cwd(), "data", "app.db"),
  allowDevLogin: process.env.ALLOW_DEV_LOGIN === "true",
};

module.exports = { config };
