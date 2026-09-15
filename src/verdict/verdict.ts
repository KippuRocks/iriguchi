// The verdict at the gate (T-050-04; US-E2, AC-E2.1, AC-E2.2, REQ-AP-1, AC-E5.2;
// features/050-iriguchi/plan.md §5.1).
//
// On a scan, three checks start together, and the verdict waits for all three:
//
// | Check                  | Where                              | Answers                                        |
// |------------------------|------------------------------------|------------------------------------------------|
// | Signature and window   | profile-v0 `verifyPass`, against the credential's registration read with `getCredential` | Is the pass authentic and current? (AC-E1.2, AC-E1.3) |
// | `getTicket`, `canAttend` | The ledger, through the SDK        | Is the signer the current holder, and would the ticket admit? (REQ-AP-1, REQ-Q-2) |
// | `operators.check`      | kippu-api (F-024)                  | Is this operator authorised here, now? (AC-E5.2) |
//
// Every check only reads (AC-E2.2). A check that could not be answered — the
// ledger or Kippu unreachable — gives no verdict, and Iriguchi does not admit
// (REQ-CL-3).
//
// When several checks refuse, the operator sees one reason:
// 1. the operator's own authorisation, since nothing else can admit without it;
// 2. then the ledger's own order for a pass (features/008-ledger-rules/plan.md
//    §5.2): the ticket and event exist; the pass is the current holder's
//    (`ERR-InvalidPass`); it is within its window (`ERR-PassExpired`); then
//    `canAttend`'s reason.

import type { CheckRefusal, OperatorAuthorisation } from "@kippu/api";
import { accountOf, verifyPass } from "@ticketto/profile-v0";
import type {
  EventId,
  SignedAccessPass,
  Ticketto,
  TickettoErrorCode,
  Timestamp,
} from "@ticketto/sdk";

/** The gate being operated. */
export interface Gate {
  readonly event: EventId;
  readonly gate: string;
}

/** kippu-api's answer to `operators.check`. */
export type OperatorCheck =
  | { readonly kind: "authorised"; readonly authorisation: OperatorAuthorisation }
  | { readonly kind: "refused"; readonly reason: CheckRefusal }
  /** The operator's session was revoked or has ended (`UNAUTHORIZED`). */
  | { readonly kind: "signed-out" }
  | { readonly kind: "unreachable" };

export interface VerdictDeps {
  readonly ledger: Pick<Ticketto, "getTicket" | "canAttend" | "getCredential">;
  readonly checkOperator: (gate: Gate) => Promise<OperatorCheck>;
  /** The profile's credential configuration: the holder RP id. */
  readonly rpId: string;
  /** The time a pass's window is judged at. */
  readonly now: () => Timestamp;
}

/** Why a pass is refused: the operator's authorisation, or a §10 code. */
export type Refusal =
  | { readonly source: "operator"; readonly reason: CheckRefusal | "signed-out" }
  | {
      readonly source: "ledger";
      readonly code: TickettoErrorCode;
      /** For `ERR-TicketNotFound`: the event the ticket belongs to, when it is another one. */
      readonly ticketEvent?: EventId;
    };

export type Verdict =
  | {
      readonly kind: "admit";
      readonly pass: SignedAccessPass;
      readonly authorisation: OperatorAuthorisation;
    }
  | { readonly kind: "refuse"; readonly pass: SignedAccessPass; readonly refusal: Refusal }
  /** No verdict could be obtained online: Iriguchi does not admit (REQ-CL-3). */
  | {
      readonly kind: "unavailable";
      readonly pass: SignedAccessPass;
      readonly unreachable: "ledger" | "kippu" | "both";
    };

type Outcome =
  | { readonly kind: "ok" }
  | { readonly kind: "refused"; readonly code: TickettoErrorCode; readonly ticketEvent?: EventId }
  | { readonly kind: "unreachable" };

const OK: Outcome = { kind: "ok" };
const refused = (code: TickettoErrorCode, ticketEvent?: EventId): Outcome =>
  ticketEvent === undefined ? { kind: "refused", code } : { kind: "refused", code, ticketEvent };
const UNREACHABLE: Outcome = { kind: "unreachable" };

const unavailable = (code: TickettoErrorCode) => code === "ERR-LedgerUnavailable";

/** Signature and window: the pass's credential, as the ledger registers it, signed it, now. */
async function passCheck(deps: VerdictDeps, signed: SignedAccessPass): Promise<Outcome> {
  const claimed = accountOf(signed.authorisation);
  if (!claimed.ok || claimed.value.account !== signed.pass.holder) {
    return refused("ERR-InvalidPass");
  }
  const registration = await deps.ledger.getCredential(
    signed.pass.holder,
    claimed.value.credential,
  );
  if (!registration.ok) {
    return unavailable(registration.error.code) ? UNREACHABLE : refused("ERR-InvalidPass");
  }
  if (registration.value === null) return refused("ERR-InvalidPass");
  const verified = verifyPass(signed, registration.value, { now: deps.now }, { rpId: deps.rpId });
  return verified.ok ? OK : refused(verified.error.code);
}

interface LedgerOutcome {
  /** The ticket and event exist, and the ticket belongs to the gate's event. */
  readonly exists: Outcome;
  /** The signer is the ticket's current holder (REQ-AP-1). */
  readonly holder: Outcome;
  /** `canAttend`'s verdict (REQ-Q-2). */
  readonly attend: Outcome;
}

async function ledgerCheck(
  deps: VerdictDeps,
  gate: Gate,
  signed: SignedAccessPass,
): Promise<LedgerOutcome> {
  const [ticket, verdict] = await Promise.all([
    deps.ledger.getTicket(signed.pass.ticket),
    deps.ledger.canAttend(gate.event, signed.pass.ticket),
  ]);
  if (
    (!ticket.ok && unavailable(ticket.error.code)) ||
    (!verdict.ok && unavailable(verdict.error.code))
  ) {
    return { exists: UNREACHABLE, holder: UNREACHABLE, attend: UNREACHABLE };
  }
  if (!ticket.ok) return { exists: refused(ticket.error.code), holder: OK, attend: OK };
  if (ticket.value.event !== gate.event) {
    return { exists: refused("ERR-TicketNotFound", ticket.value.event), holder: OK, attend: OK };
  }
  if (!verdict.ok) return { exists: refused(verdict.error.code), holder: OK, attend: OK };
  return {
    exists: OK,
    holder: ticket.value.holder === signed.pass.holder ? OK : refused("ERR-InvalidPass"),
    attend: verdict.value.admit ? OK : refused(verdict.value.reason),
  };
}

const passOutcome = (outcome: Outcome, kind: "pass" | "window"): Outcome => {
  if (outcome.kind !== "refused") return outcome;
  const window = outcome.code === "ERR-PassExpired";
  return (kind === "window") === window ? outcome : OK;
};

/** Decides whether `signed`, scanned at `gate`, admits. */
export async function decide(
  deps: VerdictDeps,
  gate: Gate,
  signed: SignedAccessPass,
): Promise<Verdict> {
  const [pass, ledger, operator] = await Promise.all([
    passCheck(deps, signed).catch(() => UNREACHABLE),
    ledgerCheck(deps, gate, signed).catch(
      (): LedgerOutcome => ({ exists: UNREACHABLE, holder: UNREACHABLE, attend: UNREACHABLE }),
    ),
    deps.checkOperator(gate).catch((): OperatorCheck => ({ kind: "unreachable" })),
  ]);

  if (operator.kind === "refused") {
    return {
      kind: "refuse",
      pass: signed,
      refusal: { source: "operator", reason: operator.reason },
    };
  }
  if (operator.kind === "signed-out") {
    return { kind: "refuse", pass: signed, refusal: { source: "operator", reason: "signed-out" } };
  }

  // The ledger's order for a pass (features/008-ledger-rules/plan.md §5.2).
  const ordered = [
    ledger.exists,
    passOutcome(pass, "pass"),
    ledger.holder,
    passOutcome(pass, "window"),
    ledger.attend,
  ];
  const ledgerUnreachable = ordered.some((outcome) => outcome.kind === "unreachable");
  if (ledgerUnreachable || operator.kind === "unreachable") {
    return {
      kind: "unavailable",
      pass: signed,
      unreachable:
        ledgerUnreachable && operator.kind === "unreachable"
          ? "both"
          : ledgerUnreachable
            ? "ledger"
            : "kippu",
    };
  }
  for (const outcome of ordered) {
    if (outcome.kind === "refused") {
      return {
        kind: "refuse",
        pass: signed,
        refusal:
          outcome.ticketEvent === undefined
            ? { source: "ledger", code: outcome.code }
            : { source: "ledger", code: outcome.code, ticketEvent: outcome.ticketEvent },
      };
    }
  }
  return { kind: "admit", pass: signed, authorisation: operator.authorisation };
}
