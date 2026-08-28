export type TemporalField = "starts_at" | "due_at";

export type TemporalResolution =
  | { state: "EXACT"; value: string; timezone: string }
  | { state: "NEEDS_TIMEZONE" }
  | { state: "AMBIGUOUS"; reason: string };

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};
const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalize(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es").trim().replace(/\s+/g, " ");
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function localToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedParts(new Date(instant), timezone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    instant += desired - represented;
  }
  const final = zonedParts(new Date(instant), timezone);
  if (
    final.year !== year || final.month !== month || final.day !== day ||
    final.hour !== hour || final.minute !== minute
  ) return null;
  return new Date(instant).toISOString();
}

function addDays(
  parts: { year: number; month: number; day: number },
  days: number,
) {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function resolveNaturalTaskDate(
  phrase: string,
  field: TemporalField,
  timezone: unknown,
  now = new Date(),
): TemporalResolution {
  if (!isValidTimeZone(timezone)) return { state: "NEEDS_TIMEZONE" };
  const input = normalize(phrase);
  const today = zonedParts(now, timezone);
  let date: { year: number; month: number; day: number } | null = null;
  if (/\bpasado manana\b/.test(input)) date = addDays(today, 2);
  else if (/\bmanana\b/.test(input)) date = addDays(today, 1);
  else if (/\bhoy\b/.test(input)) date = addDays(today, 0);
  const weekday = Object.entries(WEEKDAYS).find(([name]) =>
    new RegExp(`\\b${name}\\b`).test(input)
  );
  if (!date && weekday) {
    const todayWeekday = new Date(
      Date.UTC(today.year, today.month - 1, today.day),
    ).getUTCDay();
    let delta = (weekday[1] - todayWeekday + 7) % 7;
    if (input.includes("proximo") || input.includes("siguiente")) {
      delta = delta === 0 ? 7 : delta + 7;
    } else if (delta === 0) delta = 7;
    date = addDays(today, delta);
  }
  const isoDate = input.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const localDate = input.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
  const namedDate = input.match(
    /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/,
  );
  if (!date && isoDate) {
    date = {
      year: Number(isoDate[1]),
      month: Number(isoDate[2]),
      day: Number(isoDate[3]),
    };
  }
  if (!date && localDate) {
    date = {
      year: Number(localDate[3]),
      month: Number(localDate[2]),
      day: Number(localDate[1]),
    };
  }
  if (!date && namedDate) {
    date = {
      year: Number(namedDate[3] || today.year),
      month: MONTHS[namedDate[2]],
      day: Number(namedDate[1]),
    };
    if (
      !namedDate[3] &&
      Date.UTC(date.year, date.month - 1, date.day) <
        Date.UTC(today.year, today.month - 1, today.day)
    ) date.year += 1;
  }
  if (!date) return { state: "AMBIGUOUS", reason: "date_not_understood" };
  const time = input.match(
    /(?:(?:a|antes\s+de)\s+las\s+([01]?\d|2[0-3])(?::([0-5]\d))?|\b([01]?\d|2[0-3]):([0-5]\d)\b|\b([01]?\d|2[0-3])\s*(?:h|hrs?|horas?)\b)/,
  );
  const hour = time
    ? Number(time[1] ?? time[3] ?? time[5])
    : field === "due_at"
    ? 23
    : 0;
  const minute = time
    ? Number(time[2] ?? time[4] ?? 0)
    : field === "due_at"
    ? 59
    : 0;
  const second = time ? 0 : field === "due_at" ? 59 : 0;
  const value = localToIso(
    date.year,
    date.month,
    date.day,
    hour,
    minute,
    second,
    timezone,
  );
  return value
    ? { state: "EXACT", value, timezone }
    : { state: "AMBIGUOUS", reason: "invalid_local_datetime" };
}
