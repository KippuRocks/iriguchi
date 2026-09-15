// The ledger for gate tests: the SDK over `backend-memory` — `ledger-rules`, the
// same rules the ledger service runs (AD-25) — built with Iriguchi's own SDK
// factory and sponsored by a local software sponsor (backend-memory verifies no
// sponsorship). An organiser, with a software p256 key, creates an event and issues
// tickets to holders whose passkeys are F-003's simulated authenticator: the
// credential kind Saifu's holders use.

import { issueSponsorship, kmsP256Signer } from "@kippu/sponsorship";
import { softwareKmsP256Key } from "@kippu/sponsorship/testing";
import { createMemoryBackend } from "@ticketto/backend-memory";
import { createProfileV0, producePass } from "@ticketto/profile-v0";
import { simulatedWebAuthnSigner, softwareP256Signer } from "@ticketto/profile-v0/testing";
import type {
  AttendancePolicy,
  ClassId,
  Discriminator,
  EventId,
  SignedAccessPass,
  Signer,
  Sponsor,
  TicketId,
  Ticketto,
  ZoneId,
} from "@ticketto/sdk";
import { iriguchiTicketto } from "../src/ledger/ticketto.ts";

export const RP_ID = "kippu.example";

export function localSponsor(): Sponsor {
  const signer = kmsP256Signer(softwareKmsP256Key());
  return {
    async sponsor(input) {
      return { ok: true, value: await issueSponsorship(signer, input, { notionalCost: 0n }) };
    },
  };
}

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

async function settle(submission: PromiseLike<{ ok: boolean; error?: { code: string } }>) {
  const result = await submission;
  if (!result.ok) throw new Error(`ledger refused: ${result.error?.code}`);
}

export interface Holder {
  readonly signer: Signer;
  /** A pass for `ticket`, presented from `notBefore` (default now) for `window` ms. */
  pass(
    ticket: TicketId,
    options?: { notBefore?: number; window?: number },
  ): Promise<SignedAccessPass>;
}

export interface GateLedger {
  readonly ledger: Ticketto;
  readonly event: EventId;
  holder(): Promise<Holder>;
  issue(holder: Holder, policy?: AttendancePolicy, event?: EventId): Promise<TicketId>;
  /** Another event of the same organiser. */
  anotherEvent(): Promise<EventId>;
}

export async function gateLedger(): Promise<GateLedger> {
  const ledger = iriguchiTicketto({
    backend: createMemoryBackend({ profile: createProfileV0({ rpId: RP_ID }) }),
    sponsor: localSponsor(),
    rpId: RP_ID,
  });
  const organiser = softwareP256Signer();
  await settle(
    ledger.registerCredential(organiser.signer, {
      account: organiser.signer.account,
      registration: organiser.registration,
    }),
  );
  const zone = hex(32) as ZoneId;
  const createEvent = async () => {
    const created = ledger.createEvent(organiser.signer, {
      salt: crypto.getRandomValues(new Uint8Array(32)),
      zones: [{ id: zone, kind: "Unseated" }],
      capacity: null,
      metadata: null,
    });
    await settle(created.submission);
    return created.id;
  };
  const event = await createEvent();

  const gate: GateLedger = {
    ledger,
    event,
    async holder() {
      const credential = simulatedWebAuthnSigner({ rpId: RP_ID });
      await settle(
        ledger.registerCredential(credential.signer, {
          account: credential.signer.account,
          registration: credential.registration,
        }),
      );
      return {
        signer: credential.signer,
        pass: (ticket, options = {}) =>
          producePass(
            {
              ticket,
              holder: credential.signer.account,
              notBefore: options.notBefore ?? Date.now(),
              ...(options.window === undefined ? {} : { window: options.window }),
            },
            credential.signer,
          ),
      };
    },
    async issue(holder, policy = { kind: "Single" }, onEvent = event) {
      const issued = ledger.issueTicket(organiser.signer, {
        event: onEvent,
        zone,
        placement: { kind: "Unseated", discriminator: hex(16) as Discriminator },
        class: hex(8) as ClassId,
        provenance: "Granted",
        policy,
        restrictions: { cannotResale: false, cannotTransfer: false },
        holder: holder.signer.account,
        metadata: null,
      });
      await settle(issued.submission);
      return issued.id;
    },
    anotherEvent: createEvent,
  };
  return gate;
}
