// Operator sign-in, and the gates an operator may choose (T-050-02; US-E5).
//
// An organiser issues an operator a one-time enrolment code (F-024); Iriguchi
// redeems it for an operator session (F-020 §5.1) and keeps the session on the
// device. The operator then picks one of their grants' event and gate to operate.
// Whether the operator is authorised at that gate right now is checked on every
// scan, alongside the pass (AC-E5.2, T-050-04), not here: a grant listed here can
// be revoked a second later.

import type { OperatorGrant } from "@kippu/api";
import type { KippuClient } from "../kippu/client.ts";
import { refusalOf } from "../kippu/errors.ts";
import type { OperatorSessionRecord, OperatorSessionStore } from "./store.ts";

/** What sign-in and gate choice need from kippu-api. */
export interface OperatorApi {
  redeem(code: string): Promise<{ token: string; expiresAt: string; operatorId: string }>;
  grants(): Promise<readonly OperatorGrant[]>;
  /** The event's name from its public metadata; `null` when Kippu has none. */
  eventName(event: string): Promise<string | null>;
  signOut(): Promise<void>;
}

export function operatorApi(client: KippuClient): OperatorApi {
  return {
    async redeem(code) {
      const { session, operator } = await client.auth.operator.redeemEnrolmentCode.mutate({ code });
      return { token: session.token, expiresAt: session.expiresAt, operatorId: operator.id };
    },
    grants: () => client.operators.grants.mine.query(),
    async eventName(event) {
      const { event: view } = await client.derived.events.get.query({ event });
      const name = view?.metadata?.name;
      return typeof name === "string" && name.length > 0 ? name : null;
    },
    async signOut() {
      await client.auth.session.signOut.mutate();
    },
  };
}

/** kippu-api refused the request, as opposed to not answering it. */
function refused(error: unknown): boolean {
  return refusalOf(error).code !== null;
}

function unauthorised(error: unknown): boolean {
  return refusalOf(error).code === "UNAUTHORIZED";
}

export type SignInOutcome =
  | { readonly kind: "signed-in"; readonly record: OperatorSessionRecord }
  /** The code is unknown, used, expired or voided. */
  | { readonly kind: "refused" }
  | { readonly kind: "unreachable" };

/** Redeems an enrolment code, and keeps the session it opens. */
export async function signIn(
  api: OperatorApi,
  store: OperatorSessionStore,
  code: string,
): Promise<SignInOutcome> {
  const trimmed = code.trim();
  if (trimmed.length === 0) return { kind: "refused" };
  let redeemed: Awaited<ReturnType<OperatorApi["redeem"]>>;
  try {
    redeemed = await api.redeem(trimmed);
  } catch (error) {
    return refused(error) ? { kind: "refused" } : { kind: "unreachable" };
  }
  const record: OperatorSessionRecord = {
    token: redeemed.token,
    expiresAt: Date.parse(redeemed.expiresAt),
    operatorId: redeemed.operatorId,
  };
  await store.save(record);
  return { kind: "signed-in", record };
}

/** The session on the device, unless there is none or it has ended. */
export async function currentSession(
  store: OperatorSessionStore,
  now: number,
): Promise<OperatorSessionRecord | null> {
  const record = await store.load();
  if (record === null) return null;
  if (!(record.expiresAt > now)) {
    await store.clear();
    return null;
  }
  return record;
}

/** One gate of one event an operator's grant covers. */
export interface GateChoice {
  readonly grant: string;
  readonly event: string;
  readonly eventName: string | null;
  readonly gate: string;
  /** Unix milliseconds, inclusive. */
  readonly from: number;
  /** Unix milliseconds, exclusive. */
  readonly until: number;
}

export type GatesOutcome =
  | { readonly kind: "gates"; readonly choices: readonly GateChoice[] }
  /** kippu-api no longer accepts the session: revoked, or ended. It is forgotten. */
  | { readonly kind: "signed-out" }
  | { readonly kind: "unreachable" };

/**
 * The gates the signed-in operator's grants cover — kippu-api lists grants neither
 * revoked nor ended — soonest first, each with its event's name where Kippu has one.
 */
export async function loadGates(
  api: OperatorApi,
  store: OperatorSessionStore,
): Promise<GatesOutcome> {
  let grants: readonly OperatorGrant[];
  try {
    grants = await api.grants();
  } catch (error) {
    if (unauthorised(error)) {
      await store.clear();
      return { kind: "signed-out" };
    }
    return { kind: "unreachable" };
  }
  const events = [...new Set(grants.map((grant) => grant.event))];
  const names = new Map(
    await Promise.all(
      events.map(async (event) => [event, await api.eventName(event).catch(() => null)] as const),
    ),
  );
  const choices = grants
    .filter((grant) => grant.revokedAt === null)
    .flatMap((grant) =>
      grant.gates.map(
        (gate): GateChoice => ({
          grant: grant.id,
          event: grant.event,
          eventName: names.get(grant.event) ?? null,
          gate,
          from: grant.from,
          until: grant.until,
        }),
      ),
    )
    .sort(
      (a, b) =>
        a.from - b.from ||
        (a.eventName ?? a.event).localeCompare(b.eventName ?? b.event) ||
        a.gate.localeCompare(b.gate),
    );
  return { kind: "gates", choices };
}

/** Ends the session with kippu-api where it can, and forgets it on the device regardless. */
export async function signOut(api: OperatorApi, store: OperatorSessionStore): Promise<void> {
  try {
    await api.signOut();
  } catch {
    // Unreachable or already ended: the device forgets the session either way.
  }
  await store.clear();
}
