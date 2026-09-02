import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";

import { renderSeatMapPng, SEAT_MAP_HEIGHT, SEAT_MAP_WIDTH } from "../src/png.ts";
import type { SeatMap } from "../src/types.ts";

test("renders a valid RGB PNG with a highlighted seat", () => {
  const map: SeatMap = {
    theaterName: "Regal Irvine Spectrum",
    auditoriumId: "12",
    seats: [
      { id: "E2", row: 5, column: 20, status: "A", type: "standard", x: 100, y: 50, width: 24, height: 24 },
      { id: "E1", row: 5, column: 21, status: "R", type: "standard", x: 130, y: 50, width: 24, height: 24 },
    ],
  };
  const png = renderSeatMapPng(map, ["E2"]);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 1_000_000);
  const dimensions = new DataView(png.buffer, png.byteOffset + 16, 8);
  assert.equal(dimensions.getUint32(0), SEAT_MAP_WIDTH);
  assert.equal(dimensions.getUint32(4), SEAT_MAP_HEIGHT);
  const idatLength = new DataView(png.buffer, png.byteOffset + 33, 4).getUint32(0);
  const compressed = png.subarray(41, 41 + idatLength);
  assert.equal(inflateSync(compressed).length, SEAT_MAP_HEIGHT * (SEAT_MAP_WIDTH * 3 + 1));
});
