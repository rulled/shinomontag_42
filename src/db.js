const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { config } = require("./config");

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createDb() {
  ensureDir(config.dbPath);
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weekly_schedule (
      day_of_week INTEGER PRIMARY KEY CHECK(day_of_week >= 1 AND day_of_week <= 7),
      is_working INTEGER NOT NULL CHECK(is_working IN (0, 1)),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocked_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_start_utc TEXT NOT NULL UNIQUE,
      reason TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      car_plate TEXT NOT NULL,
      slot_start_utc TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'canceled', 'completed')),
      cancel_reason TEXT,
      canceled_by INTEGER,
      canceled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_slot
      ON bookings(slot_start_utc)
      WHERE status = 'active';

    CREATE INDEX IF NOT EXISTS idx_bookings_user_status
      ON bookings(user_id, status);

    CREATE INDEX IF NOT EXISTS idx_bookings_slot
      ON bookings(slot_start_utc);

    CREATE TABLE IF NOT EXISTS reminder_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      reminder_type TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      UNIQUE(booking_id, reminder_type),
      FOREIGN KEY(booking_id) REFERENCES bookings(id) ON DELETE CASCADE
    );
  `);

  const bookingColumns = db.prepare("PRAGMA table_info(bookings)").all();
  const hasCarPlate = bookingColumns.some((column) => column.name === "car_plate");
  if (!hasCarPlate) {
    db.exec("ALTER TABLE bookings ADD COLUMN car_plate TEXT NOT NULL DEFAULT '';");
  }

  const defaultSettings = [
    ["timezone", "Asia/Krasnoyarsk"],
    ["min_hours_before_booking", "2"],
    ["booking_horizon_days", ""],
    ["slot_duration_minutes", "60"],
  ];

  const upsertSetting = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO NOTHING`
  );

  const insertSchedule = db.prepare(
    `INSERT INTO weekly_schedule (day_of_week, is_working, start_time, end_time)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(day_of_week) DO NOTHING`
  );

  const seed = db.transaction(() => {
    for (const [key, value] of defaultSettings) {
      upsertSetting.run(key, value);
    }

    for (let day = 1; day <= 7; day += 1) {
      insertSchedule.run(day, 1, "00:00", "24:00");
    }
  });

  seed();
}

module.exports = {
  createDb,
  initDb,
};
