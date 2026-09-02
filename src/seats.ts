import { SETTINGS } from "./config.ts";
import type { RawSeat, Seat, SeatGroup, SeatMap, SeatSnapshot } from "./types.ts";

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

function edgeKey(left: Seat, right: Seat): string {
  return left.x <= right.x ? `${left.id}+${right.id}` : `${right.id}+${left.id}`;
}

function groupKey(seats: readonly [Seat, Seat, Seat]): string {
  return seats.map((seat) => seat.id).join("+");
}

function seatsByRow(seats: Seat[]): Map<string, Seat[]> {
  const rows = new Map<string, Seat[]>();
  for (const seat of seats.filter(eligible)) {
    const row = rows.get(seat.row) ?? [];
    row.push(seat);
    rows.set(seat.row, row);
  }
  for (const row of rows.values()) row.sort((left, right) => left.x - right.x);
  return rows;
}

function explicitGroups(seats: Seat[]): Array<readonly [Seat, Seat, Seat]> {
  const byId = new Map(seats.map((seat) => [seat.id, seat]));
  const linkedEdges = new Set<string>();
  for (const seat of seats.filter(eligible)) {
    for (const neighborId of [seat.leftNeighbor, seat.rightNeighbor]) {
      if (!neighborId) continue;
      const neighbor = byId.get(neighborId);
      if (!neighbor || !eligible(neighbor) || neighbor.row !== seat.row) continue;
      linkedEdges.add(edgeKey(seat, neighbor));
    }
  }
  const groups: Array<readonly [Seat, Seat, Seat]> = [];
  for (const row of seatsByRow(seats).values()) {
    for (let index = 0; index <= row.length - 3; index += 1) {
      const first = row[index]!;
      const second = row[index + 1]!;
      const third = row[index + 2]!;
      if (linkedEdges.has(edgeKey(first, second)) && linkedEdges.has(edgeKey(second, third))) {
        groups.push([first, second, third]);
      }
    }
  }
  return groups;
}

function geometricallyAdjacent(left: Seat, right: Seat): boolean {
  if (Math.abs(left.column - right.column) !== 1) return false;
  const centerGap = right.x + right.width / 2 - (left.x + left.width / 2);
  const maximumGap = Math.max(left.width, right.width) * 1.8;
  return centerGap > 0 && centerGap <= maximumGap;
}

function geometryGroups(seats: Seat[]): Array<readonly [Seat, Seat, Seat]> {
  const groups: Array<readonly [Seat, Seat, Seat]> = [];
  for (const row of seatsByRow(seats).values()) {
    for (let index = 0; index <= row.length - 3; index += 1) {
      const first = row[index]!;
      const second = row[index + 1]!;
      const third = row[index + 2]!;
      if (geometricallyAdjacent(first, second) && geometricallyAdjacent(second, third)) {
        groups.push([first, second, third]);
      }
    }
  }
  return groups;
}

function scoreGroup(group: readonly [Seat, Seat, Seat], allSeats: Seat[]): number {
  const minX = Math.min(...allSeats.map((seat) => seat.x));
  const maxX = Math.max(...allSeats.map((seat) => seat.x + seat.width));
  const width = Math.max(maxX - minX, 1);
  const center = minX + width / 2;
  const groupCenter = group.reduce((sum, seat) => sum + seat.x + seat.width / 2, 0) / group.length;
  const horizontal = Math.max(0, 1 - Math.abs(groupCenter - center) / (width / 2));

  const ordinals = allSeats.map((seat) => seat.rowOrdinal);
  const minRow = Math.min(...ordinals);
  const maxRow = Math.max(...ordinals);
  const rowFraction = maxRow === minRow ? SETTINGS.idealRowFraction : (group[0].rowOrdinal - minRow) / (maxRow - minRow);
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

export function eligibleAvailableGroups(map: SeatMap): SeatGroup[] {
  const seats = normalizeSeats(map);
  const standardSeats = seats.filter((seat) => seat.type === "standard");
  const linkedSeats = standardSeats.filter((seat) => seat.leftNeighbor || seat.rightNeighbor).length;
  const useExplicitNeighbors = standardSeats.length > 0 && linkedSeats / standardSeats.length >= 0.75;
  const rawGroups = useExplicitNeighbors ? explicitGroups(seats) : geometryGroups(seats);
  return rawGroups
    .map((group) => ({ key: groupKey(group), row: group[0].row, seats: group, score: scoreGroup(group, seats) }))
    .filter((group) => group.score > SETTINGS.minimumSeatScoreExclusive)
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
}

export function snapshotForMap(map: SeatMap, capturedAt: Date): SeatSnapshot {
  return {
    version: 4,
    auditoriumId: map.auditoriumId,
    capturedAt: capturedAt.toISOString(),
    availableSeatIds: normalizeSeats(map)
      .filter((seat) => seat.available)
      .map((seat) => seat.id)
      .sort(),
  };
}

export function groupsToNotify(map: SeatMap, previous: SeatSnapshot | undefined): {
  groups: SeatGroup[];
  newlyAvailableSeatIds: string[];
} {
  const groups = eligibleAvailableGroups(map);
  if (!previous || previous.version !== 4 || previous.auditoriumId !== map.auditoriumId) {
    return { groups, newlyAvailableSeatIds: [] };
  }
  const previousAvailable = new Set(previous.availableSeatIds);
  const currentAvailable = new Set(
    normalizeSeats(map)
      .filter((seat) => seat.available)
      .map((seat) => seat.id),
  );
  const newlyAvailableSeatIds = [...currentAvailable].filter((id) => !previousAvailable.has(id)).sort();
  const newlyVisibleGroups = groups.filter((group) =>
    group.seats.some((seat) => !previousAvailable.has(seat.id)),
  );
  return { groups: newlyVisibleGroups, newlyAvailableSeatIds };
}

export function rawSeat(overrides: Partial<RawSeat> & Pick<RawSeat, "id" | "row" | "column">): RawSeat {
  return { status: "A", type: "standard", ...overrides };
}
