// T-050-11: an admission report pending when the app is killed is sent after
// restart, once, with its holder. Each "app" is a createAdmissions over the same
// device storage; killing one means dropping it with its work unfinished.

import type { OperatorGrant } from "@kippu/api";
import { createSubmission, type Receipt, type Submission } from "@ticketto/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { deviceStorage } from "../../test/device-storage.ts";
import { gateLedger } from "../../test/gate-ledger.ts";
import { type StandIn, startKippuStandIn } from "../../test/kippu-api-stand-in.ts";
import { kippuClient } from "../kippu/client.ts";
import { operatorApi, signIn } from "../operator/session.ts";
import { memorySessionStore } from "../operator/store.ts";
import { type AdmissionsDeps, createAdmissions, randomUuid } from "./admissions.ts";
import { reportAdmission } from "./report.ts";
import { persistentReportStore } from "./report-store.ts";

const HOUR = 60 * 60 * 1000;
const never = new Promise<never>(() => {});

let standIn: StandIn | null = null;
afterEach(async () => {
  await standIn?.close();
  standIn = null;
});

async function setUp() {
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
  standIn = await startKippuStandIn({ code: "enrol", operatorId: "operator-1", grants: [grant] });
  const url = standIn.url;
  const signedIn = await signIn(operatorApi(kippuClient({ url })), memorySessionStore(), "enrol");
  if (signedIn.kind !== "signed-in") throw new Error(signedIn.kind);
  const holder = await chain.holder();
  const pass = await holder.pass(await chain.issue(holder));
  const device = deviceStorage();
  let sends = 0;
  const report = reportAdmission(url);
  const app = (overrides: Partial<AdmissionsDeps> = {}) =>
    createAdmissions({
      submit: (p, presentedAt) => chain.ledger.submitAccessPass(p, { presentedAt }),
      report: (input, token) => {
        sends++;
        return report(input, token);
      },
      deviceClock: () => Date.now(),
      reportId: randomUuid,
      sleep: async () => {},
      retryDelays: [1],
      store: persistentReportStore(device.kv, device.secure),
      ...overrides,
    });
  return {
    chain,
    pass,
    holder,
    device,
    token: signedIn.record.token,
    app,
    sends: () => sends,
    admission: (presentedAt = Date.now()) => ({
      event: chain.event,
      gate: "North",
      pass,
      presentedAt,
      token: signedIn.record.token,
    }),
  };
}

describe("T-050-11 pending reports survive the app", () => {
  it("REQ-OP-3: a report pending when the app is killed is sent after restart, once, with its holder", async () => {
    const s = await setUp();
    const presentedAt = Date.now();
    // The first run submits, but is killed before its report reaches kippu-api.
    let reported!: () => void;
    const reachedReport = new Promise<void>((resolve) => {
      reported = resolve;
    });
    const killed = s.app({
      report: () => {
        reported();
        return never;
      },
    });
    void killed.admit(s.admission(presentedAt));
    await reachedReport;
    expect(standIn?.reports).toHaveLength(0);

    // The app starts again on the same device.
    const restarted = s.app();
    const outcomes = await restarted.resume();
    expect(outcomes.map((o) => o.kind)).toEqual(["recorded"]);
    expect(s.sends()).toBe(1);
    expect(standIn?.reports).toHaveLength(1);
    expect(standIn?.reports[0]).toMatchObject({
      passId: s.pass.pass.id,
      holder: s.holder.signer.account,
      presentedAt,
      verdict: { kind: "admitted", submission: { outcome: "settled" } },
    });

    // Nothing is left to send: another start sends nothing.
    expect(await s.app().resume()).toEqual([]);
    expect(await restarted.resume()).toEqual([]);
    expect(s.sends()).toBe(1);
    expect(s.device.secure.items.size).toBe(0);
  });

  it("REQ-OP-3: an admission killed while its submission was in flight is reported failed after restart, and not submitted again", async () => {
    const s = await setUp();
    let submitted!: () => void;
    const reachedSubmit = new Promise<void>((resolve) => {
      submitted = resolve;
    });
    const controller = createSubmission();
    const killed = s.app({
      submit: () => {
        submitted();
        return controller.submission as Submission<Receipt>;
      },
    });
    void killed.admit(s.admission());
    await reachedSubmit;

    let resubmitted = 0;
    const restarted = s.app({
      submit: (p, presentedAt) => {
        resubmitted++;
        return s.chain.ledger.submitAccessPass(p, { presentedAt });
      },
    });
    expect((await restarted.resume()).map((o) => o.kind)).toEqual(["recorded"]);
    expect(resubmitted).toBe(0);
    expect(standIn?.reports[0]).toMatchObject({
      holder: s.holder.signer.account,
      verdict: { kind: "admitted", submission: { outcome: "failed" } },
    });
  });

  it("resuming while this run still sends a report does not send it twice", async () => {
    const s = await setUp();
    const app = s.app();
    const admitted = app.admit(s.admission());
    const resumed = app.resume();
    expect((await admitted).kind).toBe("recorded");
    expect(await resumed).toEqual([]);
    expect(s.sends()).toBe(1);
  });

  it("a report acknowledged before the app was killed is forgotten", async () => {
    const s = await setUp();
    expect((await s.app().admit(s.admission())).kind).toBe("recorded");
    expect(await s.app().resume()).toEqual([]);
    expect(s.sends()).toBe(1);
  });
});
