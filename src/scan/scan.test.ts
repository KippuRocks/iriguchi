import { readFileSync } from "node:fs";
import { join } from "node:path";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { dataCodewords, toBase64 } from "../../test/qr-codewords.ts";
import { saifuPass } from "../../test/saifu-pass.ts";
import { byteSegments, candidatePayloads, fromBase64 } from "./payload.ts";
import { readScannedPass } from "./read-pass.ts";

const root = join(import.meta.dirname, "..", "..");
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** The version Saifu's QR code for `bytes` has: one byte segment, level M. */
const saifuVersion = (bytes: Uint8Array) =>
  QRCode.create([{ data: bytes, mode: "byte" }], { errorCorrectionLevel: "M" }).version;

describe("T-050-03 QR payload", () => {
  it("reads byte segments with 8-bit counts up to version 9 and 16-bit counts from version 10", () => {
    const data = Uint8Array.from({ length: 100 }, (_, i) => i);
    const small = dataCodewords([{ mode: "byte", data }], 9);
    expect(byteSegments(small, 8)).toEqual(data);
    const large = dataCodewords([{ mode: "byte", data }], 10);
    expect(byteSegments(large, 16)).toEqual(data);
  });

  it("joins several byte segments and skips an ECI designator", () => {
    const codewords = dataCodewords(
      [
        { mode: "eci", designator: 26 },
        { mode: "byte", data: Uint8Array.of(1, 2) },
        { mode: "byte", data: Uint8Array.of(3) },
      ],
      12,
    );
    expect(byteSegments(codewords, 16)).toEqual(Uint8Array.of(1, 2, 3));
  });

  it("refuses a numeric segment, and a count past the end", () => {
    expect(byteSegments(dataCodewords([{ mode: "numeric", digits: "0123" }], 12), 16)).toBeNull();
    expect(byteSegments(Uint8Array.of(0x4f, 0xff, 0x00), 16)).toBeNull();
  });

  it("offers both count widths and the codewords themselves, without duplicates", () => {
    const data = Uint8Array.of(9, 9, 9);
    const candidates = candidatePayloads(dataCodewords([{ mode: "byte", data }], 12));
    expect(candidates[0]).toEqual(data);
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidatePayloads(Uint8Array.of(0x00, 0x01))).toEqual([Uint8Array.of(0x00, 0x01)]);
  });

  it("decodes base64, with or without padding, and refuses anything else", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(fromBase64(toBase64(Uint8Array.of(1, 2)).replace(/=+$/, ""))).toEqual(
      Uint8Array.of(1, 2),
    );
    expect(fromBase64("not base64!")).toBeNull();
  });
});

describe("T-050-03 reading a scanned pass", () => {
  it("US-E1: a Saifu pass decodes from the data codewords of its QR code", async () => {
    const { signed, bytes } = await saifuPass({ random: true, notBefore: Date.now() });
    const version = saifuVersion(bytes);
    expect(version).toBeGreaterThanOrEqual(10);
    const scanned = readScannedPass({
      rawBytes: toBase64(dataCodewords([{ mode: "byte", data: bytes }], version)),
    });
    expect(scanned).toEqual({ ok: true, value: signed });
  });

  it("US-E1: a Saifu pass decodes when a scanner reports the payload itself", async () => {
    const { signed, bytes } = await saifuPass();
    expect(readScannedPass({ rawBytes: toBase64(bytes) })).toEqual({ ok: true, value: signed });
  });

  it("AD-13: a code that is not a pass is refused with ERR-InvalidPass", async () => {
    const text = new TextEncoder().encode("https://kippu.example/not-a-pass");
    const cases = [
      {},
      { rawBytes: "" },
      { rawBytes: toBase64(dataCodewords([{ mode: "byte", data: text }], 5)) },
      { rawBytes: toBase64(dataCodewords([{ mode: "numeric", digits: "12345678" }], 5)) },
    ];
    const { bytes } = await saifuPass();
    const truncated = bytes.slice(0, -1);
    cases.push({
      rawBytes: toBase64(dataCodewords([{ mode: "byte", data: truncated }], 16)),
    });
    for (const code of cases) {
      const read = readScannedPass(code);
      expect(read.ok, JSON.stringify(code)).toBe(false);
      if (!read.ok) expect(read.error.code).toBe("ERR-InvalidPass");
    }
  });
});

describe("T-050-03 scan fixture", () => {
  it("is Saifu's QR code of the fixed pass, as tools/fixtures generates it", async () => {
    const { signed, bytes } = await saifuPass();
    const recorded = JSON.parse(readFileSync(join(root, "test/fixtures/saifu-pass.json"), "utf8"));
    expect(recorded).toEqual({ pass: signed.pass, bytes: hex(bytes) });

    const png = PNG.sync.read(readFileSync(join(root, "test/fixtures/saifu-pass.png")));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(decoded?.version).toBe(saifuVersion(bytes));
    expect(hex(Uint8Array.from(decoded?.binaryData ?? []))).toBe(hex(bytes));
  });
});

// `BENCH=1 pnpm test src/scan` prints how long reading a pass takes on Node; the
// device measurement is NFR-1's (T-050-08). Skipped in ordinary test runs.
describe.skipIf(process.env.BENCH === undefined)("T-050-03 decoding benchmark", () => {
  it("reads a pass-webauthn pass from its codewords", async () => {
    const { bytes } = await saifuPass();
    const code = {
      rawBytes: toBase64(dataCodewords([{ mode: "byte", data: bytes }], saifuVersion(bytes))),
    };
    for (let i = 0; i < 200; i++) readScannedPass(code);
    const times: number[] = [];
    for (let i = 0; i < 2_000; i++) {
      const start = performance.now();
      readScannedPass(code);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const at = (q: number) => times[Math.floor(q * (times.length - 1))]?.toFixed(3);
    console.log(
      `BENCH ${JSON.stringify({ runtime: `node ${process.version}`, bytes: bytes.length, version: saifuVersion(bytes), p50ms: at(0.5), p95ms: at(0.95) })}`,
    );
  });
});
