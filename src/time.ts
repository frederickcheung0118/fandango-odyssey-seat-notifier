const formatterCache = new Map<string, Intl.DateTimeFormat>();

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const value = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, value);
  return value;
}

export function partsAt(epochMs: number, timeZone: string): LocalParts {
  const values = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(epochMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localDateKey(epochMs: number, timeZone: string): string {
  const value = partsAt(epochMs, timeZone);
  return `${value.year}-${pad(value.month)}-${pad(value.day)}`;
}

export function localDateTimeToEpoch(local: string, timeZone: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})[+T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!match) return undefined;
  const desired = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  const desiredAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
  );
  let guess = desiredAsUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = partsAt(guess, timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const correction = desiredAsUtc - actualAsUtc;
    guess += correction;
    if (correction === 0) break;
  }
  const verified = partsAt(guess, timeZone);
  return Object.keys(desired).every(
    (key) => verified[key as keyof LocalParts] === desired[key as keyof LocalParts],
  )
    ? guess
    : undefined;
}

export function addCalendarDays(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid calendar date: ${date}`);
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

export function calendarDatesForWindow(startEpochMs: number, endEpochMs: number, timeZone: string): string[] {
  const start = localDateKey(startEpochMs, timeZone);
  const end = localDateKey(endEpochMs, timeZone);
  const dates: string[] = [];
  for (let offset = 0; offset < 10; offset += 1) {
    const date = addCalendarDays(start, offset);
    dates.push(date);
    if (date === end) return dates;
  }
  throw new Error("Rolling window unexpectedly spans more than ten calendar dates");
}
