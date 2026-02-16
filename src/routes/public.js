const express = require("express");
const { z } = require("zod");
const { DateTime } = require("luxon");
const { config } = require("../config");
const { verifyTelegramInitData, signToken } = require("../auth");
const { authRequired, buildSessionUser } = require("./middleware");
const { getSettings } = require("../services/settingsService");
const {
  getDaySlotsDetailed,
  checkSlotBookable,
  formatBooking,
  getUpcomingBookingByUser,
} = require("../services/slotService");
const {
  notifyBookingCreated,
  notifyBookingCanceled,
} = require("../services/notifyService");

function createPublicRouter(db) {
  const router = express.Router();

  router.post("/auth/telegram", (req, res) => {
    const schema = z.object({
      initData: z.string().min(1),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "initData обязателен" });
    }

    const verification = verifyTelegramInitData(parsed.data.initData, config.botToken);
    if (!verification.ok) {
      return res.status(401).json({ error: verification.error });
    }

    const sessionUser = buildSessionUser(verification.user);

    const token = signToken({
      userId: sessionUser.userId,
      firstName: sessionUser.firstName,
      lastName: sessionUser.lastName,
      username: sessionUser.username,
      isAdmin: sessionUser.isAdmin,
    });

    return res.json({
      token,
      user: sessionUser,
    });
  });

  if (config.allowDevLogin) {
    router.post("/auth/dev", (req, res) => {
      const schema = z.object({
        userId: z.number().int().positive(),
        firstName: z.string().default("Dev"),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Некорректные данные" });
      }

      const isAdmin = config.adminIds.includes(parsed.data.userId);
      const token = signToken({
        userId: parsed.data.userId,
        firstName: parsed.data.firstName,
        username: "dev",
        isAdmin,
      });

      return res.json({
        token,
        user: {
          userId: parsed.data.userId,
          firstName: parsed.data.firstName,
          username: "dev",
          isAdmin,
        },
      });
    });
  }

  router.use(authRequired);

  router.get("/me", (req, res) => {
    const settings = getSettings(db);
    return res.json({
      user: req.user,
      settings,
    });
  });

  router.get("/slots/day", (req, res) => {
    const date = String(req.query.date || "");
    const validDate = DateTime.fromISO(date, { zone: "utc" });
    if (!validDate.isValid || date.length !== 10) {
      return res.status(400).json({ error: "Используйте формат даты YYYY-MM-DD" });
    }

    const day = getDaySlotsDetailed(db, date);
    return res.json(day);
  });

  router.get("/bookings/my", (req, res) => {
    const booking = getUpcomingBookingByUser(db, req.user.userId);
    if (!booking) {
      return res.json({ booking: null });
    }

    const settings = getSettings(db);
    return res.json({ booking: formatBooking(booking, settings.timezone) });
  });

  router.post("/bookings", async (req, res) => {
    const schema = z.object({
      slotStartLocalIso: z.string().min(1),
      name: z.string().trim().min(2).max(80),
      phone: z.string().trim().min(6).max(32),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Проверьте поля записи" });
    }

    const check = checkSlotBookable(db, req.user.userId, parsed.data.slotStartLocalIso);
    if (!check.ok) {
      return res.status(400).json({ error: check.error });
    }

    const nowUtc = DateTime.utc().toISO({ suppressMilliseconds: true });

    try {
      const insert = db.prepare(
        `INSERT INTO bookings (
          user_id,
          user_name,
          phone,
          slot_start_utc,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?)`
      );

      const result = insert.run(
        req.user.userId,
        parsed.data.name,
        parsed.data.phone,
        check.slotUtcIso,
        nowUtc,
        nowUtc
      );

      const created = db
        .prepare(
          `SELECT
             id,
             user_id AS userId,
             user_name AS userName,
             phone,
             slot_start_utc AS slotStartUtc,
             status,
             created_at AS createdAt
           FROM bookings
           WHERE id = ?`
        )
        .get(result.lastInsertRowid);

      await notifyBookingCreated({
        booking: created,
        timezone: check.settings.timezone,
      });

      return res.json({ booking: formatBooking(created, check.settings.timezone) });
    } catch (error) {
      if (String(error.message).includes("uniq_active_slot")) {
        return res.status(409).json({ error: "Слот уже занят" });
      }

      console.error("[bookings] create failed:", error);
      return res.status(500).json({ error: "Не удалось создать запись" });
    }
  });

  router.delete("/bookings/my", async (req, res) => {
    const activeBooking = db
      .prepare(
        `SELECT
           id,
           user_id AS userId,
           user_name AS userName,
           phone,
           slot_start_utc AS slotStartUtc,
           status,
           created_at AS createdAt
         FROM bookings
         WHERE user_id = ? AND status = 'active'
         ORDER BY slot_start_utc ASC
         LIMIT 1`
      )
      .get(req.user.userId);

    if (!activeBooking) {
      return res.status(404).json({ error: "Активная запись не найдена" });
    }

    const nowUtc = DateTime.utc().toISO({ suppressMilliseconds: true });

    db.prepare(
      `UPDATE bookings
       SET status = 'canceled', cancel_reason = ?, canceled_by = ?, canceled_at = ?, updated_at = ?
       WHERE id = ?`
    ).run("Отменено пользователем", req.user.userId, nowUtc, nowUtc, activeBooking.id);

    db.prepare("DELETE FROM reminder_logs WHERE booking_id = ?").run(activeBooking.id);

    const settings = getSettings(db);
    await notifyBookingCanceled({
      booking: activeBooking,
      timezone: settings.timezone,
      canceledByAdmin: false,
    });

    return res.json({ ok: true });
  });

  return router;
}

module.exports = {
  createPublicRouter,
};
