// The scan fixture (T-050-03): simulators and emulators have no camera to point at
// a phone, so a development bundle built with EXPO_PUBLIC_IRIGUCHI_SCAN_FIXTURE=1
// offers to scan test/fixtures/saifu-pass.png — a Saifu pass's QR code — through
// the platform's own QR decoder (`scanFromURLAsync`: Core Image on iOS, ML Kit on
// Android) and the same reading path as the camera. CI's smoke flow uses it on both
// platforms. Without the variable, nothing here is offered.

import { scanFromURLAsync } from "expo-camera";
import { Image } from "react-native";
import type { ScannedCode } from "./read-pass.ts";

export const SCAN_FIXTURE_ENABLED = process.env.EXPO_PUBLIC_IRIGUCHI_SCAN_FIXTURE === "1";

/** The fixture's QR code, as the platform's decoder reports it; `null` if it finds none. */
export async function scanFixture(): Promise<ScannedCode | null> {
  const { uri } = Image.resolveAssetSource(require("../../test/fixtures/saifu-pass.png"));
  const [code] = await scanFromURLAsync(uri, ["qr"]);
  return code ?? null;
}
