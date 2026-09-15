// The gate's verdict and submission against the real system (see stack.ts for when it
// runs): T-050-04's, T-050-06's and T-050-11's acceptance criteria end to end, through
// the ledger service, the sponsor relay and kippu-api.

import { describe, expect, it } from "vitest";
import { persistentReportStore } from "../../src/admission/report-store.ts";
import { decide } from "../../src/verdict/verdict.ts";
import { deviceStorage } from "../device-storage.ts";
import {
  holder,
  operatorDevices,
  organiser,
  restartedAdmissions,
  stackAvailable,
  ticketFor,
} from "./stack.ts";

const refusal = (verdict: Awaited<ReturnType<typeof decide>>) =>
  verdict.kind === "refuse" ? verdict.refusal : verdict.kind;

describe.skipIf(!stackAvailable)(
  "T-050-04 and T-050-06 against kippu-api and the ledger service",
  () => {
    it("AC-E1.2: a pass signed by a non-holder is refused with ERR-InvalidPass", async () => {
      const api = await organiser();
      const guest = await holder();
      const stranger = await holder();
      const { event, ticket } = await ticketFor(api, guest.account);
      const [gate] = await operatorDevices(api, event, ["North"], 1);
      if (gate === undefined) throw new Error("no device");
      expect(
        refusal(await decide(gate.verdict, { event, gate: "North" }, await stranger.pass(ticket))),
      ).toEqual({
        source: "ledger",
        code: "ERR-InvalidPass",
      });
    }, 60_000);

    it("AC-E1.3: a pass whose valid_until has passed is refused with ERR-PassExpired", async () => {
      const api = await organiser();
      const guest = await holder();
      const { event, ticket } = await ticketFor(api, guest.account);
      const [gate] = await operatorDevices(api, event, ["North"], 1);
      if (gate === undefined) throw new Error("no device");
      const pass = await guest.pass(ticket);
      const later = { ...gate.verdict, now: () => pass.pass.notAfter + 1 };
      expect(refusal(await decide(later, { event, gate: "North" }, pass))).toEqual({
        source: "ledger",
        code: "ERR-PassExpired",
      });
    }, 60_000);

    it("AC-E5.2: a revoked operator is refused on the next scan", async () => {
      const api = await organiser();
      const guest = await holder();
      const { event, ticket } = await ticketFor(api, guest.account);
      const [gate] = await operatorDevices(api, event, ["North"], 1);
      if (gate === undefined) throw new Error("no device");
      expect(
        (await decide(gate.verdict, { event, gate: "North" }, await guest.pass(ticket))).kind,
      ).toBe("admit");
      const [grant] = await api.operators.grants.list.query({ event, operator: null });
      if (grant === undefined) throw new Error("no grant");
      await api.operators.grants.revoke.mutate({ grant: grant.id });
      expect(
        refusal(await decide(gate.verdict, { event, gate: "North" }, await guest.pass(ticket))),
      ).toEqual({
        source: "operator",
        reason: "grant-revoked",
      });
    }, 60_000);

    it("AC-E3.1: an admitted pass is recorded once, sponsored through the relay, and reported settled", async () => {
      const api = await organiser();
      const guest = await holder();
      const { event, ticket } = await ticketFor(api, guest.account);
      const [gate] = await operatorDevices(api, event, ["North"], 1);
      if (gate === undefined) throw new Error("no device");
      const pass = await guest.pass(ticket);
      const presentedAt = gate.clock.now();
      expect((await decide(gate.verdict, { event, gate: "North" }, pass)).kind).toBe("admit");
      const outcome = await gate.admissions.admit({
        event,
        gate: "North",
        pass,
        presentedAt,
        token: gate.token,
      });
      expect(outcome).toMatchObject({
        kind: "recorded",
        input: { presentedAt, verdict: { kind: "admitted", submission: { outcome: "settled" } } },
      });
      const recorded = await gate.ledger.getTicket(ticket);
      expect(recorded.ok && recorded.value.attendances).toBe(1);
    }, 60_000);

    it("AC-E3.3: once the allowance is spent, submission fails with ERR-CannotAttend and attendance does not change", async () => {
      const api = await organiser();
      const guest = await holder();
      const { event, ticket } = await ticketFor(api, guest.account, { kind: "Single" });
      const [north, south] = await operatorDevices(api, event, ["North", "South"], 2);
      if (north === undefined || south === undefined) throw new Error("no devices");
      const first = await guest.pass(ticket);
      const second = await guest.pass(ticket);
      expect((await decide(north.verdict, { event, gate: "North" }, first)).kind).toBe("admit");
      expect((await decide(south.verdict, { event, gate: "South" }, second)).kind).toBe("admit");
      await north.admissions.admit({
        event,
        gate: "North",
        pass: first,
        presentedAt: north.clock.now(),
        token: north.token,
      });
      const outcome = await south.admissions.admit({
        event,
        gate: "South",
        pass: second,
        presentedAt: south.clock.now(),
        token: south.token,
      });
      expect(outcome).toMatchObject({
        input: { verdict: { submission: { outcome: "rejected", errorCode: "ERR-CannotAttend" } } },
      });
      const recorded = await north.ledger.getTicket(ticket);
      expect(recorded.ok && recorded.value.attendances).toBe(1);
    }, 60_000);
  },
);

describe.skipIf(!stackAvailable)("T-050-11 against kippu-api and the ledger service", () => {
  it("REQ-OP-3: a report pending when the app is killed is sent after restart, once, with its holder", async () => {
    const api = await organiser();
    const guest = await holder();
    const { event, ticket } = await ticketFor(api, guest.account);
    const device = deviceStorage();
    const store = () => persistentReportStore(device.kv, device.secure);
    const [killed] = await operatorDevices(api, event, ["North"], 1, {
      store: store(),
      neverReport: true,
    });
    if (killed === undefined) throw new Error("no device");
    const pass = await guest.pass(ticket);
    const presentedAt = killed.clock.now();
    expect((await decide(killed.verdict, { event, gate: "North" }, pass)).kind).toBe("admit");
    void killed.admissions.admit({ event, gate: "North", pass, presentedAt, token: killed.token });
    await expect
      .poll(async () => (await store().list())[0]?.submission?.outcome, { timeout: 20_000 })
      .toBe("settled");

    const restarted = restartedAdmissions(store());
    expect((await restarted.resume()).map((o) => o.kind)).toEqual(["recorded"]);
    expect(await restartedAdmissions(store()).resume()).toEqual([]);

    // Ibento sees one report, with its holder: no flag, since it settled.
    const { flags } = await api.derived.admissionFlags.list.query({ event });
    expect(flags).toEqual([]);
    expect(restarted.sent).toEqual([
      expect.objectContaining({ passId: pass.pass.id, holder: guest.account, presentedAt }),
    ]);
  }, 60_000);
});
