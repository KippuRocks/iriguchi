// A pass as Saifu produces and shows it (features/030-saifu T-030-07): signed by
// a holder's passkey — here F-003's simulated authenticator, the same
// `pass-webauthn` kind — encoded with `encodeSignedPass`, and drawn as one
// binary-mode QR segment at error correction level M.

import { encodeSignedPass, producePass } from "@ticketto/profile-v0";
import { simulatedWebAuthnSigner } from "@ticketto/profile-v0/testing";
import type { SignedAccessPass, TicketId, Timestamp } from "@ticketto/sdk";

export const FIXTURE_RP_ID = "kippu.example";

export interface SaifuPass {
  readonly signed: SignedAccessPass;
  /** What the QR code carries. */
  readonly bytes: Uint8Array;
}

function repeated(hex: string, bytes: number): string {
  return hex.repeat(bytes);
}

/** A Saifu pass. With no options, every input is fixed, so the pass is the same each time. */
export async function saifuPass(
  options: { readonly notBefore?: number; readonly random?: boolean } = {},
): Promise<SaifuPass> {
  const credential = options.random
    ? simulatedWebAuthnSigner({ rpId: FIXTURE_RP_ID })
    : simulatedWebAuthnSigner({
        rpId: FIXTURE_RP_ID,
        userId: repeated("5a", 32),
        secretKey: Uint8Array.from({ length: 32 }, (_, i) => i + 1),
        credentialId: Uint8Array.from({ length: 32 }, (_, i) => 0xa0 + i),
      });
  const signed = await producePass(
    {
      ticket: repeated("7e", 32) as TicketId,
      holder: credential.signer.account,
      notBefore: (options.notBefore ?? Date.UTC(2026, 8, 14, 20, 0, 0)) as Timestamp,
      ...(options.random ? {} : { id: repeated("c4", 16) as never }),
    },
    credential.signer,
  );
  return { signed, bytes: encodeSignedPass(signed) };
}
