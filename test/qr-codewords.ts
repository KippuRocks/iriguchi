// The data codewords of a QR symbol (ISO/IEC 18004 §7.4), as a platform scanner
// reports them after error correction: segment headers, data, the terminator,
// bit padding and pad codewords. Built here from the standard, and sized with
// the `qrcode` package's capacity tables — the package Saifu draws passes with.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const utils = require("qrcode/lib/core/utils.js") as {
  getSymbolTotalCodewords(version: number): number;
};
const ecc = require("qrcode/lib/core/error-correction-code.js") as {
  getTotalCodewordsCount(version: number, level: { bit: number }): number;
};
const levels = require("qrcode/lib/core/error-correction-level.js") as Record<
  "L" | "M" | "Q" | "H",
  { bit: number }
>;

export type Segment =
  | { readonly mode: "byte"; readonly data: Uint8Array }
  | { readonly mode: "numeric"; readonly digits: string }
  | { readonly mode: "eci"; readonly designator: number };

class BitWriter {
  readonly bits: number[] = [];
  write(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }
}

/** Data codewords of a `version` symbol at error correction `level` holding `segments`. */
export function dataCodewords(
  segments: readonly Segment[],
  version: number,
  level: "L" | "M" | "Q" | "H" = "M",
): Uint8Array {
  const capacity =
    utils.getSymbolTotalCodewords(version) - ecc.getTotalCodewordsCount(version, levels[level]);
  const writer = new BitWriter();
  for (const segment of segments) {
    if (segment.mode === "byte") {
      writer.write(0b0100, 4);
      writer.write(segment.data.length, version <= 9 ? 8 : 16);
      for (const byte of segment.data) writer.write(byte, 8);
    } else if (segment.mode === "numeric") {
      writer.write(0b0001, 4);
      writer.write(segment.digits.length, version <= 9 ? 10 : version <= 26 ? 12 : 14);
      for (let i = 0; i < segment.digits.length; i += 3) {
        const group = segment.digits.slice(i, i + 3);
        writer.write(Number(group), group.length * 3 + 1);
      }
    } else {
      writer.write(0b0111, 4);
      writer.write(segment.designator, 8);
    }
  }
  if (writer.bits.length > capacity * 8) throw new RangeError("segments exceed the symbol");
  writer.write(0, Math.min(4, capacity * 8 - writer.bits.length));
  while (writer.bits.length % 8 !== 0) writer.bits.push(0);
  const bytes: number[] = [];
  for (let i = 0; i < writer.bits.length; i += 8) {
    bytes.push(writer.bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  for (let pad = 0; bytes.length < capacity; pad++) bytes.push(pad % 2 === 0 ? 0xec : 0x11);
  return Uint8Array.from(bytes);
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
