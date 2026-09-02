import assert from "node:assert/strict";
import test from "node:test";

import { calendarDatesForWindow, localDateKey, localDateTimeToEpoch } from "../src/time.ts";

test("converts Los Angeles local showtimes to exact epochs", () => {
  assert.equal(
    localDateTimeToEpoch("2026-09-02T14:30", "America/Los_Angeles"),
    Date.parse("2026-09-02T21:30:00.000Z"),
  );
});

test("rolling window includes every touched local calendar date", () => {
  const start = Date.parse("2026-09-02T17:00:00.000Z");
  const end = start + 168 * 60 * 60_000;
  assert.deepEqual(calendarDatesForWindow(start, end, "America/Los_Angeles"), [
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
    "2026-09-06",
    "2026-09-07",
    "2026-09-08",
    "2026-09-09",
  ]);
  assert.equal(localDateKey(start, "America/Los_Angeles"), "2026-09-02");
});

test("rejects nonexistent local times during a DST jump", () => {
  assert.equal(localDateTimeToEpoch("2026-03-08T02:30", "America/Los_Angeles"), undefined);
});
