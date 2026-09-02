import type { TheaterTarget } from "./types.ts";

export const SETTINGS = {
  movieId: "241283",
  movieTitle: "The Odyssey",
  formatName: "IMAX 70MM",
  timeZone: "America/Los_Angeles",
  windowHours: 168,
  cadenceMinutes: 5,
  catalogRefreshMinutes: 30,
  staleCatalogHours: 6,
  requestSpacingMs: 250,
  seatMapConcurrency: 3,
  requestTimeoutMs: 15_000,
  minimumSeatScoreExclusive: 50,
  eligibleRows: ["E", "F", "G", "H", "I", "K"] as const,
  idealRowFraction: 0.67,
  horizontalScoreWeight: 0.7,
  errorRepeatHours: 6,
} as const;

export const TARGETS: readonly TheaterTarget[] = [
  {
    id: "ontario",
    theaterId: "AAEDM",
    chainCode: "REGL",
    name: "Regal Edwards Ontario Palace",
    slug: "regal-edwards-ontario-palace-aaedm",
    includedTimes: ["14:20", "15:00"],
    pageUrl:
      "https://www.fandango.com/regal-edwards-ontario-palace-aaedm/theater-page?format=IMAX%2070MM",
  },
  {
    id: "irvine",
    theaterId: "AABTB",
    chainCode: "REGL",
    name: "Regal Irvine Spectrum",
    slug: "regal-irvine-spectrum-aabtb",
    includedTimes: ["14:30"],
    pageUrl: "https://www.fandango.com/regal-irvine-spectrum-aabtb/theater-page?format=IMAX%2070MM",
  },
];
