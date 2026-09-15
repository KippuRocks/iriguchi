// Admit, then submit (T-050-06; US-E3, NFR-2, REQ-CL-3, REQ-OP-3;
// features/050-iriguchi/plan.md §5.2).
//
// The operator sees an admission at once. The pass is then submitted to the
// ledger in the background — directly, through the SDK, sponsored through Kippu's
// relay (REQ-OP-2, REQ-SP-1) — with the time it was presented at the gate. The
// queue never waits on it (NFR-2). Once the submission has ended, the admission is
// reported to kippu-api (F-024 §5.3) with how it ended: settled with its receipt's
// cursor, rejected with the ledger's §10 code, or failed with no verdict. A later
// ledger refusal becomes a flag to the organiser (REQ-OP-3), never a message at the
// gate.
//
// Reports are retried, with the same report id, until kippu-api records them or
// refuses them for good. Each report keeps the session token it was admitted under:
// kippu-api accepts reports of passes presented before a session's revocation for
// 24 hours after it, so a sign-out or a revocation does not lose them.
//
// Nothing here queues an admission: an admission exists only once a verdict was
// obtained online (REQ-CL-3). Only its report waits.

import type { AdmissionReportInput, AdmissionSubmission } from "@kippu/api";
import type { Receipt, SignedAccessPass, Submission, Timestamp } from "@ticketto/sdk";
import { refusalOf } from "../kippu/errors.ts";

export interface AdmissionsDeps {
  /** Submits a pass through the SDK (`Ticketto.submitAccessPass`). */
  readonly submit: (pass: SignedAccessPass, presentedAt: Timestamp) => Submission<Receipt>;
  /** Sends a report to kippu-api as the operator whose session `token` is. */
  readonly report: (input: AdmissionReportInput, token: string) => Promise<unknown>;
  /** The device's own, unadjusted clock (`deviceClock`). */
  readonly deviceClock: () => number;
  readonly reportId: () => string;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Delays between report attempts, in milliseconds; the last repeats. */
  readonly retryDelays?: readonly number[];
  /** How long a report is retried: kippu-api accepts late reports for 24 hours. */
  readonly reportDeadline?: number;
}

export interface Admission {
  readonly event: string;
  readonly gate: string;
  readonly pass: SignedAccessPass;
  /** The presentation time, exactly as submitted. */
  readonly presentedAt: Timestamp;
  /** The operator session the admission was made under. */
  readonly token: string;
}

export type ReportOutcome =
  | { readonly kind: "recorded"; readonly input: AdmissionReportInput }
  /** kippu-api refused the report for good: a gate never granted, a conflict, a malformed report. */
  | {
      readonly kind: "refused";
      readonly input: AdmissionReportInput;
      readonly reason: string | null;
    }
  /** Retried until the deadline without being recorded. */
  | { readonly kind: "abandoned"; readonly input: AdmissionReportInput };

export interface Admissions {
  /** Submits an admitted pass in the background, then reports how it ended. Returns at once. */
  admit(admission: Admission): Promise<ReportOutcome>;
  /** Admissions whose submission or report has not ended. */
  pending(): number;
  /** Resolves once every admission made so far has been reported, or given up on. */
  idle(): Promise<void>;
}

const DEFAULT_DELAYS = [1_000, 2_000, 5_000, 15_000, 60_000];
const DAY = 24 * 60 * 60 * 1000;

/** How a submission ended, as the report states it. */
export async function submissionOutcome(
  submission: Submission<Receipt>,
): Promise<AdmissionSubmission> {
  try {
    const result = await submission;
    return result.ok
      ? { outcome: "settled", cursor: result.value.cursor }
      : { outcome: "rejected", errorCode: result.error.code };
  } catch {
    return { outcome: "failed" };
  }
}

/** A refusal that sending the same report again cannot change. */
function final(error: unknown): { reason: string | null } | null {
  const refusal = refusalOf(error);
  switch (refusal.code) {
    case "FORBIDDEN":
    case "CONFLICT":
    case "BAD_REQUEST":
    case "NOT_FOUND":
      return { reason: refusal.reason };
    default:
      // No answer, a server error, or UNAUTHORIZED: a session revoked moments ago
      // still reports passes presented before it, so it is retried.
      return null;
  }
}

export function createAdmissions(deps: AdmissionsDeps): Admissions {
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const delays = deps.retryDelays ?? DEFAULT_DELAYS;
  const deadline = deps.reportDeadline ?? DAY;
  const inFlight = new Set<Promise<ReportOutcome>>();

  const send = async (input: AdmissionReportInput, token: string): Promise<ReportOutcome> => {
    const giveUpAt = deps.deviceClock() + deadline;
    for (let attempt = 0; ; attempt++) {
      try {
        await deps.report({ ...input, deviceClock: deps.deviceClock() }, token);
        return { kind: "recorded", input };
      } catch (error) {
        const refused = final(error);
        if (refused !== null) return { kind: "refused", input, reason: refused.reason };
      }
      const delay = delays[Math.min(attempt, delays.length - 1)] ?? 60_000;
      if (deps.deviceClock() + delay > giveUpAt) return { kind: "abandoned", input };
      await sleep(delay);
    }
  };

  return {
    admit(admission) {
      const reportId = deps.reportId();
      const work = (async (): Promise<ReportOutcome> => {
        const submission = await submissionOutcome(
          deps.submit(admission.pass, admission.presentedAt),
        );
        const input: AdmissionReportInput = {
          reportId,
          event: admission.event,
          gate: admission.gate,
          ticket: admission.pass.pass.ticket,
          passId: admission.pass.pass.id,
          verdict: { kind: "admitted", submission },
          presentedAt: admission.presentedAt,
          deviceClock: deps.deviceClock(),
        };
        return send(input, admission.token);
      })();
      inFlight.add(work);
      work.finally(() => inFlight.delete(work)).catch(() => {});
      return work;
    },
    pending: () => inFlight.size,
    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
  };
}

/** A version 4 UUID from the platform's secure random source. */
export function randomUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
