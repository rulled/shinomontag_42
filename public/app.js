(() => {
  const tg = window.Telegram?.WebApp;

  const state = {
    token: "",
    user: null,
    settings: null,
    selectedSlotIso: "",
    daySlots: [],
    adminDaySlots: [],
    adminBookings: [],
  };

  const dayNames = {
    1: "Понедельник",
    2: "Вторник",
    3: "Среда",
    4: "Четверг",
    5: "Пятница",
    6: "Суббота",
    7: "Воскресенье",
  };

  const apiBaseFromQuery = new URLSearchParams(window.location.search).get("api") || "";
  if (apiBaseFromQuery) {
    localStorage.setItem("apiBase", apiBaseFromQuery);
  }
  const API_BASE = localStorage.getItem("apiBase") || "";

  const els = {
    userInfo: document.getElementById("userInfo"),
    alerts: document.getElementById("alerts"),

    myBooking: document.getElementById("myBooking"),
    cancelBookingBtn: document.getElementById("cancelBookingBtn"),

    bookingDate: document.getElementById("bookingDate"),
    name: document.getElementById("name"),
    phone: document.getElementById("phone"),
    slots: document.getElementById("slots"),
    createBookingBtn: document.getElementById("createBookingBtn"),

    adminSection: document.getElementById("adminSection"),
    adminTimezone: document.getElementById("adminTimezone"),
    adminMinHours: document.getElementById("adminMinHours"),
    adminHorizonDays: document.getElementById("adminHorizonDays"),
    saveSettingsBtn: document.getElementById("saveSettingsBtn"),

    scheduleRows: document.getElementById("scheduleRows"),
    saveScheduleBtn: document.getElementById("saveScheduleBtn"),

    adminDate: document.getElementById("adminDate"),
    refreshAdminDayBtn: document.getElementById("refreshAdminDayBtn"),
    adminSlots: document.getElementById("adminSlots"),

    refreshAdminBookingsBtn: document.getElementById("refreshAdminBookingsBtn"),
    adminBookings: document.getElementById("adminBookings"),
  };

  function showAlert(message, type = "success") {
    els.alerts.className = `card show alert-${type}`;
    els.alerts.textContent = message;
    setTimeout(() => {
      els.alerts.className = "card";
      els.alerts.textContent = "";
      els.alerts.style.display = "none";
    }, 4000);
    els.alerts.style.display = "block";
  }

  async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Ошибка ${res.status}`);
    }

    return data;
  }

  function dateInTimezone(timezone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  async function authenticate() {
    const initData = tg?.initData;

    if (initData) {
      const data = await api("/api/auth/telegram", {
        method: "POST",
        body: JSON.stringify({ initData }),
      });
      state.token = data.token;
      state.user = data.user;
      return;
    }

    const devToken = localStorage.getItem("devToken");
    if (devToken) {
      state.token = devToken;
      const me = await api("/api/me");
      state.user = me.user;
      state.settings = me.settings;
      return;
    }

    throw new Error("Mini App должен запускаться из Telegram");
  }

  async function loadMe() {
    const data = await api("/api/me");
    state.settings = data.settings;

    const fullName = [state.user.firstName, state.user.lastName].filter(Boolean).join(" ");
    els.userInfo.textContent = `${fullName || "Пользователь"} (${state.user.isAdmin ? "администратор" : "клиент"})`;

    if (!els.name.value) {
      els.name.value = state.user.firstName || "";
    }

    const today = dateInTimezone(state.settings.timezone);
    els.bookingDate.value = today;
    els.adminDate.value = today;
  }

  function renderMyBooking(booking) {
    if (!booking) {
      els.myBooking.textContent = "Активной записи нет.";
      els.cancelBookingBtn.hidden = true;
      return;
    }

    els.myBooking.innerHTML = `
      <strong>${booking.slotStartLabel}</strong><br/>
      Имя: ${escapeHtml(booking.userName)}<br/>
      Телефон: ${escapeHtml(booking.phone)}
    `;
    els.cancelBookingBtn.hidden = false;
  }

  async function loadMyBooking() {
    const data = await api("/api/bookings/my");
    renderMyBooking(data.booking);

    const hasBooking = Boolean(data.booking);
    els.createBookingBtn.disabled = hasBooking || !state.selectedSlotIso;
    document.getElementById("bookSection").style.opacity = hasBooking ? "0.55" : "1";
  }

  function renderSlots() {
    els.slots.innerHTML = "";

    const visibleStatuses = new Set(["free", "booked", "blocked", "too_soon", "beyond_horizon", "closed"]);

    state.daySlots
      .filter((slot) => visibleStatuses.has(slot.status))
      .forEach((slot) => {
        const btn = document.createElement("button");
        btn.className = `slot ${slot.status}`;
        btn.textContent = slot.localLabel;
        btn.disabled = slot.status !== "free";

        if (slot.localIso === state.selectedSlotIso) {
          btn.classList.add("selected");
        }

        btn.title = statusLabel(slot.status);

        btn.addEventListener("click", () => {
          state.selectedSlotIso = slot.localIso;
          renderSlots();
          els.createBookingBtn.disabled = false;
        });

        els.slots.appendChild(btn);
      });

    if (!els.slots.innerHTML) {
      els.slots.textContent = "На эту дату слоты недоступны.";
    }
  }

  async function loadSlots() {
    const date = els.bookingDate.value;
    if (!date) return;

    const data = await api(`/api/slots/day?date=${encodeURIComponent(date)}`);
    state.daySlots = data.slots;
    state.selectedSlotIso = "";
    renderSlots();
    els.createBookingBtn.disabled = true;
  }

  async function createBooking() {
    if (!state.selectedSlotIso) {
      showAlert("Выберите слот", "error");
      return;
    }

    const name = els.name.value.trim();
    const phone = els.phone.value.trim();

    if (!name || !phone) {
      showAlert("Введите имя и телефон", "error");
      return;
    }

    await api("/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        slotStartLocalIso: state.selectedSlotIso,
        name,
        phone,
      }),
    });

    showAlert("Запись успешно создана");
    await Promise.all([loadMyBooking(), loadSlots()]);
  }

  async function cancelBooking() {
    await api("/api/bookings/my", { method: "DELETE" });
    showAlert("Запись отменена");
    await Promise.all([loadMyBooking(), loadSlots()]);
  }

  function statusLabel(status) {
    const labels = {
      free: "Свободно",
      booked: "Занято",
      blocked: "Заблокировано",
      closed: "Вне графика",
      too_soon: "Слишком близко",
      beyond_horizon: "За горизонтом записи",
      past: "Прошло",
    };
    return labels[status] || status;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function loadAdmin() {
    if (!state.user.isAdmin) return;

    els.adminSection.hidden = false;

    const data = await api("/api/admin/settings");
    state.settings = data.settings;

    els.adminTimezone.value = data.settings.timezone;
    els.adminMinHours.value = String(data.settings.minHoursBeforeBooking);
    els.adminHorizonDays.value = data.settings.bookingHorizonDays == null ? "" : String(data.settings.bookingHorizonDays);

    renderSchedule(data.schedule);
    await Promise.all([loadAdminDay(), loadAdminBookings()]);
  }

  function renderSchedule(schedule) {
    els.scheduleRows.innerHTML = "";

    schedule.forEach((day) => {
      const row = document.createElement("div");
      row.className = "schedule-row";
      row.dataset.day = String(day.dayOfWeek);

      row.innerHTML = `
        <strong>${dayNames[day.dayOfWeek]}</strong>
        <label><input type="checkbox" class="work" ${day.isWorking ? "checked" : ""}/> Рабочий</label>
        <select class="start">${buildTimeOptions(day.startTime, true)}</select>
        <select class="end">${buildTimeOptions(day.endTime, true)}</select>
      `;

      els.scheduleRows.appendChild(row);
    });
  }

  function buildTimeOptions(selected, include24 = false) {
    const options = [];
    for (let h = 0; h <= 23; h += 1) {
      const hh = String(h).padStart(2, "0");
      options.push(`${hh}:00`);
    }
    if (include24) options.push("24:00");

    return options
      .map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`)
      .join("");
  }

  function collectSchedule() {
    const rows = [...els.scheduleRows.querySelectorAll(".schedule-row")];
    return rows.map((row) => ({
      dayOfWeek: Number(row.dataset.day),
      isWorking: row.querySelector(".work").checked,
      startTime: row.querySelector(".start").value,
      endTime: row.querySelector(".end").value,
    }));
  }

  async function saveAdminSettings() {
    const timezone = els.adminTimezone.value.trim();
    const minHoursBeforeBooking = Number(els.adminMinHours.value || "0");
    const horizonRaw = els.adminHorizonDays.value.trim();

    await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        timezone,
        minHoursBeforeBooking,
        bookingHorizonDays: horizonRaw ? Number(horizonRaw) : null,
      }),
    });

    showAlert("Настройки сохранены");
  }

  async function saveSchedule() {
    const days = collectSchedule();

    await api("/api/admin/schedule", {
      method: "PUT",
      body: JSON.stringify({ days }),
    });

    showAlert("График сохранен");
    await Promise.all([loadSlots(), loadAdminDay()]);
  }

  function renderAdminDaySlots() {
    els.adminSlots.innerHTML = "";

    state.adminDaySlots.forEach((slot) => {
      const card = document.createElement("div");
      card.className = "admin-slot-card";

      const meta = [statusLabel(slot.status)];
      if (slot.status === "booked" && slot.details) {
        meta.push(`${slot.details.userName}, ${slot.details.phone}`);
      }
      if (slot.status === "blocked" && slot.details?.reason) {
        meta.push(slot.details.reason);
      }

      card.innerHTML = `<p><strong>${slot.localLabel}</strong><br/>${meta.join(" | ")}</p>`;

      if (slot.status === "free") {
        const blockBtn = document.createElement("button");
        blockBtn.textContent = "Заблокировать";
        blockBtn.addEventListener("click", async () => {
          const reason = window.prompt("Причина блокировки (необязательно):", "") || "";
          await api("/api/admin/blocked-slots", {
            method: "POST",
            body: JSON.stringify({ slotStartLocalIso: slot.localIso, reason }),
          });
          showAlert("Слот заблокирован");
          await loadAdminDay();
        });
        card.appendChild(blockBtn);
      }

      if (slot.status === "blocked" && slot.details?.id) {
        const unblockBtn = document.createElement("button");
        unblockBtn.textContent = "Разблокировать";
        unblockBtn.addEventListener("click", async () => {
          await api(`/api/admin/blocked-slots/${slot.details.id}`, { method: "DELETE" });
          showAlert("Слот разблокирован");
          await loadAdminDay();
        });
        card.appendChild(unblockBtn);
      }

      els.adminSlots.appendChild(card);
    });
  }

  async function loadAdminDay() {
    const date = els.adminDate.value;
    if (!date) return;

    const data = await api(`/api/admin/day?date=${encodeURIComponent(date)}`);
    state.adminDaySlots = data.slots;
    renderAdminDaySlots();
  }

  function renderAdminBookings() {
    els.adminBookings.innerHTML = "";

    if (!state.adminBookings.length) {
      els.adminBookings.textContent = "Записей на эту дату нет.";
      return;
    }

    state.adminBookings.forEach((booking) => {
      const row = document.createElement("div");
      row.className = "booking-row";

      row.innerHTML = `
        <strong>${booking.slotStartLabel}</strong>
        <span>${escapeHtml(booking.userName)}</span>
        <span>${escapeHtml(booking.phone)}</span>
      `;

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Отменить";
      cancelBtn.className = "danger";
      cancelBtn.addEventListener("click", async () => {
        const reason = window.prompt("Причина отмены (необязательно)", "") || "";
        await api(`/api/admin/bookings/${booking.id}/cancel`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        });
        showAlert("Запись отменена");
        await Promise.all([loadAdminBookings(), loadAdminDay(), loadSlots(), loadMyBooking()]);
      });

      const rescheduleBtn = document.createElement("button");
      rescheduleBtn.textContent = "Перенести";
      rescheduleBtn.addEventListener("click", async () => {
        const next = window.prompt("Новый слот (формат YYYY-MM-DDTHH:00)", booking.slotStartLocalIso);
        if (!next) return;

        await api(`/api/admin/bookings/${booking.id}/reschedule`, {
          method: "POST",
          body: JSON.stringify({ newSlotStartLocalIso: next }),
        });
        showAlert("Запись перенесена");
        await Promise.all([loadAdminBookings(), loadAdminDay(), loadSlots(), loadMyBooking()]);
      });

      row.appendChild(cancelBtn);
      row.appendChild(rescheduleBtn);
      els.adminBookings.appendChild(row);
    });
  }

  async function loadAdminBookings() {
    const date = els.adminDate.value;
    if (!date) return;

    const data = await api(`/api/admin/bookings?date=${encodeURIComponent(date)}`);
    state.adminBookings = data.bookings.filter((x) => x.status === "active");
    renderAdminBookings();
  }

  function bindEvents() {
    els.bookingDate.addEventListener("change", () => {
      loadSlots().catch(handleError);
    });

    els.createBookingBtn.addEventListener("click", () => {
      createBooking().catch(handleError);
    });

    els.cancelBookingBtn.addEventListener("click", () => {
      cancelBooking().catch(handleError);
    });

    els.saveSettingsBtn.addEventListener("click", () => {
      saveAdminSettings().catch(handleError);
    });

    els.saveScheduleBtn.addEventListener("click", () => {
      saveSchedule().catch(handleError);
    });

    els.refreshAdminDayBtn.addEventListener("click", () => {
      loadAdminDay().catch(handleError);
    });

    els.refreshAdminBookingsBtn.addEventListener("click", () => {
      loadAdminBookings().catch(handleError);
    });

    els.adminDate.addEventListener("change", () => {
      Promise.all([loadAdminDay(), loadAdminBookings()]).catch(handleError);
    });
  }

  function handleError(error) {
    const message = error?.message || "Неизвестная ошибка";
    showAlert(message, "error");
    console.error(error);
  }

  async function bootstrap() {
    if (tg) {
      tg.ready();
      tg.expand();
    }

    bindEvents();

    await authenticate();
    await loadMe();
    await Promise.all([loadMyBooking(), loadSlots()]);

    if (state.user.isAdmin) {
      await loadAdmin();
    }
  }

  bootstrap().catch(handleError);
})();
