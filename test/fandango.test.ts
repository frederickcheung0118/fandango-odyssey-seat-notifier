import assert from "node:assert/strict";
import test from "node:test";

import { TARGETS } from "../src/config.ts";
import { FandangoClient, FandangoError, RequestPacer, extractTargetShowtimes, normalizeSeatMap } from "../src/fandango.ts";

function showtimePayload(): unknown {
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
                  amenityString: "IMAX® 70MM Film, Reserved seating",
                  showtimes: [
                    {
                      date: "3:00p",
                      ticketingDate: "2026-09-02+15:00",
                      type: "available",
                      expired: false,
                      showtimeHashCode: "hash-1500",
                    },
                    {
                      date: "7:00p",
                      ticketingDate: "2026-09-02+19:00",
                      type: "available",
                      expired: false,
                      showtimeHashCode: "hash-1900",
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

test("extracts only the configured movie, format, and exact showtimes", () => {
  const showtimes = extractTargetShowtimes(showtimePayload(), TARGETS[0]!, "2026-09-02");
  assert.equal(showtimes.length, 1);
  assert.equal(showtimes[0]?.hash, "hash-1500");
  assert.equal(showtimes[0]?.startsAtEpochMs, Date.parse("2026-09-02T22:00:00.000Z"));
});

test("normalizes live seat fields and rejects an empty map", () => {
  const map = normalizeSeatMap({
    theaterName: "Regal",
    auditoriumId: 12,
    seats: [{ id: "E10", row: 5, column: "20", status: "a", type: "standard", x: "50" }],
  });
  assert.equal(map.auditoriumId, "12");
  assert.equal(map.seats[0]?.status, "A");
  assert.throws(() => normalizeSeatMap({ seats: [] }), /contains no seats/);
});

test("detects HTML before parsing and opens the in-run circuit", async () => {
  const client = new FandangoClient(
    async () => new Response("<!DOCTYPE html><title>Denied</title>", { headers: { "content-type": "text/html" } }),
    new RequestPacer(0),
  );
  await assert.rejects(
    () => client.theaterShowtimes(TARGETS[0]!, "2026-09-02"),
    (error: unknown) => error instanceof FandangoError && error.code === "BLOCKED" && error.blocksRun,
  );
  assert.equal(client.circuitOpen, true);
  await assert.rejects(
    () => client.theaterShowtimes(TARGETS[0]!, "2026-09-03"),
    (error: unknown) => error instanceof FandangoError && error.code === "CIRCUIT_OPEN",
  );
});

test("retries one transient server failure", async () => {
  let calls = 0;
  const client = new FandangoClient(
    async () => {
      calls += 1;
      return calls === 1
        ? new Response("temporary", { status: 503, headers: { "content-type": "text/plain" } })
        : Response.json(showtimePayload());
    },
    new RequestPacer(0),
  );
  const result = await client.theaterShowtimes(TARGETS[0]!, "2026-09-02");
  assert.equal(calls, 2);
  assert.equal(result.length, 1);
});
