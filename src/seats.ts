import { SETTINGS } from "./config.ts";
import type { RawSeat, Seat, SeatMap, SeatPair, SeatSnapshot } from "./types.ts";

function rowFromId(id: string, rawRow: string | number): string {
  const label = /^([A-Za-z]+)[- ]?\d+$/.exec(id)?.[1];
  if (label) return label.toUpperCase();
  if (typeof rawRow === "number" && rawRow >= 1 && rawRow <= 26) return String.fromCharCode(64 + rawRow);
  return String(rawRow).toUpperCase();
}

function rowOrdinal(row: string, rawRow: string | number): number {
  if (typeof rawRow === "number" && Number.isFinite(rawRow)) return rawRow - 1;
  if (/^[A-Z]$/.test(row)) return row.charCodeAt(0) - 65;
  const parsed = Number(rawRow);
  return Number.isFinite(parsed) ? parsed : 0;
}

function seatNumber(id: string): number | undefined {
  const value = Number(/(\d+)$/.exec(id)?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

export function normalizeSeats(map: SeatMap): Seat[] {
  return map.seats.map((raw) => {
    const row = rowFromId(raw.id, raw.row);
    const number = seatNumber(raw.id);
    return {
      id: raw.id,
      row,
      rowOrdinal: rowOrdinal(row, raw.row),
      ...(number === undefined ? {} : { number }),
      column: raw.column,
      status: raw.status,
      type: raw.type,
      available: raw.status === "A",
      x: raw.x ?? raw.column * 30,
      y: raw.y ?? rowOrdinal(row, raw.row) * 30,
      width: raw.width ?? 24,
      height: raw.height ?? 24,
      ...(raw.leftNeighbor === undefined ? {} : { leftNeighbor: raw.leftNeighbor }),
      ...(raw.rightNeighbor === undefined ? {} : { rightNeighbor: raw.rightNeighbor }),
    };
  });
}

function eligible(seat: Seat): boolean {
  return (
    seat.available &&
    seat.type === "standard" &&
    SETTINGS.eligibleRows.includes(seat.row as (typeof SETTINGS.eligibleRows)[number])
  );
}

function canonicalPair(left: Seat, right: Seat): readonly [Seat, Seat] {
  return left.x <= right.x ? [left, right] : [right, left];
}

function pairKey(seats: readonly [Seat, Seat]): string {
  return `${seats[0].id}+${seats[1].id}`;
}

function explicitPairs(seats: Seat[]): Array<readonly [Seat, Seat]> {
  const byId = new Map(seats.map((seat) => [seat.id, seat]));
  const pairs = new Map<string, readonly [Seat, Seat]>();
  for (const seat of seats.filter(eligible)) {
    for (const neighborId of [seat.leftNeighbor, seat.rightNeighbor]) {
      if (!neighborId) continue;
      const neighbor = byId.get(neighborId);
      if (!neighbor || !eligible(neighbor) || neighbor.row !== seat.row) continue;
      const pair = canonicalPair(seat, neighbor);
      pairs.set(pairKey(pair), pair);
    }
  }
  return [...pairs.values()];
}

function geometryPairs(seats: Seat[]): Array<readonly [Seat, Seat]> {
  const rows = new Map<string, Seat[]>();
  for (const seat of seats.filter(eligible)) {
    const row = rows.get(seat.row) ?? [];
    row.push(seat);
    rows.set(seat.row, row);
  }
  const pairs: Array<readonly [Seat, Seat]> = [];
  for (const row of rows.values()) {
    row.sort((left, right) => left.x - right.x);
    for (let index = 1; index < row.length; index += 1) {
      const left = row[index - 1];
      const right = row[index];
      if (!left || !right || Math.abs(left.column - right.column) !== 1) continue;
      const centerGap = right.x + right.width / 2 - (left.x + left.width / 2);
      const maximumGap = Math.max(left.width, right.width) * 1.8;
      if (centerGap > 0 && centerGap <= maximumGap) pairs.push([left, right]);
    }
  }
  return pairs;
}

function scorePair(pair: readonly [Seat, Seat], allSeats: Seat[]): number {
  const minX = Math.min(...allSeats.map((seat) => seat.x));
  const maxX = Math.max(...allSeats.map((seat) => seat.x + seat.width));
  const width = Math.max(maxX - minX, 1);
  const center = minX + width / 2;
  const pairCenter =
    (pair[0].x + pair[0].width / 2 + pair[1].x + pair[1].width / 2) / 2;
  const horizontal = Math.max(0, 1 - Math.abs(pairCenter - center) / (width / 2));

  const ordinals = allSeats.map((seat) => seat.rowOrdinal);
  const minRow = Math.min(...ordinals);
  const maxRow = Math.max(...ordinals);
  const rowFraction = maxRow === minRow ? SETTINGS.idealRowFraction : (pair[0].rowOrdinal - minRow) / (maxRow - minRow);
  const rowDistance = Math.abs(rowFraction - SETTINGS.idealRowFraction);
  const maximumRowDistance =
    rowFraction <= SETTINGS.idealRowFraction
      ? SETTINGS.idealRowFraction
      : 1 - SETTINGS.idealRowFraction;
  const vertical = Math.max(0, 1 - rowDistance / Math.max(maximumRowDistance, 0.01));
  const weighted =
    horizontal * SETTINGS.horizontalScoreWeight + vertical * (1 - SETTINGS.horizontalScoreWeight);
  return Math.round(weighted * 100);
}

export function eligibleAvailablePairs(map: SeatMap): SeatPair[] {
  const seats = normalizeSeats(map);
  const standardSeats = seats.filter((seat) => seat.type === "standard");
  const linkedSeats = standardSeats.filter((seat) => seat.leftNeighbor || seat.rightNeighbor).length;
  const useExplicitNeighbors = standardSeats.length > 0 && linkedSeats / standardSeats.length >= 0.75;
  const rawPairs = useExplicitNeighbors ? explicitPairs(seats) : geometryPairs(seats);
  return rawPairs
    .map((pair) => ({ key: pairKey(pair), row: pair[0].row, seats: pair, score: scorePair(pair, seats) }))
    .filter((pair) => pair.score > SETTINGS.minimumSeatScoreExclusive)
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
}

export function snapshotForMap(map: SeatMap, capturedAt: Date): SeatSnapshot {
  return {
    version: 3,
    auditoriumId: map.auditoriumId,
    capturedAt: capturedAt.toISOString(),
    availableSeatIds: normalizeSeats(map)
      .filter((seat) => seat.available)
      .map((seat) => seat.id)
      .sort(),
  };
}

export function returnedPairs(map: SeatMap, previous: SeatSnapshot | undefined): {
  pairs: SeatPair[];
  returnedSeatIds: string[];
} {
  if (!previous || previous.version !== 3 || previous.auditoriumId !== map.auditoriumId) {
    return { pairs: [], returnedSeatIds: [] };
  }
  const previousAvailable = new Set(previous.availableSeatIds);
  const currentAvailable = new Set(
    normalizeSeats(map)
      .filter((seat) => seat.available)
      .map((seat) => seat.id),
  );
  const returnedSeatIds = [...currentAvailable].filter((id) => !previousAvailable.has(id)).sort();
  const returned = new Set(returnedSeatIds);
  const pairs = eligibleAvailablePairs(map).filter((pair) => pair.seats.some((seat) => returned.has(seat.id)));
  return { pairs, returnedSeatIds };
}

export function rawSeat(overrides: Partial<RawSeat> & Pick<RawSeat, "id" | "row" | "column">): RawSeat {
  return { status: "A", type: "standard", ...overrides };
}
