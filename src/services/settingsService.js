const { z } = require("zod");

const timeSchema = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/);

function timeToMinutes(value) {
  if (value === "24:00") return 1440;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function getSettings(db) {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const raw = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  const bookingHorizonValue = raw.booking_horizon_days?.trim();

  return {
    timezone: raw.timezone || "Asia/Krasnoyarsk",
    minHoursBeforeBooking: Number(raw.min_hours_before_booking || 2),
    bookingHorizonDays: bookingHorizonValue === "" || bookingHorizonValue == null
      ? null
      : Number(bookingHorizonValue),
    slotDurationMinutes: Number(raw.slot_duration_minutes || 60),
  };
}

function updateSettings(db, updates) {
  const allowedKeys = {
    timezone: "timezone",
    minHoursBeforeBooking: "min_hours_before_booking",
    bookingHorizonDays: "booking_horizon_days",
  };

  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );

  const tx = db.transaction(() => {
    for (const [apiKey, dbKey] of Object.entries(allowedKeys)) {
      if (!(apiKey in updates)) continue;
      const value = updates[apiKey];
      const serialized = value == null ? "" : String(value);
      upsert.run(dbKey, serialized);
    }
  });

  tx();
}

function getWeeklySchedule(db) {
  const rows = db
    .prepare(
      `SELECT day_of_week AS dayOfWeek, is_working AS isWorking, start_time AS startTime, end_time AS endTime
       FROM weekly_schedule
       ORDER BY day_of_week`
    )
    .all();

  return rows.map((row) => ({
    dayOfWeek: row.dayOfWeek,
    isWorking: row.isWorking === 1,
    startTime: row.startTime,
    endTime: row.endTime,
  }));
}

function updateWeeklySchedule(db, scheduleDays) {
  const daySchema = z.object({
    dayOfWeek: z.number().int().min(1).max(7),
    isWorking: z.boolean(),
    startTime: timeSchema,
    endTime: timeSchema,
  });

  const parsed = z.array(daySchema).length(7).parse(scheduleDays);

  const upsert = db.prepare(
    `INSERT INTO weekly_schedule (day_of_week, is_working, start_time, end_time)
     VALUES (@dayOfWeek, @isWorking, @startTime, @endTime)
     ON CONFLICT(day_of_week) DO UPDATE SET
       is_working = excluded.is_working,
       start_time = excluded.start_time,
       end_time = excluded.end_time`
  );

  const tx = db.transaction(() => {
    for (const day of parsed) {
      if (
        day.isWorking &&
        timeToMinutes(day.endTime) <= timeToMinutes(day.startTime)
      ) {
        throw new Error("В рабочем дне время окончания должно быть позже времени начала");
      }

      upsert.run({
        dayOfWeek: day.dayOfWeek,
        isWorking: day.isWorking ? 1 : 0,
        startTime: day.startTime,
        endTime: day.endTime,
      });
    }
  });

  tx();
}

module.exports = {
  getSettings,
  updateSettings,
  getWeeklySchedule,
  updateWeeklySchedule,
};
