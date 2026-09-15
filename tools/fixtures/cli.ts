// pnpm fixtures:write — draws test/fixtures/saifu-pass.png, a Saifu pass's QR code
// (test/saifu-pass.ts), and records what it carries in test/fixtures/saifu-pass.json.
//
// The PNG is what the scan screen's fixture mode scans on simulators and emulators,
// which have no camera to point at a phone (src/scan/fixture.ts). Every input of
// the pass is fixed, so regenerating it changes nothing; a test checks that.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import { saifuPass } from "../../test/saifu-pass.ts";

const root = join(import.meta.dirname, "..", "..");
const { signed, bytes } = await saifuPass();

const png = await QRCode.toBuffer([{ data: bytes, mode: "byte" }], {
  errorCorrectionLevel: "M",
  margin: 4,
  scale: 6,
  type: "png",
});
writeFileSync(join(root, "test/fixtures/saifu-pass.png"), png);
writeFileSync(
  join(root, "test/fixtures/saifu-pass.json"),
  `${JSON.stringify({ pass: signed.pass, bytes: Buffer.from(bytes).toString("hex") }, null, 2)}\n`,
);
console.log(`fixtures: wrote a ${bytes.length}-byte pass to test/fixtures/saifu-pass.{png,json}`);
