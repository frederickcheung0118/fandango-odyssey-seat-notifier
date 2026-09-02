export interface StateStore {
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  STATE: StateStore;
  DISCORD_WEBHOOK_URL?: string;
}

export interface TheaterTarget {
  id: "ontario" | "irvine";
  theaterId: string;
  chainCode: string;
  name: string;
  slug: string;
  includedTimes: readonly string[];
  pageUrl: string;
}

export interface Showtime {
  hash: string;
  startsAtLocal: string;
  startsAtEpochMs: number;
  displayTime: string;
  ticketingUrl?: string;
}

export interface RawSeat {
  id: string;
  row: number | string;
  column: number;
  status: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  leftNeighbor?: string;
  rightNeighbor?: string;
}

export interface SeatMap {
  theaterName: string;
  auditoriumId: string;
  totalWidth?: number;
  totalHeight?: number;
  seats: RawSeat[];
}

export interface Seat {
  id: string;
  row: string;
  rowOrdinal: number;
  number?: number;
  column: number;
  status: string;
  type: string;
  available: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  leftNeighbor?: string;
  rightNeighbor?: string;
}

export interface SeatGroup {
  key: string;
  row: string;
  seats: readonly [Seat, Seat, Seat];
  score: number;
}

export interface SeatSnapshot {
  version: 4;
  auditoriumId: string;
  capturedAt: string;
  availableSeatIds: string[];
}

export interface SnapshotStore {
  version: 4;
  snapshots: Record<string, SeatSnapshot>;
}

export interface SeatAlertEvent {
  target: TheaterTarget;
  showtime: Showtime;
  map: SeatMap;
  groups: SeatGroup[];
  newlyAvailableSeatIds: string[];
}

export interface RunError {
  target?: string;
  stage: "catalog" | "seat-map" | "state" | "discord" | "configuration";
  message: string;
  code?: string;
  showtime?: string;
}

export interface TargetReport {
  target: string;
  catalogRefreshed: boolean;
  showtimesInWindow: number;
  seatMapsAttempted: number;
  seatMapsSucceeded: number;
  baselinesCreated: number;
  alertsSent: number;
}

export interface RunReport {
  startedAt: string;
  completedAt: string;
  targets: TargetReport[];
  errors: RunError[];
}
