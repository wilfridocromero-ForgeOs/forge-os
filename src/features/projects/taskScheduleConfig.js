export const recurrenceLabels = {
  none: "No se repite",
  daily: "Diariamente",
  weekly: "Semanalmente",
  monthly: "Mensualmente",
  custom: "Personalizado",
};

export const weekdayLabels = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function blankTaskSchedule() {
  const next = new Date();
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return { mode: "none", recurrence_unit: "week", interval_count: 1, weekday: next.getDay(), day_of_month: next.getDate(), first_run: toLocalInput(next), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
}

export function scheduleDraft(task) {
  const schedule = task.recurrence_schedule;
  if (!schedule) return blankTaskSchedule();
  const simpleMode = schedule.interval_count === 1 ? { day: "daily", week: "weekly", month: "monthly" }[schedule.recurrence_unit] : "custom";
  return {
    mode: simpleMode,
    recurrence_unit: schedule.recurrence_unit,
    interval_count: schedule.interval_count,
    weekday: schedule.weekday ?? zonedDateParts(schedule.next_run_at, schedule.timezone).weekday,
    day_of_month: schedule.day_of_month ?? zonedDateParts(schedule.next_run_at, schedule.timezone).day,
    first_run: toZonedInput(schedule.next_run_at, schedule.timezone),
    timezone: schedule.timezone,
  };
}

export function normalizeScheduleDraft(draft) {
  if (draft.mode === "daily") return { ...draft, recurrence_unit: "day", interval_count: 1 };
  if (draft.mode === "weekly") return { ...draft, recurrence_unit: "week", interval_count: 1 };
  if (draft.mode === "monthly") return { ...draft, recurrence_unit: "month", interval_count: 1 };
  return draft;
}

export function recurrenceSummary(schedule) {
  if (!schedule) return "No se repite";
  if (!schedule.active) return "Pausada";
  const every = schedule.interval_count === 1 ? "Cada" : `Cada ${schedule.interval_count}`;
  if (schedule.recurrence_unit === "day") return schedule.interval_count === 1 ? "Diariamente" : `${every} días`;
  if (schedule.recurrence_unit === "week") return schedule.interval_count === 1 ? `Cada ${weekdayLabels[schedule.weekday]}` : `${every} semanas · ${weekdayLabels[schedule.weekday]}`;
  return schedule.interval_count === 1 ? `Cada mes · día ${schedule.day_of_month}` : `${every} meses · día ${schedule.day_of_month}`;
}

export function compactTaskDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const key = (item) => `${item.getFullYear()}-${item.getMonth()}-${item.getDate()}`;
  const prefix = key(date) === key(today) ? "Hoy" : key(date) === key(tomorrow) ? "Mañana" : new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(date);
  return `${prefix} · ${new Intl.DateTimeFormat("es", { hour: "numeric", minute: "2-digit" }).format(date)}`;
}

export function toLocalInput(value) {
  const date = value instanceof Date ? value : new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toZonedInput(value, timezone) {
  const parts = zonedDateParts(value, timezone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function zonedDateParts(value, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short",
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { year: Number(part("year")), month: Number(part("month")), day: Number(part("day")), hour: Number(part("hour")), minute: Number(part("minute")), weekday: weekdays[part("weekday")] };
}

function pad(value) { return String(value).padStart(2, "0"); }
