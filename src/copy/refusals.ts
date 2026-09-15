// Refusal reasons in words an operator can act on in a queue (T-050-05; REQ-Q-3;
// features/050-iriguchi/plan.md §5.1): spent, expired, cancelled event, not the
// holder, not authorised. Each reason the gate can meet has its own title — what is
// wrong — and action — what the operator does now.
//
// The §10 codes a gate meets are those of a pass's checks and of `canAttend`
// (features/008-ledger-rules/plan.md §5.2). `ERR-PassReplayed` is raised only when a
// pass is recorded, after an admission; the organiser is flagged (REQ-OP-3), and the
// operator never sees it at the gate — its words are here for the day a gate does.

import type { CheckRefusal } from "@kippurocks/api";
import type { TickettoErrorCode } from "@ticketto/sdk";
import type { Refusal } from "../verdict/verdict.ts";

export interface RefusalCopy {
  /** What is wrong, in a few words. */
  readonly title: string;
  /** What the operator does now. */
  readonly action: string;
}

/** The §10 errors a pass can be refused with at the gate. */
export const GATE_ERRORS = [
  "ERR-InvalidPass",
  "ERR-PassExpired",
  "ERR-PassReplayed",
  "ERR-TicketNotFound",
  "ERR-EventNotFound",
  "ERR-EventCancelled",
  "ERR-EventFinished",
  "ERR-TicketExpired",
  "ERR-CannotAttend",
  "ERR-PolicyUndeterminable",
] as const satisfies readonly TickettoErrorCode[];

export type GateError = (typeof GATE_ERRORS)[number];

export const GATE_ERROR_COPY: Readonly<Record<GateError, RefusalCopy>> = {
  "ERR-InvalidPass": {
    title: "Not the holder's pass",
    action:
      "This pass was not signed by the ticket's current holder. Ask the holder to open the ticket in their own Saifu.",
  },
  "ERR-PassExpired": {
    title: "Pass out of date",
    action: "The code on screen has expired. Ask the holder to show a fresh one.",
  },
  "ERR-PassReplayed": {
    title: "Code already used",
    action: "This code has already been used. Ask the holder to show a fresh one.",
  },
  "ERR-TicketNotFound": {
    title: "Ticket not found",
    action: "No such ticket exists. Do not admit; the holder should contact the organiser.",
  },
  "ERR-EventNotFound": {
    title: "Event not found",
    action: "This gate's event cannot be found. Stop admitting and contact your organiser.",
  },
  "ERR-EventCancelled": {
    title: "Event cancelled",
    action: "This event was cancelled, so its tickets no longer admit.",
  },
  "ERR-EventFinished": {
    title: "Event finished",
    action: "This event has finished, so its tickets no longer admit.",
  },
  "ERR-TicketExpired": {
    title: "Ticket expired",
    action: "This ticket's validity has ended. Do not admit.",
  },
  "ERR-CannotAttend": {
    title: "Ticket already used",
    action: "This ticket has no entries left. Do not admit.",
  },
  "ERR-PolicyUndeterminable": {
    title: "Ticket rules unreadable",
    action: "This ticket's entry rules cannot be read. Do not admit; contact your organiser.",
  },
};

/** A ticket of another event: `ERR-TicketNotFound` for this event, though the ticket exists. */
export const ANOTHER_EVENT_COPY: RefusalCopy = {
  title: "Ticket for another event",
  action: "This ticket is for a different event. Do not admit.",
};

export type OperatorReason = CheckRefusal | "signed-out";

export const OPERATOR_COPY: Readonly<Record<OperatorReason, RefusalCopy>> = {
  "grant-revoked": {
    title: "Your authorisation was revoked",
    action: "You can no longer admit at this gate. Stop admitting and contact your organiser.",
  },
  "before-window": {
    title: "Your shift has not started",
    action: "You are not authorised at this gate yet. Do not admit until your shift starts.",
  },
  "after-window": {
    title: "Your shift has ended",
    action: "You are no longer authorised at this gate. Stop admitting.",
  },
  "not-granted": {
    title: "Not authorised at this gate",
    action: "You have no authorisation for this gate. Choose one of your gates.",
  },
  "signed-out": {
    title: "You have been signed out",
    action: "Your session was ended. Sign in again with a new enrolment code.",
  },
};

/** The words for a refusal. */
export function refusalCopy(refusal: Refusal): RefusalCopy {
  if (refusal.source === "operator") return OPERATOR_COPY[refusal.reason];
  if (refusal.code === "ERR-TicketNotFound" && refusal.ticketEvent !== undefined) {
    return ANOTHER_EVENT_COPY;
  }
  return (GATE_ERRORS as readonly string[]).includes(refusal.code)
    ? GATE_ERROR_COPY[refusal.code as GateError]
    : {
        title: "Cannot admit",
        action: `The ledger refused this pass (${refusal.code}). Do not admit.`,
      };
}
