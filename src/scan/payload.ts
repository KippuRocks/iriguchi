// The bytes a scanned QR code carries (T-050-03; AD-13).
//
// A pass is shown as one binary-mode (byte) segment. The platforms' scanners
// report a binary payload only as text, which is lossy, so Iriguchi's patch of
// expo-camera (patches/expo-camera@57.0.5.patch) also reports the symbol's
// decoded data codewords — `rawBytes`, base64:
//
// - iOS: `CIQRCodeDescriptor.errorCorrectedPayload`, the data codewords after
//   error correction: segment headers, data, terminator and padding.
// - Android: ML Kit's `Barcode.getRawBytes()`.
//
// This module reads the byte segments back out of that bit stream. The width of
// a byte segment's character count depends on the symbol's version (8 bits up to
// version 9, 16 bits from version 10), which the codewords alone do not state,
// so both readings are offered, in the order a pass makes likelier: a pass is
// hundreds of bytes, version 10 or above. Should a platform report the payload
// itself rather than its codewords, that is offered last. The pass decoder
// decides which candidate, if any, is a pass.

/** QR segment mode indicators (ISO/IEC 18004 §7.4.2). */
const MODE = { terminator: 0b0000, byte: 0b0100, eci: 0b0111 } as const;

class BitReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length * 8 - this.offset;
  }

  read(bits: number): number {
    if (bits > this.remaining) throw new RangeError("past the end of the codewords");
    let value = 0;
    for (let i = 0; i < bits; i++) {
      const byte = this.bytes[(this.offset >> 3) as number] as number;
      value = (value << 1) | ((byte >> (7 - (this.offset & 7))) & 1);
      this.offset++;
    }
    return value;
  }
}

/**
 * The concatenated byte segments of a QR bit stream, reading each segment's
 * count in `countBits` bits; `null` when the stream holds anything else — a
 * numeric, alphanumeric or kanji segment, or a count that runs past the end.
 */
export function byteSegments(codewords: Uint8Array, countBits: 8 | 16): Uint8Array | null {
  const reader = new BitReader(codewords);
  const out: number[] = [];
  try {
    while (reader.remaining >= 4) {
      const mode = reader.read(4);
      if (mode === MODE.terminator) break;
      if (mode === MODE.eci) {
        // An ECI designator only names a character set; the bytes are unchanged.
        const first = reader.read(8);
        if ((first & 0x80) !== 0) reader.read((first & 0x40) === 0 ? 8 : 16);
        continue;
      }
      if (mode !== MODE.byte) return null;
      const count = reader.read(countBits);
      if (count * 8 > reader.remaining) return null;
      for (let i = 0; i < count; i++) out.push(reader.read(8));
    }
  } catch {
    return null;
  }
  return out.length === 0 ? null : Uint8Array.from(out);
}

/** The payloads `codewords` could carry, likeliest first for a pass, without duplicates. */
export function candidatePayloads(codewords: Uint8Array): Uint8Array[] {
  const candidates: Uint8Array[] = [];
  for (const candidate of [byteSegments(codewords, 16), byteSegments(codewords, 8), codewords]) {
    if (candidate === null || candidate.length === 0) continue;
    if (candidates.some((c) => equal(c, candidate))) continue;
    candidates.push(candidate);
  }
  return candidates;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Bytes from standard base64 (padding optional); `null` if it is not base64. */
export function fromBase64(text: string): Uint8Array | null {
  const clean = text.replace(/=+$/, "");
  if (clean.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    const value = BASE64.indexOf(char);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}
