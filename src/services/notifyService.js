const { DateTime } = require("luxon");
const { config } = require("../config");

let bot = null;

function attachBot(botInstance) {
  bot = botInstance;
}

async function sendToUser(userId, text) {
  if (!bot) return;
  try {
    await bot.api.sendMessage(userId, text, { disable_web_page_preview: true });
  } catch (error) {
    // Do not throw notification failures into business flow.
    console.error(`[notify] user message failed (${userId}):`, error.message);
  }
}

async function sendToUserWithOptions(userId, text, options = {}) {
  if (!bot) return;
  try {
    await bot.api.sendMessage(userId, text, {
      disable_web_page_preview: true,
      ...options,
    });
  } catch (error) {
    // Do not throw notification failures into business flow.
    console.error(`[notify] user message failed (${userId}):`, error.message);
  }
}

async function sendToAdmins(text, options = {}) {
  if (!bot) return;
  const jobs = config.adminIds.map((adminId) =>
    sendToUserWithOptions(adminId, text, options)
  );
  await Promise.all(jobs);
}

function formatSlot(slotStartUtc, timezone) {
  return DateTime.fromISO(slotStartUtc, { zone: "utc" })
    .setZone(timezone)
    .toFormat("dd.LL.yyyy HH:mm");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildUserLink(userId, userName) {
  const safeName = escapeHtml(userName || "Пользователь");
  const parsedUserId = Number(userId);
  if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
    return safeName;
  }
  return `<a href="tg://user?id=${parsedUserId}">${safeName}</a>`;
}

async function notifyBookingCreated({ booking, timezone }) {
  const slotText = formatSlot(booking.slotStartUtc, timezone);
  const userLink = buildUserLink(booking.userId, booking.userName);

  await sendToUser(
    booking.userId,
    `Запись создана.\nДата и время: ${slotText}\nИмя: ${booking.userName}\nТелефон: ${booking.phone}`
  );

  await sendToAdmins(
    `Новая запись #${booking.id}.\nДата и время: ${slotText}\nКлиент: ${userLink}\nТелефон: ${escapeHtml(booking.phone)}`,
    { parse_mode: "HTML" }
  );
}

async function notifyBookingCanceled({ booking, timezone, canceledByAdmin = false, reason = "" }) {
  const slotText = formatSlot(booking.slotStartUtc, timezone);

  const userMessage = canceledByAdmin
    ? `Администратор отменил вашу запись на ${slotText}.${reason ? `\nПричина: ${reason}` : ""}`
    : `Вы отменили запись на ${slotText}.`;

  await sendToUser(booking.userId, userMessage);

  await sendToAdmins(
    `Запись #${booking.id} отменена (${canceledByAdmin ? "админ" : "пользователь"}).\nДата и время: ${slotText}\nКлиент: ${booking.userName}\nТелефон: ${booking.phone}${reason ? `\nПричина: ${reason}` : ""}`
  );
}

async function notifyBookingRescheduled({ booking, oldSlotUtc, timezone, byAdmin = true }) {
  const oldSlotText = formatSlot(oldSlotUtc, timezone);
  const newSlotText = formatSlot(booking.slotStartUtc, timezone);

  await sendToUser(
    booking.userId,
    byAdmin
      ? `Ваша запись перенесена администратором.\nБыло: ${oldSlotText}\nСтало: ${newSlotText}`
      : `Вы перенесли запись.\nБыло: ${oldSlotText}\nСтало: ${newSlotText}`
  );

  await sendToAdmins(
    `Запись #${booking.id} перенесена (${byAdmin ? "админ" : "пользователь"}).\nБыло: ${oldSlotText}\nСтало: ${newSlotText}\nКлиент: ${booking.userName}\nТелефон: ${booking.phone}`
  );
}

async function notifyReminder({ booking, timezone, type }) {
  const slotText = formatSlot(booking.slotStartUtc, timezone);
  const labels = {
    "24h": "за 24 часа",
    "4h": "за 4 часа",
    "1h": "за 1 час",
  };

  await sendToUser(
    booking.userId,
    `Напоминание ${labels[type] || ""}: запись на ${slotText}.`
  );
}

module.exports = {
  attachBot,
  sendToUser,
  sendToAdmins,
  notifyBookingCreated,
  notifyBookingCanceled,
  notifyBookingRescheduled,
  notifyReminder,
};
