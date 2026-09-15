// T-050-09: two devices scan the same pass before either submission is recorded.
// Both admit; the ledger records exactly one; the other gate's submission is
// refused as ERR-PassReplayed, and both admissions are reported — the pair F-025
// flags as the same pass admitted at two gates (REQ-OP-3). Over ledger-rules
// (backend-memory) and the kippu-api stand-in; the flag itself, in Ibento's read,
// is test/system/two-devices.system.test.ts against kippu-api.

import type { OperatorGrant } from "@kippu/api";
import { afterEach, describe, expect, it } from "vitest";
import { gateLedger, RP_ID } from "../../test/gate-ledger.ts";
import { type StandIn, startKippuStandIn } from "../../test/kippu-api-stand-in.ts";
import { createServerClock, timed } from "../clock/server-clock.ts";
import { kippuClient } from "../kippu/client.ts";
import { checkOperator } from "../operator/check.ts";
import { operatorApi, signIn } from "../operator/session.ts";
import { memorySessionStore } from "../operator/store.ts";
import { decide } from "../verdict/verdict.ts";
import { createAdmissions, randomUuid } from "./admissions.ts";
import { reportAdmission } from "./report.ts";

const HOUR = 60 * 60 * 1000;

let standIn: StandIn | null = null;
afterEach(async () => {
  await standIn?.close();
  standIn = null;
});

describe("T-050-09 two-device concurrent admission", () => {
  it("AC-E3.4: two gates validate the same pass before either records it; both admit, the ledger records one, and both are reported (AC-E3.2)", async () => {
    const chain = await gateLedger();
    const grant: OperatorGrant = {
      id: "00000000-0000-4000-8000-00000000000a",
      operator: "operator-1",
      event: chain.event,
      gates: ["North", "South"],
      from: Date.now() - HOUR,
      until: Date.now() + HOUR,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    standIn = await startKippuStandIn({
      code: ["device-a", "device-b"],
      operatorId: "operator-1",
      grants: [grant],
    });
    const url = standIn.url;

    // Two devices, each with its own session, clock and background admissions.
    const device = async (code: string, gate: string, deviceOffset: number) => {
      const signedIn = await signIn(operatorApi(kippuClient({ url })), memorySessionStore(), code);
      if (signedIn.kind !== "signed-in") throw new Error(signedIn.kind);
      const clock = createServerClock(() => Date.now() + deviceOffset);
      const client = kippuClient({ url, token: () => signedIn.record.token });
      const report = reportAdmission(url);
      return {
        gate,
        clock,
        token: signedIn.record.token,
        verdict: {
          ledger: chain.ledger,
          checkOperator: (g: { event: typeof chain.event; gate: string }) =>
            timed(
              clock,
              () => checkOperator(client, g),
              (check) => (check.kind === "authorised" ? check.authorisation.checkedAt : null),
            ),
          rpId: RP_ID,
          now: clock.now,
        },
        admissions: createAdmissions({
          submit: (pass, presentedAt) => chain.ledger.submitAccessPass(pass, { presentedAt }),
          report: (input, token) =>
            timed(
              clock,
              () => report(input, token),
              (r) => r.receivedAt,
            ),
          deviceClock: clock.deviceNow,
          reportId: randomUuid,
        }),
      };
    };
    const north = await device("device-a", "North", 0);
    const south = await device("device-b", "South", 3);

    const holder = await chain.holder();
    const ticket = await chain.issue(holder, { kind: "Multiple", max: 10, until: null });
    const pass = await holder.pass(ticket);

    // Both verdicts come before either submission.
    const [atNorth, atSouth] = await Promise.all(
      [north, south].map(async (gate) => ({
        presentedAt: gate.clock.now(),
        verdict: await decide(gate.verdict, { event: chain.event, gate: gate.gate }, pass),
      })),
    );
    expect(atNorth?.verdict.kind).toBe("admit");
    expect(atSouth?.verdict.kind).toBe("admit");
    if (atNorth === undefined || atSouth === undefined) throw new Error("no verdicts");
    // Two gates present one QR code at two different moments.
    const southPresentedAt = Math.max(atSouth.presentedAt, atNorth.presentedAt + 1);

    const outcomes = await Promise.all([
      north.admissions.admit({
        event: chain.event,
        gate: "North",
        pass,
        presentedAt: atNorth.presentedAt,
        token: north.token,
      }),
      south.admissions.admit({
        event: chain.event,
        gate: "South",
        pass,
        presentedAt: southPresentedAt,
        token: south.token,
      }),
    ]);
    expect(outcomes.map((o) => o.kind)).toEqual(["recorded", "recorded"]);

    // The ledger records exactly one attendance (AC-E3.2, INV-6).
    const recorded = await chain.ledger.getTicket(ticket);
    expect(recorded.ok && recorded.value.attendances).toBe(1);

    // Both admissions are reported, one settled and one refused as a replay.
    const submissions = standIn.reports.map((r) =>
      r.verdict.kind === "admitted" ? r.verdict.submission.outcome : r.verdict.kind,
    );
    expect(submissions.sort()).toEqual(["rejected", "settled"]);
    const rejected = standIn.reports.find(
      (r) => r.verdict.kind === "admitted" && r.verdict.submission.outcome === "rejected",
    );
    expect(rejected?.verdict).toEqual({
      kind: "admitted",
      submission: { outcome: "rejected", errorCode: "ERR-PassReplayed" },
    });
    expect(new Set(standIn.reports.map((r) => r.passId))).toEqual(new Set([pass.pass.id]));
    expect(new Set(standIn.reports.map((r) => r.gate))).toEqual(new Set(["North", "South"]));
  });
});
