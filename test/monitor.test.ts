import assert from "node:assert/strict";
import test from "node:test";

import { TARGETS } from "../src/config.ts";
import { FandangoClient, RequestPacer } from "../src/fandango.ts";
import { reportRunStatus, runAllTargets } from "../src/monitor.ts";
import type { Env, RunReport, SeatAlertEvent } from "../src/types.ts";

class MemoryKv {
  readonly values = new Map<string, string>();

  async get<T>(key: string, _type: "json"): Promise<T | null> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return JSON.parse(value) as T;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function theaterPayload(theaterId: string, date: string): unknown {
  const target = TARGETS.find((value) => value.theaterId === theaterId)!;
  if (date !== "2026-09-02") return { viewModel: { movies: [] } };
  const time = target.id === "ontario" ? "15:00" : "14:30";
  return {
    viewModel: {
      movies: [
        {
          id: 241283,
          title: "The Odyssey (2026)",
          variants: [
            {
              filmFormatHeader: "Premium Format",
              amenityGroups: [
                {
                  amenityString: "IMAX 70MM Film",
                  showtimes: [
                    {
                      date: target.id === "ontario" ? "3:00p" : "2:30p",
                      ticketingDate: `${date}+${time}`,
                      type: "available",
                      expired: false,
                      showtimeHashCode: `${target.id}-hash`,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function mapPayload(targetId: string, groupAvailable: boolean): unknown {
  return {
    theaterName: targetId,
    auditoriumId: targetId === "ontario" ? 13 : 12,
    seats: [
      { id: "E3", row: 5, column: 20, status: groupAvailable ? "A" : "R", type: "standard", x: 100, y: 50, width: 24, height: 24 },
      { id: "E2", row: 5, column: 21, status: "A", type: "standard", x: 130, y: 50, width: 24, height: 24 },
      { id: "E1", row: 5, column: 22, status: "A", type: "standard", x: 160, y: 50, width: 24, height: 24 },
    ],
  };
}

test("alerts on first observation, deduplicates unchanged groups, and alerts after reappearance", async () => {
  let groupAvailable = true;
  let catalogRequests = 0;
  const fetchImpl = async (url: URL): Promise<Response> => {
    if (url.pathname.includes("theaterMovieShowtimes")) {
      catalogRequests += 1;
      const theaterId = url.pathname.split("/").at(-1)!;
      return Response.json(theaterPayload(theaterId, url.searchParams.get("startDate")!));
    }
    const targetId = url.pathname.includes("ontario") ? "ontario" : "irvine";
    return Response.json(mapPayload(targetId, groupAvailable));
  };
  const kv = new MemoryKv();
  const env = {
    STATE: kv,
    DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/token",
  } satisfies Env;
  const now = () => new Date("2026-09-02T17:00:00.000Z");
  const client = new FandangoClient(fetchImpl, new RequestPacer(0));
  const events: SeatAlertEvent[] = [];

  const first = await runAllTargets(env, {
    now,
    client,
    seatAlertSender: async (_webhook, event) => {
      events.push(event);
    },
  });
  assert.equal(first.errors.length, 0);
  assert.equal(first.targets.reduce((sum, target) => sum + target.baselinesCreated, 0), 2);
  assert.equal(events.length, 2);
  assert.equal(catalogRequests, 16);

  const second = await runAllTargets(env, {
    now,
    client,
    seatAlertSender: async (_webhook, event) => {
      events.push(event);
    },
  });
  assert.equal(second.errors.length, 0);
  assert.equal(catalogRequests, 16, "the fresh catalogs should be reused");
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.groups[0]?.key === "E3+E2+E1"));

  groupAvailable = false;
  await runAllTargets(env, {
    now,
    client,
    seatAlertSender: async (_webhook, event) => {
      events.push(event);
    },
  });
  assert.equal(events.length, 2);

  groupAvailable = true;
  await runAllTargets(env, {
    now,
    client,
    seatAlertSender: async (_webhook, event) => {
      events.push(event);
    },
  });
  assert.equal(events.length, 4);
});

test("deduplicates repeated errors and announces recovery", async () => {
  const kv = new MemoryKv();
  const env = {
    STATE: kv,
    DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/token",
  } satisfies Env;
  const failing: RunReport = {
    startedAt: "2026-09-02T17:00:00Z",
    completedAt: "2026-09-02T17:00:01Z",
    targets: [],
    errors: [{ target: "Ontario", stage: "catalog", code: "BLOCKED", message: "HTTP 403" }],
  };
  let errorsSent = 0;
  let recoveriesSent = 0;
  const dependencies = {
    errorSender: async () => {
      errorsSent += 1;
    },
    recoverySender: async () => {
      recoveriesSent += 1;
    },
  };
  await reportRunStatus(env, failing, new Date("2026-09-02T17:00:00Z"), dependencies);
  await reportRunStatus(env, failing, new Date("2026-09-02T18:00:00Z"), dependencies);
  assert.equal(errorsSent, 1);
  await reportRunStatus(env, failing, new Date("2026-09-02T23:00:00Z"), dependencies);
  assert.equal(errorsSent, 2, "the six-hour reminder should be delivered");

  await reportRunStatus(
    env,
    { ...failing, errors: [] },
    new Date("2026-09-02T23:05:00Z"),
    dependencies,
  );
  assert.equal(recoveriesSent, 1);
  assert.equal(kv.values.has("errors:v1"), false);
});
