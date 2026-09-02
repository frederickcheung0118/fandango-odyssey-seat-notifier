import assert from "node:assert/strict";
import test from "node:test";

import { eligibleAvailablePairs, returnedPairs, snapshotForMap } from "../src/seats.ts";
import type { RawSeat, SeatMap } from "../src/types.ts";

function seat(
  id: string,
  column: number,
  x: number,
  overrides: Partial<RawSeat> = {},
): RawSeat {
  return { id, row: 5, column, x, y: 100, width: 24, height: 24, status: "A", type: "standard", ...overrides };
}

function map(seats: RawSeat[], auditoriumId = "12"): SeatMap {
  return { theaterName: "Test theater", auditoriumId, seats };
}

test("prefers complete explicit neighbor links", () => {
  const pairs = eligibleAvailablePairs(
    map([
      seat("E4", 1, 120, { rightNeighbor: "E3" }),
      seat("E3", 2, 150, { leftNeighbor: "E4", rightNeighbor: "E2" }),
      seat("E2", 3, 180, { status: "R", leftNeighbor: "E3", rightNeighbor: "E1" }),
      seat("E1", 4, 210, { leftNeighbor: "E2" }),
    ]),
  );
  assert.deepEqual(pairs.map((pair) => pair.key), ["E4+E3"]);
});

test("Irvine-style geometry fallback respects column gaps", () => {
  const pairs = eligibleAvailablePairs(
    map([seat("E4", 1, 0), seat("E3", 2, 30), seat("E2", 4, 60), seat("E1", 5, 90)]),
  );
  assert.deepEqual(
    pairs.map((pair) => pair.key).sort(),
    ["E2+E1", "E4+E3"],
  );
});

test("excludes nonstandard seats, unselected rows, and low-scoring edge pairs", () => {
  const pairs = eligibleAvailablePairs(
    map([
      seat("E8", 1, 0),
      seat("E7", 2, 30),
      seat("E6", 10, 300),
      seat("E5", 11, 330),
      seat("J4", 12, 360, { row: 10 }),
      seat("J3", 13, 390, { row: 10 }),
      seat("E2", 14, 420, { type: "wheelchair" }),
      seat("E1", 15, 450, { type: "companion" }),
      seat("A1", 20, 220, { row: 1, type: "companion" }),
      seat("M1", 21, 240, { row: 13, type: "companion" }),
    ]),
  );
  assert.deepEqual(pairs.map((pair) => pair.key), ["E6+E5"]);
  assert.ok(pairs[0]!.score > 50);
});

test("alerts only when a newly available seat forms an eligible pair", () => {
  const before = map([seat("E2", 10, 100, { status: "R" }), seat("E1", 11, 130)]);
  const after = map([seat("E2", 10, 100), seat("E1", 11, 130)]);
  const previous = snapshotForMap(before, new Date("2026-09-02T00:00:00Z"));
  const discovery = returnedPairs(after, previous);
  assert.deepEqual(discovery.returnedSeatIds, ["E2"]);
  assert.deepEqual(discovery.pairs.map((pair) => pair.key), ["E2+E1"]);
  assert.deepEqual(returnedPairs(after, undefined), { pairs: [], returnedSeatIds: [] });
  assert.deepEqual(returnedPairs(after, { ...previous, auditoriumId: "different" }), {
    pairs: [],
    returnedSeatIds: [],
  });
});
