// T-050-06: admit, then submit in the background, and report how it ended — over
// the SDK and ledger-rules (backend-memory) and the real tRPC client to the
// kippu-api stand-in.

import type { OperatorGrant } from "@kippu/api";
import { createSubmission, type Receipt, type Submission } from "@ticketto/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type GateLedger, gateLedger, RP_ID } from "../../test/gate-ledger.ts";
import { type StandIn, startKippuStandIn } from "../../test/kippu-api-stand-in.ts";
import { kippuClient } from "../kippu/client.ts";
import { checkOperator } from "../operator/check.ts";
import { operatorApi, signIn, signOut } from "../operator/session.ts";
import { memorySessionStore, type OperatorSessionRecord } from "../operator/store.ts";
import { decide, type VerdictDeps } from "../verdict/verdict.ts";
import { type AdmissionsDeps, createAdmissions, randomUuid } from "./admissions.ts";
import { reportAdmission } from "./report.ts";

const HOUR = 60 * 60 * 1000;

let standIn: StandIn;
let chain: GateLedger;
let session: OperatorSessionRecord;

beforeEach(async () => {
  chain = await gateLedger();
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
  standIn = await startKippuStandIn({ code: "enrol", operatorId: "operator-1", grants: [grant] });
  const signedIn = await signIn(
    operatorApi(kippuClient({ url: standIn.url })),
    memorySessionStore(),
    "enrol",
  );
  if (signedIn.kind !== "signed-in") throw new Error(signedIn.kind);
  session = signedIn.record;
});

afterEach(async () => {
  await standIn.close();
});

const verdictDeps = (): VerdictDeps => {
  const client = kippuClient({ url: standIn.url, token: () => session.token });
  return {
    ledger: chain.ledger,
    checkOperator: (gate) => checkOperator(client, gate),
    rpId: RP_ID,
    now: () => Date.now(),
  };
};

const admissionsDeps = (overrides: Partial<AdmissionsDeps> = {}): AdmissionsDeps => ({
  submit: (pass, presentedAt) => chain.ledger.submitAccessPass(pass, { presentedAt }),
  report: reportAdmission(standIn.url),
  deviceClock: () => Date.now(),
  reportId: randomUuid,
  sleep: async () => {},
  retryDelays: [1],
  ...overrides,
});

async function attendances(ticket: string) {
  const found = await chain.ledger.getTicket(ticket as never);
  if (!found.ok) throw new Error(found.error.code);
  return found.value.attendances;
}

describe("T-050-06 background sponsored submission and admission reports", () => {
  it("AC-E3.1: an admitted pass is submitted with presentedAt, attendance increments by exactly one, and the admission is reported settled", async () => {
    const holder = await chain.holder();
    const ticket = await chain.issue(holder, { kind: "Multiple", max: 5, until: null });
    const pass = await holder.pass(ticket);
    const presentedAt = Date.now();
    const verdict = await decide(verdictDeps(), { event: chain.event, gate: "North" }, pass);
    expect(verdict.kind).toBe("admit");

    const admissions = createAdmissions(admissionsDeps());
    const outcome = await admissions.admit({
      event: chain.event,
      gate: "North",
      pass,
      presentedAt,
      token: session.token,
    });

    expect(await attendances(ticket)).toBe(1);
    expect(outcome.kind).toBe("recorded");
    expect(standIn.reports).toHaveLength(1);
    expect(standIn.reports[0]).toMatchObject({
      event: chain.event,
      gate: "North",
      ticket,
      passId: pass.pass.id,
      holder: holder.signer.account,
      presentedAt,
      verdict: { kind: "admitted", submission: { outcome: "settled" } },
    });
    const submission = standIn.reports[0]?.verdict;
    if (submission?.kind === "admitted" && submission.submission.outcome === "settled") {
      expect(submission.submission.cursor.length).toBeGreaterThan(0);
    }
  });

  it("AC-E3.3: a ticket whose allowance was spent meanwhile is rejected with ERR-CannotAttend, attendance does not change, and the rejection is reported", async () => {
    const holder = await chain.holder();
    const ticket = await chain.issue(holder);
    const gate = { event: chain.event, gate: "North" };
    // Both passes get their verdict before either is recorded.
    const first = await holder.pass(ticket);
    const second = await holder.pass(ticket);
    expect((await decide(verdictDeps(), gate, first)).kind).toBe("admit");
    expect((await decide(verdictDeps(), { ...gate, gate: "South" }, second)).kind).toBe("admit");

    const admissions = createAdmissions(admissionsDeps());
    const admit = (pass: typeof first, at: string) =>
      admissions.admit({
        event: chain.event,
        gate: at,
        pass,
        presentedAt: Date.now(),
        token: session.token,
      });
    await admit(first, "North");
    expect(await attendances(ticket)).toBe(1);
    await admit(second, "South");
    expect(await attendances(ticket)).toBe(1);

    expect(standIn.reports.map((r) => r.verdict)).toEqual([
      { kind: "admitted", submission: expect.objectContaining({ outcome: "settled" }) },
      { kind: "admitted", submission: { outcome: "rejected", errorCode: "ERR-CannotAttend" } },
    ]);
  });

  it("NFR-2: admitting does not wait for the ledger to record the attendance", async () => {
    const holder = await chain.holder();
    const ticket = await chain.issue(holder);
    const pass = await holder.pass(ticket);
    const controller = createSubmission();
    const admissions = createAdmissions(
      admissionsDeps({ submit: () => controller.submission as Submission<Receipt> }),
    );
    const outcome = admissions.admit({
      event: chain.event,
      gate: "North",
      pass,
      presentedAt: Date.now(),
      token: session.token,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(admissions.pending()).toBe(1);
    expect(standIn.reports).toHaveLength(0);
    controller.rejected({ code: "ERR-LedgerUnavailable" });
    expect((await outcome).kind).toBe("recorded");
    expect(standIn.reports[0]?.verdict).toEqual({
      kind: "admitted",
      submission: { outcome: "rejected", errorCode: "ERR-LedgerUnavailable" },
    });
    expect(admissions.pending()).toBe(0);
  });

  it("a submission that fails outside §10 is reported as failed", async () => {
    const holder = await chain.holder();
    const pass = await holder.pass(await chain.issue(holder));
    const controller = createSubmission();
    controller.failed(new Error("the relay broke"));
    const admissions = createAdmissions(
      admissionsDeps({ submit: () => controller.submission as Submission<Receipt> }),
    );
    await admissions.admit({
      event: chain.event,
      gate: "North",
      pass,
      presentedAt: 1,
      token: session.token,
    });
    expect(standIn.reports[0]?.verdict).toEqual({
      kind: "admitted",
      submission: { outcome: "failed" },
    });
  });

  it("REQ-OP-3: a report kippu-api did not receive is sent again with the same report id", async () => {
    const holder = await chain.holder();
    const pass = await holder.pass(await chain.issue(holder));
    standIn.dropReports(3);
    let sent = 0;
    const report = reportAdmission(standIn.url);
    const ids = new Set<string>();
    const admissions = createAdmissions(
      admissionsDeps({
        report: (input, token) => {
          sent++;
          ids.add(input.reportId);
          return report(input, token);
        },
      }),
    );
    const outcome = await admissions.admit({
      event: chain.event,
      gate: "North",
      pass,
      presentedAt: Date.now(),
      token: session.token,
    });
    expect(outcome.kind).toBe("recorded");
    expect(sent).toBe(4);
    expect(ids.size).toBe(1);
    expect(standIn.reports).toHaveLength(1);
  });

  it("REQ-OP-3: signing out does not lose the report of an admission made before it", async () => {
    const holder = await chain.holder();
    const pass = await holder.pass(await chain.issue(holder));
    const controller = createSubmission();
    const admissions = createAdmissions(
      admissionsDeps({ submit: () => controller.submission as Submission<Receipt> }),
    );
    const presentedAt = Date.now() - 1;
    const outcome = admissions.admit({
      event: chain.event,
      gate: "North",
      pass,
      presentedAt,
      token: session.token,
    });
    await signOut(
      operatorApi(kippuClient({ url: standIn.url, token: () => session.token })),
      memorySessionStore(session),
    );
    controller.rejected({ code: "ERR-PassReplayed" });
    expect((await outcome).kind).toBe("recorded");
    expect(standIn.reports[0]).toMatchObject({ presentedAt, passId: pass.pass.id });
  });

  it("a report kippu-api refuses for good is not retried", async () => {
    const holder = await chain.holder();
    const pass = await holder.pass(await chain.issue(holder));
    let sent = 0;
    const report = reportAdmission(standIn.url);
    const admissions = createAdmissions(
      admissionsDeps({
        report: (input, token) => {
          sent++;
          return report(input, token);
        },
      }),
    );
    const outcome = await admissions.admit({
      event: chain.event,
      gate: "Never granted",
      pass,
      presentedAt: Date.now(),
      token: session.token,
    });
    expect(outcome).toMatchObject({ kind: "refused", reason: "not-granted" });
    expect(sent).toBe(1);
  });

  it("a report is given up on at its deadline", async () => {
    let clock = 0;
    const holder = await chain.holder();
    const pass = await holder.pass(await chain.issue(holder));
    const admissions = createAdmissions(
      admissionsDeps({
        report: async () => {
          throw new Error("no answer");
        },
        deviceClock: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
        retryDelays: [HOUR],
        reportDeadline: 3 * HOUR,
      }),
    );
    const outcome = await admissions.admit({
      event: chain.event,
      gate: "North",
      pass,
      presentedAt: 0,
      token: session.token,
    });
    expect(outcome.kind).toBe("abandoned");
    expect(clock).toBe(3 * HOUR);
  });

  it("report ids are version 4 UUIDs", () => {
    expect(randomUuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
