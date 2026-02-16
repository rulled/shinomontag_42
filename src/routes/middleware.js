const { config } = require("../config");
const { verifyToken } = require("../auth");

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Не авторизован" });
  }

  req.user = payload;
  next();
}

function adminRequired(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }
  next();
}

function buildSessionUser(telegramUser) {
  const userId = Number(telegramUser.id);
  const isAdmin = config.adminIds.includes(userId);

  return {
    userId,
    firstName: telegramUser.first_name || "",
    lastName: telegramUser.last_name || "",
    username: telegramUser.username || "",
    isAdmin,
  };
}

module.exports = {
  authRequired,
  adminRequired,
  buildSessionUser,
};
