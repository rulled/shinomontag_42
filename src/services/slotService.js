const { DateTime } = require("luxon");
const { getSettings, getWeeklySchedule } = require("./settingsService");

function parseTimeToMinutes(value) {
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Некорректное время: ${value}`);
  }

  if (hour === 24 && minute === 0) return 1440;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Некорректное время: ${value}`);
  }

  return hour * 60 + minute;
}

function normalizeSlotFromLocalIso(localIso, timezone) {
  const local = DateTime.fromISO(localIso, { zone: timezone });
  if (!local.isValid) {
    return { ok: false, error: "Некорректная дата/время" };
  }

  if (local.minute !== 0 || local.second !== 0 || local.millisecond !== 0) {
    return { ok: false, error: "Слот должен начинаться ровно в начале часа" };
  }

  return {
    ok: true,
    slotLocal: local,
    slotUtc: local.toUTC(),
  };
}

function isSlotInsideSchedule(slotLocal, scheduleDay, slotDurationMinutes) {
  if (!scheduleDay || !scheduleDay.isWorking) {
    return false;
  }

  const startMinutes = parseTimeToMinutes(scheduleDay.startTime);
  const endMinutes = parseTimeToMinutes(scheduleDay.endTime);

  if (endMinutes <= startMinutes) {
    return false;
  }

  const slotStartMinutes = slotLocal.hour * 60 + slotLocal.minute;
  const slotEndMinutes = slotStartMinutes + slotDurationMinutes;

  return slotStartMinutes >= startMinutes && slotEndMinutes <= endMinutes;
}

function toLocalHuman(slotStartUtc, timezone) {
  return DateTime.fromISO(slotStartUtc, { zone: "utc" })
    .setZone(timezone)
    .toFormat("dd.LL.yyyy HH:mm");
}

function getScheduleMap(scheduleDays) {
  const map = new Map();
  for (const day of scheduleDays) {
    map.set(day.dayOfWeek, day);
  }
  return map;
}

function getDayBoundsUtc(date, timezone) {
  const dayStartLocal = DateTime.fromISO(date, { zone: timezone }).startOf("day");
  const nextDayStartLocal = dayStartLocal.plus({ days: 1 });

  return {
    startUtc: dayStartLocal.toUTC().toISO({ suppressMilliseconds: true }),
    endUtc: nextDayStartLocal.toUTC().toISO({ suppressMilliseconds: true }),
    dayStartLocal,
  };
}

function getDaySlotsDetailed(db, date) {
  const settings = getSettings(db);
  const schedule = getWeeklySchedule(db);
  const scheduleMap = getScheduleMap(schedule);
  const slotDuration = settings.slotDurationMinutes;

  const { startUtc, endUtc, dayStartLocal } = getDayBoundsUtc(date, settings.timezone);

  const bookings = db
    .prepare(
      `SELECT id, user_id AS userId, user_name AS userName, phone, slot_start_utc AS slotStartUtc
       FROM bookings
       WHERE status = 'active' AND slot_start_utc >= ? AND slot_start_utc < ?`
    )
    .all(startUtc, endUtc);

  const blocks = db
    .prepare(
      `SELECT id, slot_start_utc AS slotStartUtc, reason
       FROM blocked_slots
       WHERE slot_start_utc >= ? AND slot_start_utc < ?`
    )
    .all(startUtc, endUtc);

  const bookingMap = new Map(bookings.map((b) => [b.slotStartUtc, b]));
  const blockMap = new Map(blocks.map((b) => [b.slotStartUtc, b]));

  const nowLocal = DateTime.now().setZone(settings.timezone);
  const horizonLimit =
    settings.bookingHorizonDays == null
      ? null
      : nowLocal.plus({ days: settings.bookingHorizonDays });

  const daySchedule = scheduleMap.get(dayStartLocal.weekday);
  const slots = [];

  for (let hour = 0; hour < 24; hour += 1) {
    const slotLocal = dayStartLocal.plus({ hours: hour });
    const slotUtcIso = slotLocal.toUTC().toISO({ suppressMilliseconds: true });
    let status = "free";
    let details = null;

    if (!isSlotInsideSchedule(slotLocal, daySchedule, slotDuration)) {
      status = "closed";
    } else if (slotLocal <= nowLocal) {
      status = "past";
    } else if (slotLocal < nowLocal.plus({ hours: settings.minHoursBeforeBooking })) {
      status = "too_soon";
    } else if (horizonLimit && slotLocal > horizonLimit) {
      status = "beyond_horizon";
    } else if (blockMap.has(slotUtcIso)) {
      status = "blocked";
      details = blockMap.get(slotUtcIso);
    } else if (bookingMap.has(slotUtcIso)) {
      status = "booked";
      details = bookingMap.get(slotUtcIso);
    }

    slots.push({
      localIso: slotLocal.toISO({ suppressMilliseconds: true, includeOffset: false }),
      localLabel: slotLocal.toFormat("HH:mm"),
      utcIso: slotUtcIso,
      status,
      details,
    });
  }

  return {
    date,
    timezone: settings.timezone,
    slots,
  };
}

function validateSlotForBooking(db, slotStartLocalIso, options = {}) {
  const {
    enforceFuture = true,
    enforceLeadTime = true,
    enforceHorizon = true,
  } = options;
  const settings = getSettings(db);
  const schedule = getWeeklySchedule(db);
  const scheduleMap = getScheduleMap(schedule);

  const normalized = normalizeSlotFromLocalIso(slotStartLocalIso, settings.timezone);
  if (!normalized.ok) {
    return normalized;
  }

  const { slotLocal, slotUtc } = normalized;

  const daySchedule = scheduleMap.get(slotLocal.weekday);
  if (!isSlotInsideSchedule(slotLocal, daySchedule, settings.slotDurationMinutes)) {
    return { ok: false, error: "Слот вне рабочего графика" };
  }

  const nowLocal = DateTime.now().setZone(settings.timezone);
  if (enforceFuture && slotLocal <= nowLocal) {
    return { ok: false, error: "Нельзя записаться в прошлое" };
  }

  if (
    enforceLeadTime &&
    slotLocal < nowLocal.plus({ hours: settings.minHoursBeforeBooking })
  ) {
    return {
      ok: false,
      error: `Запись возможна не позднее чем за ${settings.minHoursBeforeBooking} ч.`,
    };
  }

  if (
    enforceHorizon &&
    settings.bookingHorizonDays != null &&
    slotLocal > nowLocal.plus({ days: settings.bookingHorizonDays })
  ) {
    return { ok: false, error: "Дата выходит за горизонт записи" };
  }

  const slotUtcIso = slotUtc.toISO({ suppressMilliseconds: true });

  const blocked = db
    .prepare("SELECT id FROM blocked_slots WHERE slot_start_utc = ?")
    .get(slotUtcIso);
  if (blocked) {
    return { ok: false, error: "Этот слот закрыт администратором" };
  }

  return {
    ok: true,
    slotUtcIso,
    slotLocal,
    settings,
  };
}

function checkSlotBookable(db, userId, slotStartLocalIso) {
  const baseCheck = validateSlotForBooking(db, slotStartLocalIso, {
    enforceFuture: true,
    enforceLeadTime: true,
    enforceHorizon: true,
  });
  if (!baseCheck.ok) return baseCheck;

  const occupied = db
    .prepare("SELECT id FROM bookings WHERE status = 'active' AND slot_start_utc = ?")
    .get(baseCheck.slotUtcIso);
  if (occupied) {
    return { ok: false, error: "Этот слот уже занят" };
  }

  const existingActiveBooking = db
    .prepare(
      `SELECT id
       FROM bookings
       WHERE user_id = ? AND status = 'active'
       LIMIT 1`
    )
    .get(userId);

  if (existingActiveBooking) {
    return { ok: false, error: "У вас уже есть активная запись" };
  }

  return baseCheck;
}

function checkSlotReschedulableForUser(db, userId, slotStartLocalIso, ignoreBookingId) {
  const baseCheck = validateSlotForBooking(db, slotStartLocalIso, {
    enforceFuture: true,
    enforceLeadTime: true,
    enforceHorizon: true,
  });
  if (!baseCheck.ok) return baseCheck;

  const occupied = db
    .prepare(
      `SELECT id, user_id AS userId
       FROM bookings
       WHERE status = 'active' AND slot_start_utc = ?
       LIMIT 1`
    )
    .get(baseCheck.slotUtcIso);

  if (occupied && occupied.id !== ignoreBookingId) {
    return { ok: false, error: "Этот слот уже занят" };
  }

  if (occupied && occupied.userId !== userId) {
    return { ok: false, error: "Этот слот уже занят" };
  }

  return baseCheck;
}

function checkSlotBookableForAdmin(db, slotStartLocalIso, ignoreBookingId = null) {
  const baseCheck = validateSlotForBooking(db, slotStartLocalIso, {
    enforceFuture: true,
    enforceLeadTime: false,
    enforceHorizon: false,
  });
  if (!baseCheck.ok) return baseCheck;

  const occupied = db
    .prepare(
      `SELECT id
       FROM bookings
       WHERE status = 'active' AND slot_start_utc = ?
       LIMIT 1`
    )
    .get(baseCheck.slotUtcIso);

  if (occupied && occupied.id !== ignoreBookingId) {
    return { ok: false, error: "Этот слот уже занят" };
  }

  return baseCheck;
}

function formatBooking(booking, timezone) {
  const local = DateTime.fromISO(booking.slotStartUtc, { zone: "utc" }).setZone(timezone);
  const isRescheduled =
    Boolean(booking.updatedAt) &&
    Boolean(booking.createdAt) &&
    booking.updatedAt !== booking.createdAt;

  return {
    id: booking.id,
    userId: booking.userId,
    userName: booking.userName,
    phone: booking.phone,
    status: booking.status,
    slotStartUtc: booking.slotStartUtc,
    slotStartLocalIso: local.toISO({ suppressMilliseconds: true, includeOffset: false }),
    slotStartLabel: local.toFormat("dd.LL.yyyy HH:mm"),
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    isRescheduled,
  };
}

function getUpcomingBookingByUser(db, userId) {
  return db
    .prepare(
      `SELECT
         id,
         user_id AS userId,
         user_name AS userName,
         phone,
         slot_start_utc AS slotStartUtc,
         status,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM bookings
       WHERE user_id = ? AND status = 'active'
       ORDER BY slot_start_utc ASC
       LIMIT 1`
    )
    .get(userId);
}

module.exports = {
  normalizeSlotFromLocalIso,
  isSlotInsideSchedule,
  toLocalHuman,
  getDaySlotsDetailed,
  checkSlotBookable,
  checkSlotReschedulableForUser,
  checkSlotBookableForAdmin,
  formatBooking,
  getUpcomingBookingByUser,
};
