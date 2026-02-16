const { DateTime } = require("luxon");
const { getSettings } = require("./services/settingsService");
const { notifyReminder } = require("./services/notifyService");

async function runReminderTick(db) {
  const settings = getSettings(db);

  const nowUtcIso = DateTime.utc().toISO({ suppressMilliseconds: true });
  const next24hIso = DateTime.utc().plus({ hours: 24 }).toISO({ suppressMilliseconds: true });

  db.prepare(
    `UPDATE bookings
     SET status = 'completed', updated_at = ?
     WHERE status = 'active' AND slot_start_utc <= ?`
  ).run(nowUtcIso, DateTime.utc().minus({ hours: 1 }).toISO({ suppressMilliseconds: true }));

  const bookings = db
    .prepare(
      `SELECT
         id,
         user_id AS userId,
         user_name AS userName,
         phone,
         slot_start_utc AS slotStartUtc
       FROM bookings
       WHERE status = 'active' AND slot_start_utc > ? AND slot_start_utc <= ?`
    )
    .all(nowUtcIso, next24hIso);

  const hasReminderStmt = db.prepare(
    `SELECT id FROM reminder_logs WHERE booking_id = ? AND reminder_type = ?`
  );

  const insertReminderStmt = db.prepare(
    `INSERT INTO reminder_logs (booking_id, reminder_type, sent_at) VALUES (?, ?, ?)`
  );

  for (const booking of bookings) {
    const diffHours = DateTime.fromISO(booking.slotStartUtc, { zone: "utc" })
      .diff(DateTime.utc(), "hours")
      .hours;

    let reminderType = null;
    if (diffHours <= 24 && diffHours > 4) reminderType = "24h";
    else if (diffHours <= 4 && diffHours > 1) reminderType = "4h";
    else if (diffHours <= 1 && diffHours > 0) reminderType = "1h";

    if (!reminderType) continue;

    const alreadySent = hasReminderStmt.get(booking.id, reminderType);
    if (alreadySent) continue;

    await notifyReminder({
      booking,
      timezone: settings.timezone,
      type: reminderType,
    });

    insertReminderStmt.run(
      booking.id,
      reminderType,
      DateTime.utc().toISO({ suppressMilliseconds: true })
    );
  }
}

function startScheduler(db) {
  runReminderTick(db).catch((error) => {
    console.error("[scheduler] first tick failed:", error);
  });

  setInterval(() => {
    runReminderTick(db).catch((error) => {
      console.error("[scheduler] tick failed:", error);
    });
  }, 60 * 1000);
}

module.exports = {
  startScheduler,
};
