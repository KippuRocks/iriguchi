// T-050-07: an injected 30 s drift warns, adjusts the presentation time, and
// reaches the organiser through the admission report — over ledger-rules
// (backend-memory) and the real tRPC client to the kippu-api stand-in, whose clock
// runs 30 s behind the device's.

import type { OperatorGrant } from "@kippu/api";
import { afterEach, describe, expect, it } from "vitest";
import { gateLedger, RP_ID } from "../../test/gate-ledger.ts";
import { type StandIn, startKippuStandIn } from "../../test/kippu-api-stand-in.ts";
import { createAdmissions, randomUuid } from "../admission/admissions.ts";
import { reportAdmission } from "../admission/report.ts";
import { kippuClient } from "../kippu/client.ts";
import { checkOperator } from "../operator/check.ts";
import { operatorApi, signIn } from "../operator/session.ts";
import { memorySessionStore } from "../operator/store.ts";
import { decide } from "../verdict/verdict.ts";
import { CLOCK_TOLERANCE_MS, createServerClock, timed } from "./server-clock.ts";

const DRIFT = 30_000;
const HOUR = 60 * 60 * 1000;

let standIn: StandIn | null = null;
afterEach(async () => {
  await standIn?.close();
  standIn = null;
});

describe("T-050-07 clock drift", () => {
  it("REQ-OP-3: an injected 30 s drift warns, adjusts presentedAt, and is reported", async () => {
    const chain = await gateLedger();
    const grant: OperatorGrant = {
      id: "00000000-0000-4000-8000-00000000000a",
      operator: "operator-1",
      event: chain.event,
      gates: ["North"],
      from: Date.now() - HOUR,
      until: Date.now() + HOUR,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    // Kippu's clock is the true one; the device runs 30 s ahead of it.
    standIn = await startKippuStandIn({ code: "enrol", operatorId: "operator-1", grants: [grant] });
    const url = standIn.url;
    const clock = createServerClock(() => Date.now() + DRIFT);
    const signedIn = await signIn(operatorApi(kippuClient({ url })), memorySessionStore(), "enrol");
    if (signedIn.kind !== "signed-in") throw new Error(signedIn.kind);
    const client = kippuClient({ url, token: () => signedIn.record.token });

    const holder = await chain.holder();
    const ticket = await chain.issue(holder);
    const pass = await holder.pass(ticket);
    const verdict = await decide(
      {
        ledger: chain.ledger,
        checkOperator: (gate) =>
          timed(
            clock,
            () => checkOperator(client, gate),
            (check) => (check.kind === "authorised" ? check.authorisation.checkedAt : null),
          ),
        rpId: RP_ID,
        now: clock.now,
      },
      { event: chain.event, gate: "North" },
      pass,
    );
    expect(verdict.kind).toBe("admit");

    // Warns.
    expect(clock.outsideTolerance()).toBe(true);
    expect(clock.drift()).toBeLessThan(-DRIFT + 1_000);
    expect(clock.drift()).toBeGreaterThan(-DRIFT - 1_000);
    expect(Math.abs(clock.drift() ?? 0)).toBeGreaterThan(CLOCK_TOLERANCE_MS);

    // Server-adjusted presentation time.
    const presentedAt = clock.now();
    expect(Math.abs(presentedAt - Date.now())).toBeLessThan(1_000);

    // Reported: the device's unadjusted clock beside Kippu's receipt time.
    const report = reportAdmission(url);
    const admissions = createAdmissions({
      submit: (p, at) => chain.ledger.submitAccessPass(p, { presentedAt: at }),
      report: (input, token) =>
        timed(
          clock,
          () => report(input, token),
          (r) => r.receivedAt,
        ),
      deviceClock: clock.deviceNow,
      reportId: randomUuid,
    });
    const outcome = await admissions.admit({
      event: chain.event,
      gate: "North",
      pass,
      presentedAt,
      token: signedIn.record.token,
    });
    expect(outcome.kind).toBe("recorded");
    const recorded = standIn.reports[0];
    if (recorded === undefined) throw new Error("no report");
    expect(recorded.presentedAt).toBe(presentedAt);
    expect(recorded.verdict).toMatchObject({
      kind: "admitted",
      submission: { outcome: "settled" },
    });
    expect(recorded.deviceClock - recorded.receivedAt).toBeGreaterThan(DRIFT - 1_000);
    expect(recorded.deviceClock - recorded.receivedAt).toBeLessThan(DRIFT + 1_000);

    // Unadjusted, the device's time would be more than the ledger's 10 s skew ahead.
    const another = await holder.pass(await chain.issue(holder));
    const unadjusted = await chain.ledger.submitAccessPass(another, {
      presentedAt: clock.deviceNow(),
    });
    expect(unadjusted).toMatchObject({ ok: false, error: { code: "ERR-PassExpired" } });
  });

  it("a clock within 10 s of Kippu's does not warn", async () => {
    const clock = createServerClock(() => 1_000_000 + 9_000);
    await timed(
      clock,
      async () => ({ checkedAt: 1_000_000 }),
      (r) => r.checkedAt,
    );
    expect(clock.outsideTolerance()).toBe(false);
  });
});
