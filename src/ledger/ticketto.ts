// The Ticketto SDK as Iriguchi uses it (T-050-04; REQ-CL-3): the V0 profile for
// the deployment's holder RP id, the ledger service through `binding-offchain`, and
// Kippu's sponsor relay. Iriguchi reads the ledger and submits passes directly,
// never through Kippu's APIs (REQ-OP-2); it signs nothing (REQ-CL-2). Tests pass
// `backend-memory` and a local sponsor instead.

import { createRelaySponsor } from "@kippurocks/sponsorship";
import { connectOffchainBackend } from "@ticketto/binding-offchain";
import { createProfileV0 } from "@ticketto/profile-v0";
import {
  type Backend,
  createTicketto,
  type Result,
  type Sponsor,
  type Ticketto,
} from "@ticketto/sdk";

/**
 * How long a command stays valid (`AD-15`). Iriguchi signs no command — a pass
 * carries its holder's authorisation — so this bounds nothing Iriguchi sends; the
 * SDK requires a value, and Saifu's five minutes is used.
 */
export const OPERATION_LIFETIME_MS = 5 * 60 * 1000;

export interface IriguchiTickettoOptions {
  readonly backend: Backend;
  readonly sponsor: Sponsor;
  readonly rpId: string;
}

export function iriguchiTicketto(options: IriguchiTickettoOptions): Ticketto {
  return createTicketto({
    backend: options.backend,
    profile: createProfileV0({ rpId: options.rpId }),
    sponsor: options.sponsor,
    operationLifetime: OPERATION_LIFETIME_MS,
  });
}

export interface LedgerEndpoints {
  readonly ledgerUrl: string;
  readonly sponsorUrl: string;
  readonly rpId: string;
}

/**
 * How the gate's reads retry an unanswered request. A queue does not wait for the
 * ledger (`NFR-1`): the binding's default budget spends about 36 s before it says
 * the ledger is unavailable, so a verdict's reads retry once, briefly, and a
 * ledger that still does not answer gives no verdict (`REQ-CL-3`). Submissions,
 * which run in the background (`NFR-2`), keep the binding's default budget.
 */
export const GATE_READ_RETRY = { attempts: 1, initialDelay: 100, maxDelay: 100 } as const;

/**
 * Connects to the ledger service and returns the SDK over it, sponsored through
 * the relay. `ERR-LedgerUnavailable` when the service cannot be reached.
 */
export async function connectLedger(
  endpoints: LedgerEndpoints,
  retry?: typeof GATE_READ_RETRY,
): Promise<Result<Ticketto>> {
  const backend = await connectOffchainBackend({
    url: endpoints.ledgerUrl,
    ...(retry === undefined ? {} : { retry }),
  });
  if (!backend.ok) return backend;
  return {
    ok: true,
    value: iriguchiTicketto({
      backend: backend.value,
      sponsor: createRelaySponsor({ url: endpoints.sponsorUrl }),
      rpId: endpoints.rpId,
    }),
  };
}
