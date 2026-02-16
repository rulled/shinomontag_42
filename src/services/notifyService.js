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

async function sendToAdmins(text) {
  if (!bot) return;
  const jobs = config.adminIds.map((adminId) => sendToUser(adminId, text));
  await Promise.all(jobs);
}

function formatSlot(slotStartUtc, timezone) {
  return DateTime.fromISO(slotStartUtc, { zone: "utc" })
    .setZone(timezone)
    .toFormat("dd.LL.yyyy HH:mm");
}

async function notifyBookingCreated({ booking, timezone }) {
  const slotText = formatSlot(booking.slotStartUtc, timezone);

  await sendToUser(
    booking.userId,
    `Запись создана.\nДата и время: ${slotText}\nИмя: ${booking.userName}\nТелефон: ${booking.phone}`
  );

  await sendToAdmins(
    `Новая запись #${booking.id}.\nДата и время: ${slotText}\nКлиент: ${booking.userName}\nТелефон: ${booking.phone}\nuser_id: ${booking.userId}`
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

async function notifyBookingRescheduled({ booking, oldSlotUtc, timezone }) {
  const oldSlotText = formatSlot(oldSlotUtc, timezone);
  const newSlotText = formatSlot(booking.slotStartUtc, timezone);

  await sendToUser(
    booking.userId,
    `Ваша запись перенесена администратором.\nБыло: ${oldSlotText}\nСтало: ${newSlotText}`
  );

  await sendToAdmins(
    `Запись #${booking.id} перенесена.\nБыло: ${oldSlotText}\nСтало: ${newSlotText}\nКлиент: ${booking.userName}\nТелефон: ${booking.phone}`
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
