import { SETTINGS } from "./config.ts";
import { localDateTimeToEpoch } from "./time.ts";
import type { RawSeat, SeatMap, Showtime, TheaterTarget } from "./types.ts";

const ORIGIN = "https://www.fandango.com";
const ALLOWED_PATHS = ["/napi/theaterMovieShowtimes/", "/napi/seatMap/"] as const;

export type FandangoErrorCode =
  | "CIRCUIT_OPEN"
  | "FORBIDDEN_REQUEST"
  | "HTTP_ERROR"
  | "RATE_LIMITED"
  | "BLOCKED"
  | "NON_JSON_RESPONSE"
  | "INVALID_JSON"
  | "SCHEMA_CHANGED"
  | "TIMEOUT"
  | "NETWORK_ERROR";

export class FandangoError extends Error {
  readonly code: FandangoErrorCode;
  readonly blocksRun: boolean;
  readonly status?: number;

  constructor(code: FandangoErrorCode, message: string, options: { blocksRun?: boolean; status?: number } = {}) {
    super(message);
    this.name = "FandangoError";
    this.code = code;
    this.blocksRun = options.blocksRun ?? false;
    if (options.status !== undefined) this.status = options.status;
  }
}

type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;
type Sleep = (milliseconds: number) => Promise<void>;
const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export class RequestPacer {
  private nextStartAt = 0;
  private readonly spacingMs: number;
  private readonly sleep: Sleep;
  private readonly now: () => number;

  constructor(
    spacingMs: number = SETTINGS.requestSpacingMs,
    sleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: () => number = Date.now,
  ) {
    this.spacingMs = spacingMs;
    this.sleep = sleep;
    this.now = now;
  }

  async wait(): Promise<void> {
    const current = this.now();
    const scheduledStart = Math.max(current, this.nextStartAt);
    this.nextStartAt = scheduledStart + this.spacingMs;
    const delay = scheduledStart - current;
    if (delay > 0) await this.sleep(delay);
  }
}

export class FandangoClient {
  private circuitError?: FandangoError;
  private readonly fetchImpl: FetchLike;
  private readonly pacer: RequestPacer;
  private readonly timeoutMs: number;

  constructor(
    fetchImpl: FetchLike = defaultFetch,
    pacer = new RequestPacer(),
    timeoutMs: number = SETTINGS.requestTimeoutMs,
  ) {
    this.fetchImpl = fetchImpl;
    this.pacer = pacer;
    this.timeoutMs = timeoutMs;
  }

  get circuitOpen(): boolean {
    return this.circuitError !== undefined;
  }

  async theaterShowtimes(target: TheaterTarget, date: string): Promise<Showtime[]> {
    const data = await this.getJson(
      `/napi/theaterMovieShowtimes/${encodeURIComponent(target.theaterId)}`,
      {
        chainCode: target.chainCode,
        startDate: date,
        isdesktop: "true",
        partnerRestrictedTicketing: "",
      },
      target.pageUrl,
    );
    return extractTargetShowtimes(data, target, date);
  }

  async seatMap(showtimeHash: string, referer: string): Promise<SeatMap> {
    const data = await this.getJson(`/napi/seatMap/${encodeURIComponent(showtimeHash)}`, {}, referer);
    return normalizeSeatMap(data);
  }

  private async getJson(path: string, query: Record<string, string>, referer: string): Promise<unknown> {
    if (this.circuitError) {
      throw new FandangoError("CIRCUIT_OPEN", `Fandango checks stopped after ${this.circuitError.code}`, {
        blocksRun: true,
      });
    }
    if (!ALLOWED_PATHS.some((prefix) => path.startsWith(prefix))) {
      throw new FandangoError("FORBIDDEN_REQUEST", `Refusing non-read-only path: ${path}`);
    }
    const url = new URL(path, ORIGIN);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.pacer.wait();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "en-US,en;q=0.9",
            Referer: referer,
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Safari/605.1.15",
            "X-Requested-With": "XMLHttpRequest",
          },
        });
        const body = await response.text();
        if (response.status === 403) {
          throw this.trip(new FandangoError("BLOCKED", "Fandango returned HTTP 403", { blocksRun: true, status: 403 }));
        }
        if (response.status === 429) {
          throw this.trip(
            new FandangoError("RATE_LIMITED", "Fandango returned HTTP 429", { blocksRun: true, status: 429 }),
          );
        }
        if (!response.ok) {
          const error = new FandangoError("HTTP_ERROR", `Fandango returned HTTP ${response.status}`, {
            status: response.status,
          });
          if (response.status >= 500 && attempt === 0) {
            lastError = error;
            continue;
          }
          throw error;
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("application/json")) {
          const looksHtml = /^\s*(?:<!doctype|<html|<head|<body)/i.test(body);
          throw this.trip(
            new FandangoError(
              looksHtml ? "BLOCKED" : "NON_JSON_RESPONSE",
              `Fandango returned ${contentType || "an unknown content type"} instead of JSON`,
              { blocksRun: looksHtml },
            ),
          );
        }
        try {
          return JSON.parse(body) as unknown;
        } catch {
          throw this.trip(
            new FandangoError("INVALID_JSON", "Fandango returned malformed JSON", { blocksRun: true }),
          );
        }
      } catch (error) {
        if (error instanceof FandangoError) throw error;
        const normalized =
          error instanceof Error && error.name === "AbortError"
            ? new FandangoError("TIMEOUT", `Fandango request timed out after ${this.timeoutMs}ms`)
            : new FandangoError(
                "NETWORK_ERROR",
                `Fandango request failed: ${error instanceof Error ? error.message : String(error)}`,
              );
        if (attempt === 0) {
          lastError = normalized;
          continue;
        }
        throw normalized;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new FandangoError("NETWORK_ERROR", "Fandango request failed");
  }

  private trip(error: FandangoError): FandangoError {
    this.circuitError = error;
    return error;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function normalizedFormat(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isImax70mm(...values: Array<string | undefined>): boolean {
  const combined = normalizedFormat(values.filter(Boolean).join(" "));
  return combined.includes("imax") && combined.includes("70mm");
}

function showtimeLocalValue(raw: Record<string, unknown>, fallbackDate: string): string | undefined {
  const ticketingDate = text(raw.ticketingDate);
  if (ticketingDate && /^\d{4}-\d{2}-\d{2}[+T]\d{2}:\d{2}/.test(ticketingDate)) return ticketingDate;
  const rawDate = text(raw.date);
  if (rawDate && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rawDate)) return rawDate;
  const display = rawDate && /^(\d{1,2}):(\d{2})(a|p)$/i.exec(rawDate);
  if (!display) return undefined;
  let hour = Number(display[1]);
  const minute = display[2];
  const meridiem = display[3]?.toLowerCase();
  if (hour === 12) hour = 0;
  if (meridiem === "p") hour += 12;
  return `${fallbackDate}T${String(hour).padStart(2, "0")}:${minute}`;
}

function localTime(local: string): string | undefined {
  return /[+T](\d{2}:\d{2})/.exec(local)?.[1];
}

function collectVariantShowtimes(
  variantValue: unknown,
  target: TheaterTarget,
  fallbackDate: string,
): Showtime[] {
  const variant = record(variantValue);
  if (!variant) return [];
  const variantFormat = text(variant.filmFormatHeader);
  const groups = [
    { format: variantFormat, values: array(variant.showtimes) },
    ...array(variant.amenityGroups).map((groupValue) => {
      const group = record(groupValue);
      return { format: [variantFormat, text(group?.amenityString)].filter(Boolean).join(" "), values: array(group?.showtimes) };
    }),
  ];
  const results: Showtime[] = [];
  for (const group of groups) {
    for (const rawValue of group.values) {
      const raw = record(rawValue);
      if (!raw) continue;
      const formatNames = array(raw.filmFormat)
        .map(record)
        .flatMap((value) => [text(value?.filterName), text(value?.name), text(value?.label), text(value?.value)])
        .filter((value): value is string => value !== undefined);
      if (!isImax70mm(group.format, ...formatNames)) continue;
      if (raw.expired === true || normalizedFormat(text(raw.type) ?? "") !== "available") continue;
      const hash = text(raw.showtimeHashCode);
      const startsAtLocal = showtimeLocalValue(raw, fallbackDate);
      if (!hash || !startsAtLocal) continue;
      const time = localTime(startsAtLocal);
      if (!time || !target.includedTimes.includes(time)) continue;
      const startsAtEpochMs = localDateTimeToEpoch(startsAtLocal, SETTINGS.timeZone);
      if (startsAtEpochMs === undefined) continue;
      const ticketingUrl = text(raw.ticketingJumpPageURL);
      results.push({
        hash,
        startsAtLocal: startsAtLocal.replace("+", "T"),
        startsAtEpochMs,
        displayTime: text(raw.date) ?? time,
        ...(ticketingUrl === undefined ? {} : { ticketingUrl }),
      });
    }
  }
  return results;
}

export function extractTargetShowtimes(data: unknown, target: TheaterTarget, fallbackDate: string): Showtime[] {
  const root = record(data);
  const viewModel = record(root?.viewModel);
  if (!root || !viewModel || !Array.isArray(viewModel.movies)) {
    throw new FandangoError("SCHEMA_CHANGED", "Unexpected Fandango theater-showtimes response shape");
  }
  const results: Showtime[] = [];
  for (const movieValue of viewModel.movies) {
    const movie = record(movieValue);
    if (!movie) continue;
    const idMatches = String(movie.id ?? "") === SETTINGS.movieId;
    const titleMatches = normalizedFormat(text(movie.title) ?? text(movie.name) ?? "").includes("the odyssey");
    if (!idMatches && !titleMatches) continue;
    for (const variant of array(movie.variants)) results.push(...collectVariantShowtimes(variant, target, fallbackDate));
  }
  return [...new Map(results.map((showtime) => [showtime.hash, showtime])).values()].sort(
    (left, right) => left.startsAtEpochMs - right.startsAtEpochMs,
  );
}

export function normalizeSeatMap(data: unknown): SeatMap {
  const root = record(data);
  if (!root || !Array.isArray(root.seats)) {
    throw new FandangoError("SCHEMA_CHANGED", "Unexpected Fandango seat-map response shape");
  }
  const seats: RawSeat[] = [];
  for (const value of root.seats) {
    const seat = record(value);
    const id = text(seat?.id);
    const row = seat?.row;
    const column = number(seat?.column);
    const status = text(seat?.status);
    if (!id || (typeof row !== "string" && typeof row !== "number") || column === undefined || !status) {
      throw new FandangoError("SCHEMA_CHANGED", "Fandango seat map contains an invalid seat");
    }
    const type = text(seat?.type) ?? "unknown";
    const x = number(seat?.x);
    const y = number(seat?.y);
    const width = number(seat?.width);
    const height = number(seat?.height);
    const leftNeighbor = text(seat?.leftNeighbor);
    const rightNeighbor = text(seat?.rightNeighbor);
    seats.push({
      id,
      row,
      column,
      status: status.toUpperCase(),
      type: type.toLowerCase(),
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(leftNeighbor === undefined ? {} : { leftNeighbor }),
      ...(rightNeighbor === undefined ? {} : { rightNeighbor }),
    });
  }
  if (seats.length === 0) throw new FandangoError("SCHEMA_CHANGED", "Fandango seat map contains no seats");
  const totalWidth = number(root.totalWidth);
  const totalHeight = number(root.totalHeight);
  return {
    theaterName: text(root.theaterName) ?? "Unknown theater",
    auditoriumId: String(root.auditoriumId ?? "unknown"),
    ...(totalWidth === undefined ? {} : { totalWidth }),
    ...(totalHeight === undefined ? {} : { totalHeight }),
    seats,
  };
}
