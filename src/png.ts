import { normalizeSeats } from "./seats.ts";
import { SETTINGS } from "./config.ts";
import type { SeatMap } from "./types.ts";

type Color = readonly [number, number, number];

export const SEAT_MAP_WIDTH = 1_000;
export const SEAT_MAP_HEIGHT = 680;

const WIDTH = SEAT_MAP_WIDTH;
const HEIGHT = SEAT_MAP_HEIGHT;
const BACKGROUND: Color = [9, 15, 30];
const PANEL: Color = [14, 24, 43];
const GUIDE: Color = [29, 42, 66];
const SCREEN_GLOW: Color = [30, 64, 88];
const SCREEN: Color = [103, 232, 249];
const AVAILABLE: Color = [45, 212, 191];
const TAKEN: Color = [51, 65, 85];
const SPECIAL: Color = [96, 165, 250];
const GROUP: Color = [250, 204, 21];
const RETURNED: Color = [244, 63, 94];
const WHITE: Color = [248, 250, 252];
const LABEL: Color = [226, 232, 240];
const MUTED_LABEL: Color = [100, 116, 139];
const SEAT_OUTLINE: Color = [15, 23, 42];

const FONT: Record<string, readonly string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
};

function textWidth(value: string, scale: number): number {
  if (value.length === 0) return 0;
  return [...value].reduce((width, character) => width + (FONT[character.toUpperCase()] ? 6 : 4) * scale, 0) - scale;
}

function fitText(value: string, maximumWidth: number, scale: number): string {
  const normalized = value.toUpperCase();
  if (textWidth(normalized, scale) <= maximumWidth) return normalized;
  const suffix = "...";
  let result = "";
  for (const character of normalized) {
    if (textWidth(`${result}${character}${suffix}`, scale) > maximumWidth) break;
    result += character;
  }
  return `${result.trimEnd()}${suffix}`;
}

class Raster {
  readonly pixels = new Uint8Array(WIDTH * HEIGHT * 3);

  constructor() {
    for (let index = 0; index < this.pixels.length; index += 3) {
      this.pixels[index] = BACKGROUND[0];
      this.pixels[index + 1] = BACKGROUND[1];
      this.pixels[index + 2] = BACKGROUND[2];
    }
  }

  rect(x: number, y: number, width: number, height: number, color: Color): void {
    const startX = Math.max(0, Math.floor(x));
    const endX = Math.min(WIDTH, Math.ceil(x + width));
    const startY = Math.max(0, Math.floor(y));
    const endY = Math.min(HEIGHT, Math.ceil(y + height));
    for (let row = startY; row < endY; row += 1) {
      for (let column = startX; column < endX; column += 1) {
        const index = (row * WIDTH + column) * 3;
        this.pixels[index] = color[0];
        this.pixels[index + 1] = color[1];
        this.pixels[index + 2] = color[2];
      }
    }
  }

  strokeRect(x: number, y: number, width: number, height: number, color: Color, thickness = 1): void {
    this.rect(x, y, width, thickness, color);
    this.rect(x, y + height - thickness, width, thickness, color);
    this.rect(x, y, thickness, height, color);
    this.rect(x + width - thickness, y, thickness, height, color);
  }

  text(value: string, x: number, y: number, scale: number, color: Color): void {
    let cursor = x;
    for (const character of value.toUpperCase()) {
      const glyph = FONT[character];
      if (!glyph) {
        cursor += 4 * scale;
        continue;
      }
      for (let row = 0; row < glyph.length; row += 1) {
        const bits = glyph[row];
        if (!bits) continue;
        for (let column = 0; column < bits.length; column += 1) {
          if (bits[column] === "1") this.rect(cursor + column * scale, y + row * scale, scale, scale, color);
        }
      }
      cursor += 6 * scale;
    }
  }
}

function drawCenteredText(raster: Raster, value: string, centerX: number, y: number, scale: number, color: Color): void {
  raster.text(value, centerX - textWidth(value, scale) / 2, y, scale, color);
}

function drawSeat(
  raster: Raster,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: Color,
  emphasis: "none" | "group" | "returned",
): void {
  if (emphasis === "returned") {
    raster.strokeRect(x - 5, y - 5, width + 10, height + 12, RETURNED, 3);
    raster.strokeRect(x - 2, y - 2, width + 4, height + 6, WHITE, 1);
  } else if (emphasis === "group") {
    raster.strokeRect(x - 4, y - 4, width + 8, height + 10, GROUP, 2);
  }

  raster.rect(x + 2, y + 3, width, height, [3, 7, 18]);
  raster.strokeRect(x, y, width, height, SEAT_OUTLINE, 1);
  raster.rect(x + 1, y + 1, Math.max(1, width - 2), Math.max(2, height * 0.63), fill);
  raster.rect(x, y + height * 0.62, width, Math.max(3, height * 0.38), fill);
  raster.rect(x - 2, y + height * 0.68, 2, Math.max(3, height * 0.32), fill);
  raster.rect(x + width, y + height * 0.68, 2, Math.max(3, height * 0.32), fill);
}

function drawLegendItem(raster: Raster, x: number, label: string, color: Color, emphasis: "none" | "group" | "returned"): void {
  drawSeat(raster, x, HEIGHT - 42, 13, 11, color, emphasis);
  raster.text(label, x + 23, HEIGHT - 42, 1, LABEL);
}

export function renderSeatMapPng(
  map: SeatMap,
  highlightedSeatIds: Iterable<string>,
  returnedSeatIds?: Iterable<string>,
): Uint8Array {
  const raster = new Raster();
  const seats = normalizeSeats(map);
  const highlights = new Set(highlightedSeatIds);
  const returned = new Set(returnedSeatIds ?? highlights);
  const returnedInAlert = [...returned].filter((id) => highlights.has(id)).sort();
  const minX = Math.min(...seats.map((seat) => seat.x));
  const maxX = Math.max(...seats.map((seat) => seat.x + seat.width));
  const sourceWidth = Math.max(maxX - minX, 1);
  const plotLeft = 82;
  const plotRight = WIDTH - 82;
  const plotTop = 166;
  const plotBottom = HEIGHT - 94;
  const rows = [...new Map(seats.map((seat) => [seat.row, seat.rowOrdinal])).entries()].sort(
    (left, right) => left[1] - right[1],
  );
  const rowIndex = new Map(rows.map(([label], index) => [label, index]));
  const rowPitch = rows.length <= 1 ? 32 : (plotBottom - plotTop) / (rows.length - 1);
  const xScale = (plotRight - plotLeft) / sourceWidth;
  const eligibleRows = new Set<string>(SETTINGS.eligibleRows);
  const highlightedRows = new Set(seats.filter((seat) => highlights.has(seat.id)).map((seat) => seat.row));
  const isAlert = highlights.size > 0;
  const availableCount = seats.filter((seat) => seat.available && seat.type.toLowerCase() === "standard").length;

  raster.rect(0, 0, WIDTH, 5, isAlert ? RETURNED : AVAILABLE);
  raster.rect(0, 6, WIDTH, 72, PANEL);
  raster.text(isAlert ? "RETURNED SEAT ALERT" : "CURRENT SEAT MAP", 32, 20, 3, WHITE);
  const status = isAlert
    ? returnedInAlert.length <= 4
      ? `NEW ${returnedInAlert.join(" ") || highlights.size}`
      : `${returnedInAlert.length} NEW SEATS`
    : `${availableCount} AVAILABLE`;
  raster.text(status, WIDTH - 32 - textWidth(status, 2), 25, 2, isAlert ? RETURNED : AVAILABLE);
  raster.text(fitText(`${map.theaterName} - AUDITORIUM ${map.auditoriumId}`, WIDTH - 64, 2), 32, 53, 2, MUTED_LABEL);

  raster.rect(174, 104, WIDTH - 348, 14, SCREEN_GLOW);
  raster.rect(194, 107, WIDTH - 388, 6, SCREEN);
  drawCenteredText(raster, "SCREEN", WIDTH / 2, 127, 2, SCREEN);

  for (const [label, index] of rows) {
    const centerY = plotTop + index * rowPitch;
    const labelColor = highlightedRows.has(label) ? GROUP : eligibleRows.has(label) ? LABEL : MUTED_LABEL;
    raster.rect(plotLeft - 15, centerY, plotRight - plotLeft + 30, 1, GUIDE);
    raster.text(label, 28, centerY - 7, 2, labelColor);
    raster.text(label, WIDTH - 28 - textWidth(label, 2), centerY - 7, 2, labelColor);
  }

  for (const seat of seats) {
    const index = rowIndex.get(seat.row) ?? 0;
    const scaledSpan = seat.width * xScale;
    const width = Math.max(7, Math.min(22, scaledSpan * 0.78));
    const height = Math.max(9, Math.min(17, rowPitch * 0.5));
    const x = plotLeft + (seat.x - minX) * xScale + (scaledSpan - width) / 2;
    const y = plotTop + index * rowPitch - height / 2;
    const isHighlighted = highlights.has(seat.id);
    const isReturned = isHighlighted && returned.has(seat.id);
    const emphasis = isReturned ? "returned" : isHighlighted ? "group" : "none";
    const color = isReturned
      ? RETURNED
      : isHighlighted
        ? GROUP
        : seat.type.toLowerCase() !== "standard"
          ? SPECIAL
          : seat.available
            ? AVAILABLE
            : TAKEN;
    drawSeat(raster, x, y, width, height, color, emphasis);
  }

  raster.rect(0, HEIGHT - 62, WIDTH, 62, PANEL);
  drawLegendItem(raster, 36, "AVAILABLE", AVAILABLE, "none");
  drawLegendItem(raster, 212, "UNAVAILABLE", TAKEN, "none");
  drawLegendItem(raster, 412, "OTHER", SPECIAL, "none");
  drawLegendItem(raster, 558, "GROUP SEAT", GROUP, "group");
  drawLegendItem(raster, 766, "NEWLY RETURNED", RETURNED, "returned");
  return encodePng(raster.pixels, WIDTH, HEIGHT);
}

function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 3;
  const scanlines = new Uint8Array(height * (stride + 1));
  for (let row = 0; row < height; row += 1) {
    const destination = row * (stride + 1);
    scanlines[destination] = 0;
    scanlines.set(rgb.subarray(row * stride, (row + 1) * stride), destination + 1);
  }
  const header = new Uint8Array(13);
  writeU32(header, 0, width);
  writeU32(header, 4, height);
  header[8] = 8;
  header[9] = 2;
  return concat(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlibStore(scanlines)),
    pngChunk("IEND", new Uint8Array()),
  );
}

function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let offset = 0; offset < data.length; offset += 65_535) {
    const length = Math.min(65_535, data.length - offset);
    const block = new Uint8Array(5 + length);
    block[0] = offset + length >= data.length ? 1 : 0;
    block[1] = length & 0xff;
    block[2] = (length >>> 8) & 0xff;
    const inverse = (~length) & 0xffff;
    block[3] = inverse & 0xff;
    block[4] = (inverse >>> 8) & 0xff;
    block.set(data.subarray(offset, offset + length), 5);
    blocks.push(block);
  }
  const checksum = new Uint8Array(4);
  writeU32(checksum, 0, adler32(data));
  blocks.push(checksum);
  return concat(...blocks);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  writeU32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeU32(chunk, 8 + data.length, crc32(concat(typeBytes, data)));
  return chunk;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const value of data) {
    a = (a + value) % 65_521;
    b = (b + a) % 65_521;
  }
  return ((b << 16) | a) >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of data) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
