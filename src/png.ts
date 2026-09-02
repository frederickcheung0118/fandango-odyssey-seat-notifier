import { normalizeSeats } from "./seats.ts";
import type { SeatMap } from "./types.ts";

type Color = readonly [number, number, number];

const WIDTH = 900;
const HEIGHT = 560;
const BACKGROUND: Color = [15, 23, 42];
const SCREEN: Color = [125, 211, 252];
const AVAILABLE: Color = [34, 197, 94];
const TAKEN: Color = [71, 85, 105];
const SPECIAL: Color = [59, 130, 246];
const HIGHLIGHT: Color = [250, 204, 21];
const HIGHLIGHT_BORDER: Color = [244, 63, 94];
const LABEL: Color = [226, 232, 240];

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
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
};

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

export function renderSeatMapPng(map: SeatMap, highlightedSeatIds: Iterable<string>): Uint8Array {
  const raster = new Raster();
  const seats = normalizeSeats(map);
  const highlights = new Set(highlightedSeatIds);
  const minX = Math.min(...seats.map((seat) => seat.x));
  const maxX = Math.max(...seats.map((seat) => seat.x + seat.width));
  const sourceWidth = Math.max(maxX - minX, 1);
  const plotLeft = 62;
  const plotRight = WIDTH - 28;
  const plotTop = 105;
  const plotBottom = HEIGHT - 34;
  const rows = [...new Map(seats.map((seat) => [seat.row, seat.rowOrdinal])).entries()].sort(
    (left, right) => left[1] - right[1],
  );
  const rowIndex = new Map(rows.map(([label], index) => [label, index]));
  const rowPitch = rows.length <= 1 ? 30 : (plotBottom - plotTop) / (rows.length - 1);
  const xScale = (plotRight - plotLeft) / sourceWidth;

  raster.rect(180, 31, WIDTH - 360, 8, SCREEN);
  raster.text("SCREEN", WIDTH / 2 - 54, 50, 3, SCREEN);

  for (const [label, index] of rows) {
    const y = plotTop + index * rowPitch;
    raster.text(label, 22, y - 8, 2, LABEL);
  }

  for (const seat of seats) {
    const index = rowIndex.get(seat.row) ?? 0;
    const x = plotLeft + (seat.x - minX) * xScale;
    const y = plotTop + index * rowPitch - 7;
    const width = Math.max(6, Math.min(20, seat.width * xScale * 0.82));
    const height = Math.max(7, Math.min(15, rowPitch * 0.48));
    const highlighted = highlights.has(seat.id);
    const color = highlighted
      ? HIGHLIGHT
      : seat.type !== "standard"
        ? SPECIAL
        : seat.available
          ? AVAILABLE
          : TAKEN;
    if (highlighted) raster.rect(x - 3, y - 3, width + 6, height + 6, HIGHLIGHT_BORDER);
    raster.rect(x, y, width, height, color);
  }

  raster.rect(585, 15, 12, 12, AVAILABLE);
  raster.rect(632, 15, 12, 12, TAKEN);
  raster.rect(679, 15, 12, 12, SPECIAL);
  raster.rect(726, 12, 18, 18, HIGHLIGHT_BORDER);
  raster.rect(729, 15, 12, 12, HIGHLIGHT);
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
