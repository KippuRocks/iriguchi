// A scanned code, read as an access pass (T-050-03; US-E1, AD-13).
//
// Reading decodes only: whether the pass is authentic, current, held by its
// signer and admits is the verdict's (T-050-04).

import { decodePass } from "@ticketto/profile-v0";
import type { Result, SignedAccessPass } from "@ticketto/sdk";
import { candidatePayloads, fromBase64 } from "./payload.ts";

/** What Iriguchi uses from a scanner's report of a QR code. */
export interface ScannedCode {
  /** The symbol's data codewords, base64 (patches/expo-camera@57.0.5.patch). */
  readonly rawBytes?: string | undefined;
}

/**
 * The signed access pass a scanned QR code carries. Anything else — a code with
 * no binary payload, or one whose bytes are not a canonical pass — fails with
 * `ERR-InvalidPass`, as the profile's decoder does.
 */
export function readScannedPass(code: ScannedCode): Result<SignedAccessPass> {
  const codewords = code.rawBytes === undefined ? null : fromBase64(code.rawBytes);
  if (codewords === null || codewords.length === 0) {
    return {
      ok: false,
      error: { code: "ERR-InvalidPass", detail: "the code carries no binary payload" },
    };
  }
  let last: Result<SignedAccessPass> | null = null;
  for (const payload of candidatePayloads(codewords)) {
    last = decodePass(payload);
    if (last.ok) return last;
  }
  return last ?? { ok: false, error: { code: "ERR-InvalidPass", detail: "not a pass" } };
}
