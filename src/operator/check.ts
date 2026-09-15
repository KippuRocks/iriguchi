// The operator's authorisation at the gate (T-050-04; AC-E5.2): `operators.check`
// (F-024 §5.2), run alongside the pass checks on every scan, never cached, so a
// revoked grant or session refuses the next scan.

import type { CheckRefusal } from "@kippu/api";
import type { KippuClient } from "../kippu/client.ts";
import { refusalOf } from "../kippu/errors.ts";
import type { Gate, OperatorCheck } from "../verdict/verdict.ts";

const REFUSALS: readonly string[] = [
  "grant-revoked",
  "before-window",
  "after-window",
  "not-granted",
] satisfies readonly CheckRefusal[];

export async function checkOperator(client: KippuClient, gate: Gate): Promise<OperatorCheck> {
  try {
    const authorisation = await client.operators.check.query({
      event: gate.event,
      gate: gate.gate,
    });
    return { kind: "authorised", authorisation };
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal.code === "UNAUTHORIZED") return { kind: "signed-out" };
    if (
      refusal.code === "FORBIDDEN" &&
      refusal.reason !== null &&
      REFUSALS.includes(refusal.reason)
    ) {
      return { kind: "refused", reason: refusal.reason as CheckRefusal };
    }
    return { kind: "unreachable" };
  }
}
