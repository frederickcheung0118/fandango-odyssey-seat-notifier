import { SETTINGS, TARGETS } from "./config.ts";
import { sendErrorNotification, sendRecoveryNotification, sendSeatAlert } from "./discord.ts";
import { FandangoClient, FandangoError } from "./fandango.ts";
import { returnedPairs, snapshotForMap } from "./seats.ts";
import { calendarDatesForWindow } from "./time.ts";
import type {
  Env,
  RunError,
  RunReport,
  SeatAlertEvent,
  SeatSnapshot,
  SnapshotStore,
  StateStore,
  Showtime,
  TargetReport,
  TheaterTarget,
} from "./types.ts";

interface Catalog {
  version: 2;
  fetchedAt: string;
  dates: string[];
  showtimes: Showtime[];
}

interface ErrorState {
  version: 1;
  fingerprint: string;
  lastSentAt: string;
}

export interface MonitorDependencies {
  now?: () => Date;
  client?: FandangoClient;
  sendAlerts?: boolean;
  seatAlertSender?: typeof sendSeatAlert;
}

export interface StatusDependencies {
  errorSender?: typeof sendErrorNotification;
  recoverySender?: typeof sendRecoveryNotification;
}

const CATALOG_TTL_SECONDS = 24 * 60 * 60;
const ERROR_STATE_KEY = "errors:v1";
const SNAPSHOT_STORE_KEY = "snapshots:v4";

function catalogKey(target: TheaterTarget): string {
  return `catalog:v2:${target.id}`;
}

function snapshotId(target: TheaterTarget, showtime: Showtime): string {
  return `${target.id}:${showtime.startsAtLocal}`;
}

async function readJson<T>(state: StateStore, key: string): Promise<T | undefined> {
  try {
    return (await state.get<T>(key, "json")) ?? undefined;
  } catch {
    return undefined;
  }
}

function catalogCovers(catalog: Catalog | undefined, dates: string[]): catalog is Catalog {
  return (
    catalog?.version === 2 &&
    dates.every((date) => catalog.dates.includes(date)) &&
    Number.isFinite(Date.parse(catalog.fetchedAt))
  );
}

function catalogAgeMs(catalog: Catalog, nowMs: number): number {
  return Math.max(0, nowMs - Date.parse(catalog.fetchedAt));
}

async function refreshCatalog(
  state: StateStore,
  client: FandangoClient,
  target: TheaterTarget,
  dates: string[],
  now: Date,
): Promise<Catalog> {
  const showtimes: Showtime[] = [];
  for (const date of dates) showtimes.push(...(await client.theaterShowtimes(target, date)));
  const catalog: Catalog = {
    version: 2,
    fetchedAt: now.toISOString(),
    dates,
    showtimes: [...new Map(showtimes.map((showtime) => [showtime.hash, showtime])).values()],
  };
  await state.put(catalogKey(target), JSON.stringify(catalog), { expirationTtl: CATALOG_TTL_SECONDS });
  return catalog;
}

function runError(
  error: unknown,
  target: TheaterTarget | undefined,
  stage: RunError["stage"],
  showtime?: Showtime,
): RunError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...(target === undefined ? {} : { target: target.name }),
    stage,
    message,
    ...(error instanceof FandangoError ? { code: error.code } : {}),
    ...(showtime === undefined ? {} : { showtime: showtime.startsAtLocal }),
  };
}

async function catalogForTarget(
  env: Env,
  client: FandangoClient,
  target: TheaterTarget,
  dates: string[],
  now: Date,
  errors: RunError[],
): Promise<{ catalog?: Catalog; refreshed: boolean }> {
  const cached = await readJson<Catalog>(env.STATE, catalogKey(target));
  const covered = catalogCovers(cached, dates);
  if (covered && catalogAgeMs(cached, now.getTime()) < SETTINGS.catalogRefreshMinutes * 60_000) {
    return { catalog: cached, refreshed: false };
  }
  try {
    return { catalog: await refreshCatalog(env.STATE, client, target, dates, now), refreshed: true };
  } catch (error) {
    errors.push(runError(error, target, "catalog"));
    if (covered && catalogAgeMs(cached, now.getTime()) <= SETTINGS.staleCatalogHours * 60 * 60_000) {
      return { catalog: cached, refreshed: false };
    }
    return { refreshed: false };
  }
}

function showtimesInWindow(catalog: Catalog | undefined, startMs: number, endMs: number): Showtime[] {
  if (!catalog) return [];
  return catalog.showtimes
    .filter((showtime) => showtime.startsAtEpochMs >= startMs && showtime.startsAtEpochMs <= endMs)
    .sort((left, right) => left.startsAtEpochMs - right.startsAtEpochMs);
}

interface SeatJob {
  target: TheaterTarget;
  showtime: Showtime;
  report: TargetReport;
}

async function runPool<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function snapshotsEqual(left: SeatSnapshot | undefined, right: SeatSnapshot): boolean {
  return (
    left?.version === right.version &&
    left.auditoriumId === right.auditoriumId &&
    left.availableSeatIds.length === right.availableSeatIds.length &&
    left.availableSeatIds.every((id, index) => id === right.availableSeatIds[index])
  );
}

export async function runAllTargets(env: Env, dependencies: MonitorDependencies = {}): Promise<RunReport> {
  const now = dependencies.now?.() ?? new Date();
  const startedAt = now.toISOString();
  const endMs = now.getTime() + SETTINGS.windowHours * 60 * 60_000;
  const dates = calendarDatesForWindow(now.getTime(), endMs, SETTINGS.timeZone);
  const client = dependencies.client ?? new FandangoClient();
  const sendAlerts = dependencies.sendAlerts ?? true;
  const seatAlertSender = dependencies.seatAlertSender ?? sendSeatAlert;
  const errors: RunError[] = [];
  const targetReports: TargetReport[] = [];
  const snapshotStore =
    (await readJson<SnapshotStore>(env.STATE, SNAPSHOT_STORE_KEY)) ??
    ({ version: 4, snapshots: {} } satisfies SnapshotStore);
  if (snapshotStore.version !== 4 || typeof snapshotStore.snapshots !== "object") {
    throw new Error("Stored seat snapshots have an unsupported format");
  }
  let snapshotsChanged = false;
  const jobs: SeatJob[] = [];

  for (const target of TARGETS) {
    const targetReport: TargetReport = {
      target: target.name,
      catalogRefreshed: false,
      showtimesInWindow: 0,
      seatMapsAttempted: 0,
      seatMapsSucceeded: 0,
      baselinesCreated: 0,
      alertsSent: 0,
    };
    targetReports.push(targetReport);
    if (client.circuitOpen) continue;

    const resolved = await catalogForTarget(env, client, target, dates, now, errors);
    targetReport.catalogRefreshed = resolved.refreshed;
    const showtimes = showtimesInWindow(resolved.catalog, now.getTime(), endMs);
    targetReport.showtimesInWindow = showtimes.length;
    jobs.push(...showtimes.map((showtime) => ({ target, showtime, report: targetReport })));
  }

  jobs.sort(
    (left, right) =>
      left.showtime.startsAtEpochMs - right.showtime.startsAtEpochMs || left.target.id.localeCompare(right.target.id),
  );
  await runPool(jobs, SETTINGS.seatMapConcurrency, async ({ target, showtime, report: targetReport }) => {
      if (client.circuitOpen) return;
      targetReport.seatMapsAttempted += 1;
      let event: SeatAlertEvent | undefined;
      let next: SeatSnapshot;
      let key: string;
      try {
        const map = await client.seatMap(showtime.hash, target.pageUrl);
        targetReport.seatMapsSucceeded += 1;
        key = snapshotId(target, showtime);
        const previous = snapshotStore.snapshots[key];
        const discovery = returnedPairs(map, previous);
        next = snapshotForMap(map, now);

        if (!previous || previous.version !== 3 || previous.auditoriumId !== map.auditoriumId) {
          targetReport.baselinesCreated += 1;
        } else if (discovery.pairs.length > 0) {
          event = { target, showtime, map, pairs: discovery.pairs, returnedSeatIds: discovery.returnedSeatIds };
        }
      } catch (error) {
        errors.push(runError(error, target, "seat-map", showtime));
        if (
          (error instanceof FandangoError && error.blocksRun) ||
          (error instanceof FandangoError && error.code === "SCHEMA_CHANGED")
        ) {
          return;
        }
        return;
      }

      if (event && sendAlerts) {
        if (!env.DISCORD_WEBHOOK_URL) {
          errors.push(runError(new Error("DISCORD_WEBHOOK_URL is not configured"), target, "configuration", showtime));
          return;
        }
        try {
          await seatAlertSender(env.DISCORD_WEBHOOK_URL, event);
          targetReport.alertsSent += 1;
        } catch (error) {
          errors.push(runError(error, target, "discord", showtime));
          return;
        }
      } else if (event && !sendAlerts) {
        return;
      }

      if (!snapshotsEqual(snapshotStore.snapshots[key!], next!)) {
        snapshotStore.snapshots[key!] = next!;
        snapshotsChanged = true;
      }
  });

  if (snapshotsChanged) {
    try {
      await env.STATE.put(SNAPSHOT_STORE_KEY, JSON.stringify(snapshotStore));
    } catch (error) {
      errors.push(runError(error, undefined, "state"));
    }
  }

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    targets: targetReports,
    errors: errors.slice(0, 20),
  };
}

function errorFingerprint(errors: RunError[]): string {
  return errors
    .map((error) => `${error.target ?? "global"}|${error.stage}|${error.code ?? error.message}`)
    .sort()
    .join("\n");
}

export async function reportRunStatus(
  env: Env,
  report: RunReport,
  now = new Date(),
  dependencies: StatusDependencies = {},
): Promise<void> {
  const errorSender = dependencies.errorSender ?? sendErrorNotification;
  const recoverySender = dependencies.recoverySender ?? sendRecoveryNotification;
  const previous = await readJson<ErrorState>(env.STATE, ERROR_STATE_KEY);
  if (report.errors.length === 0) {
    if (previous && env.DISCORD_WEBHOOK_URL) {
      await recoverySender(env.DISCORD_WEBHOOK_URL);
      await env.STATE.delete(ERROR_STATE_KEY);
    }
    return;
  }
  if (!env.DISCORD_WEBHOOK_URL) {
    console.error("Fandango notifier errors; Discord webhook is not configured", report.errors);
    return;
  }
  const fingerprint = errorFingerprint(report.errors);
  const shouldSend =
    !previous ||
    previous.fingerprint !== fingerprint ||
    now.getTime() - Date.parse(previous.lastSentAt) >= SETTINGS.errorRepeatHours * 60 * 60_000;
  if (!shouldSend) return;
  await errorSender(env.DISCORD_WEBHOOK_URL, report.errors);
  const next: ErrorState = { version: 1, fingerprint, lastSentAt: now.toISOString() };
  await env.STATE.put(ERROR_STATE_KEY, JSON.stringify(next), { expirationTtl: 30 * 24 * 60 * 60 });
}

export async function runScheduled(env: Env): Promise<RunReport> {
  let report: RunReport;
  try {
    report = await runAllTargets(env);
  } catch (error) {
    const now = new Date();
    report = {
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      targets: [],
      errors: [runError(error, undefined, "configuration")],
    };
  }
  try {
    await reportRunStatus(env, report);
  } catch (error) {
    console.error("Unable to report Fandango notifier status to Discord", error);
  }
  console.log(JSON.stringify(report));
  return report;
}
