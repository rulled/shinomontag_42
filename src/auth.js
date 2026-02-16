const crypto = require("crypto");
const { config } = require("./config");

function base64urlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64urlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signToken(payload, ttlSeconds = 60 * 60 * 12) {
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = base64urlEncode(JSON.stringify(body));
  const signature = crypto
    .createHmac("sha256", config.appSecret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return null;
  }

  const [encoded, signature] = token.split(".");
  const expectedSignature = crypto
    .createHmac("sha256", config.appSecret)
    .update(encoded)
    .digest("base64url");

  if (signature.length !== expectedSignature.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null;
  }

  const payload = JSON.parse(base64urlDecode(encoded));
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) {
    return null;
  }

  return payload;
}

function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 86400) {
  if (!initData || !botToken) {
    return { ok: false, error: "initData или bot token отсутствуют" };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) {
    return { ok: false, error: "hash отсутствует" };
  }

  const dataCheckString = Array.from(params.entries())
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  if (hash !== calculatedHash) {
    return { ok: false, error: "Неверная подпись initData" };
  }

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || now - authDate > maxAgeSeconds) {
    return { ok: false, error: "Слишком старый auth_date" };
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    return { ok: false, error: "Данные пользователя отсутствуют" };
  }

  let user;
  try {
    user = JSON.parse(userRaw);
  } catch (error) {
    return { ok: false, error: "Некорректный JSON пользователя" };
  }

  return {
    ok: true,
    user,
  };
}

module.exports = {
  signToken,
  verifyToken,
  verifyTelegramInitData,
};
