const express = require("express");
const { z } = require("zod");
const { DateTime } = require("luxon");
const { authRequired, adminRequired } = require("./middleware");
const {
  getSettings,
  updateSettings,
  getWeeklySchedule,
  updateWeeklySchedule,
} = require("../services/settingsService");
const {
  getDaySlotsDetailed,
  checkSlotBookableForAdmin,
  formatBooking,
  normalizeSlotFromLocalIso,
} = require("../services/slotService");
const {
  notifyBookingCanceled,
  notifyBookingRescheduled,
} = require("../services/notifyService");
const { bumpLiveRevision } = require("../services/liveUpdates");

function createAdminRouter(db) {
  const router = express.Router();

  router.use(authRequired, adminRequired);

  router.get("/settings", (req, res) => {
    return res.json({
      settings: getSettings(db),
      schedule: getWeeklySchedule(db),
    });
  });

  router.put("/settings", (req, res) => {
    const schema = z.object({
      timezone: z.string().min(1).optional(),
      minHoursBeforeBooking: z.number().int().min(0).max(168).optional(),
      bookingHorizonDays: z.number().int().min(1).max(3650).nullable().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Некорректные настройки" });
    }

    if (parsed.data.timezone) {
      const zoneCheck = DateTime.now().setZone(parsed.data.timezone);
      if (!zoneCheck.isValid) {
        return res.status(400).json({ error: "Некорректный timezone" });
      }
    }

    try {
      updateSettings(db, parsed.data);
      bumpLiveRevision();
      return res.json({ settings: getSettings(db) });
    } catch (error) {
      console.error("[admin] update settings failed:", error);
      return res.status(500).json({ error: "Не удалось обновить настройки" });
    }
  });

  router.put("/schedule", (req, res) => {
    const schema = z.object({
      days: z.array(
        z.object({
          dayOfWeek: z.number().int().min(1).max(7),
          isWorking: z.boolean(),
          startTime: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/),
          endTime: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/),
        })
      ).length(7),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Некорректный формат расписания" });
    }

    try {
      updateWeeklySchedule(db, parsed.data.days);
      bumpLiveRevision();
      return res.json({ schedule: getWeeklySchedule(db) });
    } catch (error) {
      return res.status(400).json({ error: error.message || "Не удалось обновить расписание" });
    }
  });

  router.get("/day", (req, res) => {
    const date = String(req.query.date || "");
    const validDate = DateTime.fromISO(date, { zone: "utc" });
    if (!validDate.isValid || date.length !== 10) {
      return res.status(400).json({ error: "Используйте формат даты YYYY-MM-DD" });
    }

    return res.json(getDaySlotsDetailed(db, date));
  });

  router.get("/bookings", (req, res) => {
    const date = String(req.query.date || "");
    if (!date) {
      return res.status(400).json({ error: "date обязателен (YYYY-MM-DD)" });
    }

    const settings = getSettings(db);
    const dayStartLocal = DateTime.fromISO(date, { zone: settings.timezone }).startOf("day");
    if (!dayStartLocal.isValid) {
      return res.status(400).json({ error: "Некорректная дата" });
    }

    const dayEndLocal = dayStartLocal.plus({ days: 1 });
    const startUtc = dayStartLocal.toUTC().toISO({ suppressMilliseconds: true });
    const endUtc = dayEndLocal.toUTC().toISO({ suppressMilliseconds: true });

    const rows = db
      .prepare(
        `SELECT
           id,
           user_id AS userId,
           user_name AS userName,
           phone,
           car_plate AS carPlate,
           slot_start_utc AS slotStartUtc,
           status,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM bookings
         WHERE slot_start_utc >= ? AND slot_start_utc < ?
         ORDER BY slot_start_utc ASC`
      )
      .all(startUtc, endUtc);

    return res.json({ bookings: rows.map((row) => formatBooking(row, settings.timezone)) });
  });

  router.get("/bookings/summary", (req, res) => {
    const month = String(req.query.month || "");
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month обязателен в формате YYYY-MM" });
    }

    const settings = getSettings(db);
    const monthStartLocal = DateTime.fromFormat(month, "yyyy-MM", {
      zone: settings.timezone,
    }).startOf("month");

    if (!monthStartLocal.isValid) {
      return res.status(400).json({ error: "Некорректный месяц" });
    }

    const monthEndLocal = monthStartLocal.plus({ months: 1 });
    const startUtc = monthStartLocal.toUTC().toISO({ suppressMilliseconds: true });
    const endUtc = monthEndLocal.toUTC().toISO({ suppressMilliseconds: true });

    const rows = db
      .prepare(
        `SELECT slot_start_utc AS slotStartUtc
         FROM bookings
         WHERE status = 'active' AND slot_start_utc >= ? AND slot_start_utc < ?`
      )
      .all(startUtc, endUtc);

    const counts = new Map();
    for (const row of rows) {
      const localDate = DateTime.fromISO(row.slotStartUtc, { zone: "utc" })
        .setZone(settings.timezone)
        .toISODate();
      counts.set(localDate, (counts.get(localDate) || 0) + 1);
    }

    const summary = [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bookingCount]) => ({ date, bookingCount }));

    return res.json({ month, summary });
  });

  router.post("/blocked-slots", (req, res) => {
    const schema = z.object({
      slotStartLocalIso: z.string().min(1),
      reason: z.string().trim().max(140).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Некорректные данные" });
    }

    const settings = getSettings(db);
    const normalized = normalizeSlotFromLocalIso(parsed.data.slotStartLocalIso, settings.timezone);
    if (!normalized.ok) {
      return res.status(400).json({ error: normalized.error });
    }

    if (normalized.slotLocal <= DateTime.now().setZone(settings.timezone)) {
      return res.status(400).json({ error: "Нельзя блокировать слот в прошлом" });
    }

    const slotUtcIso = normalized.slotUtc.toISO({ suppressMilliseconds: true });

    const activeBooking = db
      .prepare("SELECT id FROM bookings WHERE status = 'active' AND slot_start_utc = ?")
      .get(slotUtcIso);

    if (activeBooking) {
      return res.status(400).json({ error: "Нельзя блокировать занятый слот" });
    }

    try {
      const nowUtc = DateTime.utc().toISO({ suppressMilliseconds: true });
      const result = db
        .prepare(
          `INSERT INTO blocked_slots (slot_start_utc, reason, created_by, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(slotUtcIso, parsed.data.reason || "", req.user.userId, nowUtc);
      bumpLiveRevision();

      return res.json({ id: result.lastInsertRowid, slotStartUtc: slotUtcIso });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        return res.status(409).json({ error: "Слот уже заблокирован" });
      }

      console.error("[admin] block slot failed:", error);
      return res.status(500).json({ error: "Не удалось заблокировать слот" });
    }
  });

  router.delete("/blocked-slots/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Некорректный id" });
    }

    const result = db.prepare("DELETE FROM blocked_slots WHERE id = ?").run(id);
    if (!result.changes) {
      return res.status(404).json({ error: "Блокировка не найдена" });
    }
    bumpLiveRevision();

    return res.json({ ok: true });
  });

  router.post("/bookings/:id/cancel", async (req, res) => {
    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return res.status(400).json({ error: "Некорректный id записи" });
    }

    const schema = z.object({
      reason: z.string().trim().max(200).optional(),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Некорректная причина" });
    }

    const booking = db
      .prepare(
        `SELECT
           id,
           user_id AS userId,
           user_name AS userName,
           phone,
           car_plate AS carPlate,
           slot_start_utc AS slotStartUtc,
           status,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM bookings
         WHERE id = ? AND status = 'active'`
      )
      .get(bookingId);

    if (!booking) {
      return res.status(404).json({ error: "Активная запись не найдена" });
    }

    const nowUtc = DateTime.utc().toISO({ suppressMilliseconds: true });
    db.prepare(
      `UPDATE bookings
       SET status = 'canceled', cancel_reason = ?, canceled_by = ?, canceled_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(parsed.data.reason || "Отменено администратором", req.user.userId, nowUtc, nowUtc, booking.id);

    db.prepare("DELETE FROM reminder_logs WHERE booking_id = ?").run(booking.id);

    const settings = getSettings(db);
    await notifyBookingCanceled({
      booking,
      timezone: settings.timezone,
      canceledByAdmin: true,
      reason: parsed.data.reason || "",
    });
    bumpLiveRevision();

    return res.json({ ok: true });
  });

  router.post("/bookings/:id/reschedule", async (req, res) => {
    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return res.status(400).json({ error: "Некорректный id записи" });
    }

    const schema = z.object({
      newSlotStartLocalIso: z.string().min(1),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Новая дата обязательна" });
    }

    const booking = db
      .prepare(
        `SELECT
           id,
           user_id AS userId,
           user_name AS userName,
           phone,
           car_plate AS carPlate,
           slot_start_utc AS slotStartUtc,
           status,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM bookings
         WHERE id = ? AND status = 'active'`
      )
      .get(bookingId);

    if (!booking) {
      return res.status(404).json({ error: "Активная запись не найдена" });
    }

    const check = checkSlotBookableForAdmin(db, parsed.data.newSlotStartLocalIso, booking.id);
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }

    const oldSlotUtc = booking.slotStartUtc;
    const nowUtc = DateTime.utc().toISO({ suppressMilliseconds: true });

    db.transaction(() => {
      db.prepare(
        `UPDATE bookings
         SET slot_start_utc = ?, updated_at = ?
         WHERE id = ?`
      ).run(check.slotUtcIso, nowUtc, booking.id);

      db.prepare("DELETE FROM reminder_logs WHERE booking_id = ?").run(booking.id);
    })();

    const updatedBooking = {
      ...booking,
      slotStartUtc: check.slotUtcIso,
    };

    await notifyBookingRescheduled({
      booking: updatedBooking,
      oldSlotUtc,
      timezone: check.settings.timezone,
    });
    bumpLiveRevision();

    return res.json({ booking: formatBooking(updatedBooking, check.settings.timezone) });
  });

  return router;
}

module.exports = {
  createAdminRouter,
};
