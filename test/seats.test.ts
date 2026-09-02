import assert from "node:assert/strict";
import test from "node:test";

import { eligibleAvailableGroups, groupsToNotify, snapshotForMap } from "../src/seats.ts";
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
  const groups = eligibleAvailableGroups(
    map([
      seat("E5", 1, 120, { rightNeighbor: "E4" }),
      seat("E4", 2, 150, { leftNeighbor: "E5", rightNeighbor: "E3" }),
      seat("E3", 3, 180, { leftNeighbor: "E4", rightNeighbor: "E2" }),
      seat("E2", 4, 210, { status: "R", leftNeighbor: "E3", rightNeighbor: "E1" }),
      seat("E1", 5, 240, { leftNeighbor: "E2" }),
    ]),
  );
  assert.deepEqual(groups.map((group) => group.key), ["E5+E4+E3"]);
});

test("Irvine-style geometry fallback respects column gaps", () => {
  const groups = eligibleAvailableGroups(
    map([
      seat("E7", 1, 0),
      seat("E6", 2, 30),
      seat("E5", 3, 60),
      seat("E3", 5, 120),
      seat("E2", 6, 150),
      seat("E1", 7, 180),
    ]),
  );
  assert.deepEqual(
    groups.map((group) => group.key).sort(),
    ["E3+E2+E1", "E7+E6+E5"],
  );
});

test("excludes nonstandard seats, unselected rows, and low-scoring edge groups", () => {
  const groups = eligibleAvailableGroups(
    map([
      seat("E12", 1, 0),
      seat("E11", 2, 30),
      seat("E10", 3, 60),
      seat("E9", 10, 270),
      seat("E8", 11, 300),
      seat("E7", 12, 330),
      seat("J6", 13, 360, { row: 10 }),
      seat("J5", 14, 390, { row: 10 }),
      seat("J4", 15, 420, { row: 10 }),
      seat("E3", 16, 450, { type: "wheelchair" }),
      seat("E2", 17, 480, { type: "wheelchair" }),
      seat("E1", 18, 510, { type: "companion" }),
      seat("A1", 20, 220, { row: 1, type: "companion" }),
      seat("M1", 21, 240, { row: 13, type: "companion" }),
    ]),
  );
  assert.deepEqual(groups.map((group) => group.key), ["E9+E8+E7"]);
  assert.ok(groups[0]!.score > 50);
});

test("alerts on first observation and when a group of three becomes available again", () => {
  const before = map([
    seat("E3", 10, 100, { status: "R" }),
    seat("E2", 11, 130),
    seat("E1", 12, 160),
  ]);
  const after = map([seat("E3", 10, 100), seat("E2", 11, 130), seat("E1", 12, 160)]);
  const previous = snapshotForMap(before, new Date("2026-09-02T00:00:00Z"));
  const discovery = groupsToNotify(after, previous);
  assert.deepEqual(discovery.newlyAvailableSeatIds, ["E3"]);
  assert.deepEqual(discovery.groups.map((group) => group.key), ["E3+E2+E1"]);
  assert.deepEqual(groupsToNotify(after, undefined), {
    groups: eligibleAvailableGroups(after),
    newlyAvailableSeatIds: [],
  });
  assert.deepEqual(groupsToNotify(after, snapshotForMap(after, new Date("2026-09-02T00:05:00Z"))), {
    groups: [],
    newlyAvailableSeatIds: [],
  });
  assert.deepEqual(groupsToNotify(after, { ...previous, auditoriumId: "different" }), {
    groups: eligibleAvailableGroups(after),
    newlyAvailableSeatIds: [],
  });
});
