(() => {
  function getTelegramWebApp() {
    return window.Telegram?.WebApp || null;
  }

  const dayNamesLong = {
    1: "Понедельник",
    2: "Вторник",
    3: "Среда",
    4: "Четверг",
    5: "Пятница",
    6: "Суббота",
    7: "Воскресенье",
  };

  const dayNamesShort = {
    1: "ПН",
    2: "ВТ",
    3: "СР",
    4: "ЧТ",
    5: "ПТ",
    6: "СБ",
    7: "ВС",
  };

  const monthNames = [
    "Январь",
    "Февраль",
    "Март",
    "Апрель",
    "Май",
    "Июнь",
    "Июль",
    "Август",
    "Сентябрь",
    "Октябрь",
    "Ноябрь",
    "Декабрь",
  ];

  const weekdayHeaders = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

  const state = {
    token: "",
    user: null,
    settings: null,
    liveSync: {
      revision: null,
      inFlight: false,
      timerId: null,
    },
    userView: {
      selectedDate: "",
      daySlots: [],
      selectedSlot: null,
      myBooking: null,
    },
    adminView: {
      tab: "calendar",
      monthIso: "",
      selectedDate: "",
      settingsLoaded: false,
      schedule: [],
      daySlots: [],
      bookings: [],
      monthSummary: {},
    },
    modal: {
      reschedule: {
        actor: null,
        booking: null,
        date: "",
        daySlots: [],
        selectedSlot: null,
      },
      reason: {
        resolver: null,
      },
    },
  };

  const apiBaseFromQuery = new URLSearchParams(window.location.search).get("api") || "";
  if (apiBaseFromQuery) {
    localStorage.setItem("apiBase", apiBaseFromQuery);
  }
  const API_BASE = localStorage.getItem("apiBase") || "";

  const els = {
    toast: document.getElementById("toast"),

    userName: document.getElementById("user_name"),
    adminSaveBtn: document.getElementById("admin_save_btn"),

    userScreen: document.getElementById("user_screen"),
    noBookingState: document.getElementById("no-booking-state"),
    activeBookingState: document.getElementById("active-booking-state"),
    activeStatusText: document.getElementById("active_status_text"),
    activeTime: document.getElementById("active-time"),
    activeDetails: document.getElementById("active-details"),
    rescheduleBookingBtn: document.getElementById("reschedule_booking_btn"),
    cancelBookingBtn: document.getElementById("cancel_booking_btn"),

    bookingFlow: document.getElementById("booking_flow"),
    dateStrip: document.getElementById("date_strip"),
    slotsContainer: document.getElementById("slots_container"),

    formSection: document.getElementById("form_section"),
    selectedSlotDisplay: document.getElementById("selected_slot_display"),
    inputName: document.getElementById("input_name"),
    inputPhone: document.getElementById("input_phone"),

    userActionBtn: document.getElementById("user_action_btn"),
    userActionText: document.getElementById("user_action_text"),

    adminScreen: document.getElementById("admin_screen"),
    adminHeaderTitle: document.getElementById("admin_header_title"),

    adminViewCalendar: document.getElementById("admin_view_calendar"),
    adminViewSettings: document.getElementById("admin_view_settings"),

    adminNavCalendar: document.getElementById("admin_nav_calendar"),
    adminNavSettings: document.getElementById("admin_nav_settings"),

    adminMonthTitle: document.getElementById("admin_month_title"),
    adminMonthPrev: document.getElementById("admin_month_prev"),
    adminMonthNext: document.getElementById("admin_month_next"),
    adminCalendarGrid: document.getElementById("admin_calendar_grid"),

    adminBookingsLabel: document.getElementById("admin_bookings_label"),
    adminBookings: document.getElementById("admin_bookings"),
    adminDaySlots: document.getElementById("admin_day_slots"),

    adminScheduleList: document.getElementById("admin_schedule_list"),
    adminMinHours: document.getElementById("admin_min_hours"),
    adminHorizonDays: document.getElementById("admin_horizon_days"),

    rescheduleModal: document.getElementById("reschedule_modal"),
    rescheduleModalTitle: document.getElementById("reschedule_modal_title"),
    rescheduleCloseBtn: document.getElementById("reschedule_close_btn"),
    rescheduleBookingInfo: document.getElementById("reschedule_booking_info"),
    rescheduleDate: document.getElementById("reschedule_date"),
    rescheduleSlots: document.getElementById("reschedule_slots"),
    rescheduleSubmitBtn: document.getElementById("reschedule_submit_btn"),

    reasonModal: document.getElementById("reason_modal"),
    reasonModalTitle: document.getElementById("reason_modal_title"),
    reasonModalLabel: document.getElementById("reason_modal_label"),
    reasonInput: document.getElementById("reason_input"),
    reasonCloseBtn: document.getElementById("reason_close_btn"),
    reasonCancelBtn: document.getElementById("reason_cancel_btn"),
    reasonSubmitBtn: document.getElementById("reason_submit_btn"),
  };

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function showToast(message, type = "success") {
    els.toast.textContent = message;
    els.toast.style.borderColor = type === "error" ? "rgba(255,69,58,0.45)" : "#3a3a3c";
    els.toast.classList.add("show");
    setTimeout(() => {
      els.toast.classList.remove("show");
    }, 3200);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  function parseDateIso(dateIso) {
    const [year, month, day] = dateIso.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function toDateIso(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function addDays(dateIso, days) {
    const date = parseDateIso(dateIso);
    date.setDate(date.getDate() + days);
    return toDateIso(date);
  }

  function addMonths(monthIso, delta) {
    const date = parseDateIso(monthIso);
    date.setMonth(date.getMonth() + delta);
    date.setDate(1);
    return toDateIso(date);
  }

  function monthIsoFromDate(dateIso) {
    const date = parseDateIso(dateIso);
    date.setDate(1);
    return toDateIso(date);
  }

  function monthParamFromIso(monthIso) {
    return monthIso.slice(0, 7);
  }

  function toDayMonthLabel(dateIso) {
    const date = parseDateIso(dateIso);
    const weekday = date.getDay();
    const jsToIso = weekday === 0 ? 7 : weekday;
    const dayName = dayNamesShort[jsToIso];
    return {
      weekday: dayName,
      dayNum: String(date.getDate()),
    };
  }

  function statusLabel(status) {
    const labels = {
      free: "Свободно",
      booked: "Занято",
      blocked: "Заблокировано",
      closed: "Вне графика",
      too_soon: "Слишком близко",
      beyond_horizon: "За горизонтом",
      past: "Прошло",
    };
    return labels[status] || status;
  }

  function normalizeRuPhoneDigits(raw) {
    let digits = String(raw || "").replace(/\D/g, "");
    if (!digits) return "";

    if (digits.startsWith("8")) {
      digits = `7${digits.slice(1)}`;
    }

    if (digits.startsWith("9") && digits.length <= 10) {
      digits = `7${digits}`;
    }

    if (!digits.startsWith("7")) {
      digits = `7${digits}`;
    }

    return digits.slice(0, 11);
  }

  function formatRuPhone(raw) {
    const digits = normalizeRuPhoneDigits(raw);
    if (!digits) return "";

    const p1 = digits.slice(1, 4);
    const p2 = digits.slice(4, 7);
    const p3 = digits.slice(7, 9);
    const p4 = digits.slice(9, 11);

    let result = "+7";

    if (p1.length) {
      result += ` (${p1}`;
      if (p1.length === 3) result += ")";
    }

    if (p2.length) result += ` ${p2}`;
    if (p3.length) result += `-${p3}`;
    if (p4.length) result += `-${p4}`;

    return result;
  }

  function isValidRuPhone(raw) {
    const digits = normalizeRuPhoneDigits(raw);
    return digits.length === 11 && digits.startsWith("7");
  }

  function formatRuPhoneForApi(raw) {
    if (!isValidRuPhone(raw)) return null;
    return formatRuPhone(raw);
  }

  function handlePhoneInput() {
    const formatted = formatRuPhone(els.inputPhone.value);
    if (els.inputPhone.value !== formatted) {
      els.inputPhone.value = formatted;
    }
    updateUserActionButton();
  }

  function isAdmin() {
    return Boolean(state.user?.isAdmin);
  }

  function isBookingLockedForUser() {
    return Boolean(state.userView.myBooking);
  }

  async function waitForTelegramInitData(timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const initData = getTelegramWebApp()?.initData;
      if (initData) {
        return initData;
      }
      await sleep(120);
    }
    return getTelegramWebApp()?.initData || "";
  }

  async function authenticate() {
    const initData = await waitForTelegramInitData();

    if (initData) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const data = await api("/api/auth/telegram", {
            method: "POST",
            body: JSON.stringify({ initData }),
          });
          state.token = data.token;
          state.user = data.user;
          return;
        } catch (error) {
          if (attempt === 3) {
            throw error;
          }
          await sleep(350);
        }
      }
    }

    const devToken = localStorage.getItem("devToken");
    if (devToken) {
      state.token = devToken;
      return;
    }

    throw new Error("Не удалось получить данные Telegram Mini App. Закройте и откройте приложение еще раз.");
  }

  async function loadMe() {
    const data = await api("/api/me");
    state.settings = data.settings;
    state.user = {
      ...(state.user || {}),
      ...data.user,
    };

    const fullName = [state.user.firstName, state.user.lastName].filter(Boolean).join(" ") || "Пользователь";
    els.userName.textContent = fullName;

    if (!els.inputName.value) {
      els.inputName.value = state.user.firstName || "";
    }

    const todayIso = dateInTimezone(state.settings.timezone);
    state.userView.selectedDate = todayIso;
    state.adminView.selectedDate = todayIso;
    state.adminView.monthIso = monthIsoFromDate(todayIso);
    els.adminSaveBtn.hidden = true;
  }

  function renderDateStrip() {
    const todayIso = dateInTimezone(state.settings.timezone);
    const horizon = state.settings.bookingHorizonDays;
    const maxDays = horizon == null ? 14 : Math.max(1, Math.min(horizon + 1, 30));

    const dates = [];
    for (let i = 0; i < maxDays; i += 1) {
      dates.push(addDays(todayIso, i));
    }

    if (!dates.includes(state.userView.selectedDate)) {
      dates.push(state.userView.selectedDate);
      dates.sort();
    }

    els.dateStrip.innerHTML = "";

    dates.forEach((dateIso, index) => {
      const pill = document.createElement("button");
      const { weekday, dayNum } = toDayMonthLabel(dateIso);
      const dayTitle = index === 0 ? "Сегодня" : weekday;
      pill.className = `date-pill ${dateIso === state.userView.selectedDate ? "active" : "inactive"}`;
      pill.innerHTML = `<div class="date-day">${dayTitle}</div><div class="date-num">${dayNum}</div>`;
      pill.addEventListener("click", () => {
        if (isBookingLockedForUser()) return;
        state.userView.selectedDate = dateIso;
        state.userView.selectedSlot = null;
        renderDateStrip();
        loadUserSlots().catch(handleError);
      });
      els.dateStrip.appendChild(pill);
    });
  }

  function renderSlots() {
    els.slotsContainer.innerHTML = "";

    state.userView.daySlots.forEach((slot) => {
      const slotEl = document.createElement("button");
      slotEl.className = `slot-item ${slot.status}`;
      if (state.userView.selectedSlot?.localIso === slot.localIso) {
        slotEl.classList.add("selected");
      }

      slotEl.title = statusLabel(slot.status);
      slotEl.disabled = slot.status !== "free" || isBookingLockedForUser();
      slotEl.innerHTML = `<span class="slot-time">${slot.localLabel}</span>`;

      if (!slotEl.disabled) {
        slotEl.addEventListener("click", () => {
          state.userView.selectedSlot = slot;
          els.selectedSlotDisplay.textContent = slot.localLabel;
          els.formSection.hidden = false;
          renderSlots();
          updateUserActionButton();
        });
      }

      els.slotsContainer.appendChild(slotEl);
    });

    if (!state.userView.daySlots.length) {
      els.slotsContainer.innerHTML = `<div class="empty-state">На эту дату слоты недоступны</div>`;
    }
  }

  function renderMyBooking() {
    const booking = state.userView.myBooking;

    if (!booking) {
      els.noBookingState.hidden = false;
      els.activeBookingState.hidden = true;
      els.bookingFlow.classList.remove("hidden");
      els.userActionBtn.classList.remove("hidden");
      updateUserActionButton();
      return;
    }

    els.noBookingState.hidden = true;
    els.activeBookingState.hidden = false;
    els.activeStatusText.textContent = booking.isRescheduled ? "ПЕРЕНЕСЕНО" : "ПОДТВЕРЖДЕНО";
    els.activeTime.textContent = booking.slotStartLabel;
    els.activeDetails.textContent = `${booking.userName} • ${booking.phone}`;
    els.bookingFlow.classList.add("hidden");
    els.formSection.hidden = true;
    els.userActionBtn.classList.add("hidden");
    state.userView.selectedSlot = null;
  }

  function updateUserActionButton() {
    if (isBookingLockedForUser()) {
      els.userActionBtn.disabled = true;
      els.userActionText.textContent = "Есть активная запись";
      return;
    }

    const selected = state.userView.selectedSlot;
    const name = els.inputName.value.trim();
    const phone = els.inputPhone.value.trim();

    if (!selected) {
      els.userActionBtn.disabled = true;
      els.userActionText.textContent = "Выберите слот";
      return;
    }

    if (!name || !phone) {
      els.userActionBtn.disabled = true;
      els.userActionText.textContent = `Введите имя и телефон (${selected.localLabel})`;
      return;
    }

    if (!isValidRuPhone(phone)) {
      els.userActionBtn.disabled = true;
      els.userActionText.textContent = "Введите телефон в формате +7 (900) 000-00-00";
      return;
    }

    els.userActionBtn.disabled = false;
    els.userActionText.textContent = `Записаться на ${selected.localLabel}`;
  }

  async function loadMyBooking() {
    const data = await api("/api/bookings/my");
    state.userView.myBooking = data.booking;
    renderMyBooking();
  }

  async function loadLiveRevision() {
    const data = await api("/api/updates/version");
    state.liveSync.revision = Number(data.revision);
  }

  async function runLiveSyncTick() {
    if (state.liveSync.inFlight || document.hidden) {
      return;
    }

    state.liveSync.inFlight = true;
    try {
      const data = await api("/api/updates/version");
      const remoteRevision = Number(data.revision);

      if (!Number.isFinite(remoteRevision)) {
        return;
      }

      if (state.liveSync.revision == null) {
        state.liveSync.revision = remoteRevision;
        return;
      }

      if (remoteRevision === state.liveSync.revision) {
        return;
      }

      state.liveSync.revision = remoteRevision;

      if (isAdmin()) {
        await Promise.all([loadAdminMonthSummary(), loadAdminDateData(), loadAdminSettings()]);
        renderAdminCalendar();
        renderAdminTab();
      } else {
        await Promise.all([loadMyBooking(), loadUserSlots()]);
      }
    } catch (error) {
      console.error("[live-sync] tick failed:", error);
    } finally {
      state.liveSync.inFlight = false;
    }
  }

  function startLiveSync() {
    if (state.liveSync.timerId) {
      clearInterval(state.liveSync.timerId);
    }

    state.liveSync.timerId = setInterval(() => {
      runLiveSyncTick().catch(() => {});
    }, 5000);
  }

  async function loadUserSlots() {
    const dateIso = state.userView.selectedDate;
    const data = await api(`/api/slots/day?date=${encodeURIComponent(dateIso)}`);
    state.userView.daySlots = data.slots;

    if (
      state.userView.selectedSlot &&
      !state.userView.daySlots.some(
        (slot) =>
          slot.localIso === state.userView.selectedSlot.localIso &&
          slot.status === "free"
      )
    ) {
      state.userView.selectedSlot = null;
      els.formSection.hidden = true;
      els.selectedSlotDisplay.textContent = "--:--";
    }

    renderSlots();
    updateUserActionButton();
  }

  async function createBooking() {
    if (isBookingLockedForUser()) {
      showToast("У вас уже есть активная запись", "error");
      return;
    }

    const selected = state.userView.selectedSlot;
    if (!selected) {
      showToast("Выберите слот", "error");
      return;
    }

    const name = els.inputName.value.trim();
    const phoneRaw = els.inputPhone.value.trim();
    const phone = formatRuPhoneForApi(phoneRaw);

    if (!name || !phoneRaw) {
      showToast("Введите имя и телефон", "error");
      return;
    }

    if (!phone) {
      showToast("Телефон должен быть в формате +7 (900) 000-00-00", "error");
      return;
    }

    await api("/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        slotStartLocalIso: selected.localIso,
        name,
        phone,
      }),
    });

    showToast("Запись успешно создана");
    await Promise.all([loadMyBooking(), loadUserSlots()]);
  }

  async function cancelBooking() {
    if (!state.userView.myBooking) return;

    const confirmed = window.confirm("Отменить текущую запись?");
    if (!confirmed) return;

    await api("/api/bookings/my", { method: "DELETE" });
    showToast("Запись отменена");
    await Promise.all([loadMyBooking(), loadUserSlots()]);
  }

  function setUiMode(mode) {
    if (mode === "admin" && !isAdmin()) return;
    const isUser = mode === "user";

    els.userScreen.hidden = !isUser;
    els.adminScreen.hidden = isUser;
    document.body.classList.toggle("admin-mode", !isUser);
    els.userName.hidden = !isUser;

    if (!isUser) {
      renderAdminTab();
    }
  }

  function buildTimeOptions(selected) {
    const options = [];
    for (let h = 0; h <= 23; h += 1) {
      const hh = pad2(h);
      const value = `${hh}:00`;
      options.push(`<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`);
    }
    options.push(`<option value="24:00" ${selected === "24:00" ? "selected" : ""}>24:00</option>`);
    return options.join("");
  }

  function renderAdminSchedule() {
    els.adminScheduleList.innerHTML = "";

    state.adminView.schedule
      .slice()
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
      .forEach((day) => {
        const row = document.createElement("div");
        row.className = `day-row ${day.isWorking ? "" : "off"}`;
        row.dataset.day = String(day.dayOfWeek);

        row.innerHTML = `
          <span class="day-name">${dayNamesShort[day.dayOfWeek]}</span>
          <div class="day-controls">
            <div class="day-time-range">
              <select class="time-select day-start">${buildTimeOptions(day.startTime)}</select>
              <select class="time-select day-end">${buildTimeOptions(day.endTime)}</select>
            </div>
            <label class="toggle-switch">
              <input class="day-toggle" type="checkbox" ${day.isWorking ? "checked" : ""} />
              <span class="toggle-ui"></span>
            </label>
          </div>
        `;

        const checkbox = row.querySelector(".day-toggle");
        const startSelect = row.querySelector(".day-start");
        const endSelect = row.querySelector(".day-end");

        function syncRowState() {
          row.classList.toggle("off", !checkbox.checked);
          startSelect.disabled = !checkbox.checked;
          endSelect.disabled = !checkbox.checked;
        }

        checkbox.addEventListener("change", syncRowState);
        syncRowState();

        els.adminScheduleList.appendChild(row);
      });
  }

  function collectAdminSchedule() {
    const rows = [...els.adminScheduleList.querySelectorAll(".day-row")];
    return rows.map((row) => ({
      dayOfWeek: Number(row.dataset.day),
      isWorking: row.querySelector(".day-toggle").checked,
      startTime: row.querySelector(".day-start").value,
      endTime: row.querySelector(".day-end").value,
    }));
  }

  async function loadAdminSettings() {
    const data = await api("/api/admin/settings");

    state.settings = data.settings;
    state.adminView.schedule = data.schedule;
    state.adminView.settingsLoaded = true;

    els.adminMinHours.value = String(data.settings.minHoursBeforeBooking ?? 2);
    els.adminHorizonDays.value = data.settings.bookingHorizonDays == null ? "" : String(data.settings.bookingHorizonDays);

    renderAdminSchedule();
  }

  async function loadAdminMonthSummary() {
    const month = monthParamFromIso(state.adminView.monthIso);
    const data = await api(`/api/admin/bookings/summary?month=${encodeURIComponent(month)}`);
    state.adminView.monthSummary = {};
    for (const item of data.summary) {
      state.adminView.monthSummary[item.date] = item.bookingCount;
    }
  }

  function renderAdminCalendar() {
    const selectedDate = state.adminView.selectedDate;
    const monthIso = state.adminView.monthIso;
    const monthDate = parseDateIso(monthIso);

    els.adminMonthTitle.textContent = `${monthNames[monthDate.getMonth()]} ${monthDate.getFullYear()}`;
    els.adminCalendarGrid.innerHTML = "";

    weekdayHeaders.forEach((wd) => {
      const cell = document.createElement("div");
      cell.className = "weekday-label";
      cell.textContent = wd;
      els.adminCalendarGrid.appendChild(cell);
    });

    const firstDayWeekJs = monthDate.getDay();
    const firstDayOffset = (firstDayWeekJs + 6) % 7;
    const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();

    for (let i = 0; i < firstDayOffset; i += 1) {
      const empty = document.createElement("div");
      empty.className = "calendar-day empty";
      empty.textContent = ".";
      els.adminCalendarGrid.appendChild(empty);
    }

    const todayIso = dateInTimezone(state.settings.timezone);

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateIso = `${monthDate.getFullYear()}-${pad2(monthDate.getMonth() + 1)}-${pad2(day)}`;
      const btn = document.createElement("button");
      btn.className = "calendar-day";
      const count = state.adminView.monthSummary[dateIso] || 0;
      btn.innerHTML = `<span>${day}</span>${count > 0 ? `<span class="calendar-count">${count > 9 ? "9+" : count}</span>` : ""}`;

      if (dateIso === selectedDate) {
        btn.classList.add("active");
      }

      if (dateIso === todayIso) {
        btn.classList.add("today");
      }

      btn.addEventListener("click", () => {
        state.adminView.selectedDate = dateIso;
        renderAdminCalendar();
        loadAdminDateData().catch(handleError);
      });

      els.adminCalendarGrid.appendChild(btn);
    }
  }

  function renderAdminBookings() {
    const date = parseDateIso(state.adminView.selectedDate);
    const label = `${date.getDate()} ${monthNames[date.getMonth()].toLowerCase()}`;
    els.adminBookingsLabel.textContent = `Записи на ${label}`;

    els.adminBookings.innerHTML = "";

    if (!state.adminView.bookings.length) {
      els.adminBookings.innerHTML = `<div class="empty-state">На этот день записей нет</div>`;
      return;
    }

    state.adminView.bookings.forEach((booking) => {
      const card = document.createElement("div");
      card.className = "booking-card";
      card.innerHTML = `
        <div class="booking-header">
          <span class="booking-time">${booking.slotStartLabel.slice(-5)}</span>
        </div>
        <div class="booking-user-info">
          ${buildBookingUserNameLink(booking)}
          <span class="user-phone">${escapeHtml(booking.phone)}</span>
        </div>
        <div class="booking-actions">
          <button class="action-btn btn-reschedule">Перенести</button>
          <button class="action-btn btn-cancel">Отменить</button>
        </div>
      `;

      const [rescheduleBtn, cancelBtn] = card.querySelectorAll("button");

      rescheduleBtn.addEventListener("click", async () => {
        await openRescheduleModal(booking);
      });

      cancelBtn.addEventListener("click", async () => {
        const reason = await askReasonInput({
          title: "Отмена записи",
          label: "Причина отмены (необязательно)",
          submitText: "Отменить запись",
          placeholder: "Комментарий для клиента",
        });
        if (reason == null) return;

        await api(`/api/admin/bookings/${booking.id}/cancel`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        });

        showToast("Запись отменена");
        await loadAdminDateData({ includeSummary: true });
      });

      els.adminBookings.appendChild(card);
    });
  }

  function renderAdminDaySlots() {
    els.adminDaySlots.innerHTML = "";

    const visibleSlots = state.adminView.daySlots.filter((slot) => ["free", "blocked", "booked"].includes(slot.status));

    if (!visibleSlots.length) {
      els.adminDaySlots.innerHTML = `<div class="empty-state">Нет управляемых слотов на дату</div>`;
      return;
    }

    visibleSlots.forEach((slot) => {
      const card = document.createElement("div");
      card.className = "slot-card";

      const statusText = statusLabel(slot.status);
      let detailsText = statusText;

      if (slot.status === "booked" && slot.details) {
        detailsText = `${statusText}: ${slot.details.userName}, ${slot.details.phone}`;
      }

      if (slot.status === "blocked" && slot.details?.reason) {
        detailsText = `${statusText}: ${slot.details.reason}`;
      }

      card.innerHTML = `
        <div class="slot-meta">
          <span class="slot-primary">${slot.localLabel}</span>
          <span class="slot-secondary">${escapeHtml(detailsText)}</span>
        </div>
      `;

      if (slot.status === "free") {
        const blockBtn = document.createElement("button");
        blockBtn.className = "slot-action";
        blockBtn.textContent = "Блок";
        blockBtn.addEventListener("click", async () => {
          const reason = await askReasonInput({
            title: "Блокировка слота",
            label: "Причина блокировки (необязательно)",
            submitText: "Заблокировать",
            placeholder: "Например: перерыв",
          });
          if (reason == null) return;

          await api("/api/admin/blocked-slots", {
            method: "POST",
            body: JSON.stringify({ slotStartLocalIso: slot.localIso, reason }),
          });
          showToast("Слот заблокирован");
          await loadAdminDateData();
        });
        card.appendChild(blockBtn);
      }

      if (slot.status === "blocked" && slot.details?.id) {
        const unblockBtn = document.createElement("button");
        unblockBtn.className = "slot-action danger";
        unblockBtn.textContent = "Разблокировать";
        unblockBtn.addEventListener("click", async () => {
          await api(`/api/admin/blocked-slots/${slot.details.id}`, {
            method: "DELETE",
          });
          showToast("Слот разблокирован");
          await loadAdminDateData();
        });
        card.appendChild(unblockBtn);
      }

      els.adminDaySlots.appendChild(card);
    });
  }

  function closeRescheduleModal() {
    state.modal.reschedule.actor = null;
    state.modal.reschedule.booking = null;
    state.modal.reschedule.date = "";
    state.modal.reschedule.daySlots = [];
    state.modal.reschedule.selectedSlot = null;
    els.rescheduleModal.classList.add("hidden");
    els.rescheduleModal.classList.remove("raised");
    els.rescheduleSlots.innerHTML = "";
    els.rescheduleSubmitBtn.disabled = true;
  }

  function getRescheduleOptions(current) {
    return current.daySlots.filter((slot) => {
      if (slot.status === "free") return true;
      if (!current.booking) return false;

      return slot.localIso === current.booking.slotStartLocalIso;
    });
  }

  function renderRescheduleSlots() {
    const current = state.modal.reschedule;
    els.rescheduleSlots.innerHTML = "";

    const options = getRescheduleOptions(current);

    if (!options.length) {
      els.rescheduleSlots.innerHTML = `<div class="empty-state">Нет доступных слотов на выбранную дату</div>`;
      els.rescheduleSubmitBtn.disabled = true;
      return;
    }

    options.forEach((slot) => {
      const isCurrentBookingSlot = slot.localIso === current.booking?.slotStartLocalIso;
      const isSelected = current.selectedSlot?.localIso === slot.localIso;
      const btn = document.createElement("button");
      btn.className = `modal-slot ${isCurrentBookingSlot ? "free" : slot.status} ${isSelected ? "selected" : ""}`;
      btn.textContent = isCurrentBookingSlot ? `${slot.localLabel} (текущий)` : slot.localLabel;
      btn.addEventListener("click", () => {
        current.selectedSlot = slot;
        renderRescheduleSlots();
      });
      els.rescheduleSlots.appendChild(btn);
    });

    els.rescheduleSubmitBtn.disabled = !current.selectedSlot;
  }

  async function loadRescheduleDaySlots() {
    const current = state.modal.reschedule;
    if (!current.date) return;
    const path =
      current.actor === "admin"
        ? `/api/admin/day?date=${encodeURIComponent(current.date)}`
        : `/api/slots/day?date=${encodeURIComponent(current.date)}`;
    const data = await api(path);
    current.daySlots = data.slots;
    if (
      current.selectedSlot &&
      !current.daySlots.some((slot) => slot.localIso === current.selectedSlot.localIso)
    ) {
      current.selectedSlot = null;
    }
    renderRescheduleSlots();
  }

  async function openRescheduleModal(booking, actor = "admin") {
    state.modal.reschedule.actor = actor;
    state.modal.reschedule.booking = booking;
    state.modal.reschedule.date = booking.slotStartLocalIso.slice(0, 10);
    state.modal.reschedule.daySlots = [];
    state.modal.reschedule.selectedSlot = null;

    els.rescheduleModalTitle.textContent = actor === "admin" ? "Перенос записи" : "Перенос вашей записи";
    els.rescheduleBookingInfo.textContent =
      actor === "admin"
        ? `Запись #${booking.id}: ${booking.userName}, ${booking.phone}`
        : `Текущая запись: ${booking.slotStartLabel}`;
    els.rescheduleDate.value = state.modal.reschedule.date;
    els.rescheduleModal.classList.toggle("raised", actor === "user");
    els.rescheduleModal.classList.remove("hidden");
    els.rescheduleSlots.innerHTML = `<div class="empty-state">Загрузка слотов...</div>`;
    els.rescheduleSubmitBtn.disabled = true;

    await loadRescheduleDaySlots();
  }

  async function submitRescheduleModal() {
    const current = state.modal.reschedule;
    if (!current.booking || !current.selectedSlot) {
      showToast("Выберите новый слот", "error");
      return;
    }

    if (current.actor === "admin") {
      await api(`/api/admin/bookings/${current.booking.id}/reschedule`, {
        method: "POST",
        body: JSON.stringify({ newSlotStartLocalIso: current.selectedSlot.localIso }),
      });
    } else {
      await api("/api/bookings/my/reschedule", {
        method: "POST",
        body: JSON.stringify({ newSlotStartLocalIso: current.selectedSlot.localIso }),
      });
    }

    closeRescheduleModal();
    showToast("Запись перенесена");

    if (current.actor === "admin") {
      await loadAdminDateData({ includeSummary: true });
    } else {
      await Promise.all([loadMyBooking(), loadUserSlots()]);
    }
  }

  async function loadAdminDateData({ includeSummary = false } = {}) {
    const date = state.adminView.selectedDate;
    const jobs = [
      api(`/api/admin/bookings?date=${encodeURIComponent(date)}`),
      api(`/api/admin/day?date=${encodeURIComponent(date)}`),
    ];

    if (includeSummary) {
      jobs.push(loadAdminMonthSummary());
    }

    const [bookingsData, dayData] = await Promise.all(jobs);

    state.adminView.bookings = bookingsData.bookings.filter((b) => b.status === "active");
    state.adminView.daySlots = dayData.slots;

    if (includeSummary) {
      renderAdminCalendar();
    }

    renderAdminBookings();
    renderAdminDaySlots();
  }

  function renderAdminTab() {
    const tab = state.adminView.tab;
    const isSettings = tab === "settings";

    els.adminViewCalendar.hidden = isSettings;
    els.adminViewSettings.hidden = !isSettings;
    els.adminHeaderTitle.textContent = isSettings ? "Редактор расписания" : "Записи";
    els.adminSaveBtn.hidden = !isSettings;

    els.adminNavCalendar.classList.toggle("active", !isSettings);
    els.adminNavSettings.classList.toggle("active", isSettings);
  }

  async function saveAdminAll() {
    const minHoursBeforeBooking = Number(els.adminMinHours.value || "0");
    const horizonRaw = els.adminHorizonDays.value.trim();

    await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        minHoursBeforeBooking,
        bookingHorizonDays: horizonRaw ? Number(horizonRaw) : null,
      }),
    });

    await api("/api/admin/schedule", {
      method: "PUT",
      body: JSON.stringify({
        days: collectAdminSchedule(),
      }),
    });

    showToast("Настройки сохранены");
    await Promise.all([loadAdminSettings(), loadAdminDateData({ includeSummary: true })]);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function buildBookingUserNameLink(booking) {
    const safeName = escapeHtml(booking.userName || "Пользователь");
    const userId = Number(booking.userId);

    if (!Number.isInteger(userId) || userId <= 0) {
      return `<span class="user-name">${safeName}</span>`;
    }

    return `<a class="user-name user-link" href="tg://user?id=${userId}">${safeName}</a>`;
  }

  function closeReasonModal({ resolveWith = null } = {}) {
    els.reasonModal.classList.add("hidden");
    els.reasonInput.value = "";

    const resolver = state.modal.reason.resolver;
    state.modal.reason.resolver = null;
    if (resolver) {
      resolver(resolveWith);
    }
  }

  function askReasonInput({ title, label, submitText, placeholder = "" }) {
    return new Promise((resolve) => {
      state.modal.reason.resolver = resolve;

      els.reasonModalTitle.textContent = title;
      els.reasonModalLabel.textContent = label;
      els.reasonSubmitBtn.textContent = submitText;
      els.reasonInput.placeholder = placeholder;
      els.reasonInput.value = "";

      els.reasonModal.classList.remove("hidden");
      setTimeout(() => els.reasonInput.focus(), 0);
    });
  }

  async function openUserRescheduleModal() {
    if (!state.userView.myBooking) {
      showToast("Активная запись не найдена", "error");
      return;
    }
    await openRescheduleModal(state.userView.myBooking, "user");
  }

  function bindEvents() {
    els.inputName.addEventListener("input", updateUserActionButton);
    els.inputPhone.addEventListener("input", handlePhoneInput);

    els.userActionBtn.addEventListener("click", () => {
      createBooking().catch(handleError);
    });

    els.cancelBookingBtn.addEventListener("click", () => {
      cancelBooking().catch(handleError);
    });
    els.rescheduleBookingBtn.addEventListener("click", () => {
      openUserRescheduleModal().catch(handleError);
    });

    els.adminNavCalendar.addEventListener("click", () => {
      state.adminView.tab = "calendar";
      renderAdminTab();
    });

    els.adminNavSettings.addEventListener("click", async () => {
      state.adminView.tab = "settings";
      renderAdminTab();
      if (!state.adminView.settingsLoaded) {
        await loadAdminSettings();
      }
    });

    els.adminMonthPrev.addEventListener("click", () => {
      state.adminView.monthIso = addMonths(state.adminView.monthIso, -1);
      const monthDate = parseDateIso(state.adminView.monthIso);
      state.adminView.selectedDate = `${monthDate.getFullYear()}-${pad2(monthDate.getMonth() + 1)}-01`;
      Promise.all([loadAdminMonthSummary(), loadAdminDateData()])
        .then(() => renderAdminCalendar())
        .catch(handleError);
    });

    els.adminMonthNext.addEventListener("click", () => {
      state.adminView.monthIso = addMonths(state.adminView.monthIso, 1);
      const monthDate = parseDateIso(state.adminView.monthIso);
      state.adminView.selectedDate = `${monthDate.getFullYear()}-${pad2(monthDate.getMonth() + 1)}-01`;
      Promise.all([loadAdminMonthSummary(), loadAdminDateData()])
        .then(() => renderAdminCalendar())
        .catch(handleError);
    });

    els.adminSaveBtn.addEventListener("click", () => {
      saveAdminAll().catch(handleError);
    });

    els.rescheduleCloseBtn.addEventListener("click", closeRescheduleModal);
    els.rescheduleModal.addEventListener("click", (event) => {
      if (event.target === els.rescheduleModal) {
        closeRescheduleModal();
      }
    });
    els.rescheduleDate.addEventListener("change", () => {
      state.modal.reschedule.date = els.rescheduleDate.value;
      state.modal.reschedule.selectedSlot = null;
      loadRescheduleDaySlots().catch(handleError);
    });
    els.rescheduleSubmitBtn.addEventListener("click", () => {
      submitRescheduleModal().catch(handleError);
    });

    els.reasonCloseBtn.addEventListener("click", () => closeReasonModal({ resolveWith: null }));
    els.reasonCancelBtn.addEventListener("click", () => closeReasonModal({ resolveWith: null }));
    els.reasonModal.addEventListener("click", (event) => {
      if (event.target === els.reasonModal) {
        closeReasonModal({ resolveWith: null });
      }
    });
    els.reasonSubmitBtn.addEventListener("click", () => {
      closeReasonModal({ resolveWith: els.reasonInput.value.trim() });
    });
    els.reasonInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        closeReasonModal({ resolveWith: els.reasonInput.value.trim() });
      }
    });
  }

  function handleError(error) {
    console.error(error);
    if (els.userName && els.userName.textContent === "Авторизация...") {
      els.userName.textContent = "Ошибка авторизации";
    }
    showToast(error?.message || "Неизвестная ошибка", "error");
  }

  async function bootstrap() {
    const tg = getTelegramWebApp();
    if (tg) {
      tg.ready();
      tg.expand();
    }

    bindEvents();

    await authenticate();
    await loadMe();

    if (isAdmin()) {
      setUiMode("admin");
      await loadAdminSettings();
      await loadAdminMonthSummary();
      renderAdminCalendar();
      await loadAdminDateData();
    } else {
      setUiMode("user");
      renderDateStrip();
      await Promise.all([loadMyBooking(), loadUserSlots()]);
    }

    await loadLiveRevision();
    startLiveSync();
  }

  bootstrap().catch(handleError);
})();
