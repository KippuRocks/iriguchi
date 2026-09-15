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

/** How long the platform's decoder may take before the fixture counts as unreadable. */
const FIXTURE_TIMEOUT_MS = 20_000;

/**
 * The fixture's QR code, as the platform's decoder reports it; `null` if it finds
 * none. On Android `scanFromURLAsync` loads the image through `expo-image-loader`,
 * which must be installed: without it the call never settles.
 */
export async function scanFixture(): Promise<ScannedCode | null> {
  const { uri } = Image.resolveAssetSource(require("../../test/fixtures/saifu-pass.png"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FIXTURE_TIMEOUT_MS);
  });
  try {
    const scanned = scanFromURLAsync(uri, ["qr"]).then(([code]) => code ?? null);
    return await Promise.race([scanned, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
