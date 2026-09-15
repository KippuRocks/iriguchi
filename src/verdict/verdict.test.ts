// T-050-04 end to end in one process: Iriguchi's verdict over the Ticketto SDK and
// `ledger-rules` (backend-memory), and over the real tRPC client to a kippu-api
// stand-in typed by @kippu/api. The same flows against the ledger service and
// kippu-api run in kippu-e2e (F-070).

import type { OperatorGrant } from "@kippu/api";
import { type EventId, LOG_START, type Ticketto } from "@ticketto/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type GateLedger, gateLedger, RP_ID } from "../../test/gate-ledger.ts";
import { type StandIn, startKippuStandIn } from "../../test/kippu-api-stand-in.ts";
import { kippuClient } from "../kippu/client.ts";
import { checkOperator } from "../operator/check.ts";
import { operatorApi, signIn } from "../operator/session.ts";
import { memorySessionStore } from "../operator/store.ts";
import { decide, type Gate, type Verdict, type VerdictDeps } from "./verdict.ts";

const HOUR = 60 * 60 * 1000;
const GRANT = "00000000-0000-4000-8000-00000000000a";

let standIn: StandIn;
let chain: GateLedger;
let gate: Gate;

function grantFor(event: EventId, overrides: Partial<OperatorGrant> = {}): OperatorGrant {
  return {
    id: GRANT,
    operator: "operator-1",
    event,
    gates: ["North"],
    from: Date.now() - HOUR,
    until: Date.now() + HOUR,
    createdAt: new Date().toISOString(),
    revokedAt: null,
    ...overrides,
  };
}

async function operatorDeps(
  grants: (event: EventId) => OperatorGrant[],
  ledger?: VerdictDeps["ledger"],
): Promise<VerdictDeps> {
  standIn = await startKippuStandIn({
    code: "enrol",
    operatorId: "operator-1",
    grants: grants(chain.event),
  });
  const store = memorySessionStore();
  const signedIn = await signIn(operatorApi(kippuClient({ url: standIn.url })), store, "enrol");
  if (signedIn.kind !== "signed-in") throw new Error(signedIn.kind);
  const client = kippuClient({ url: standIn.url, token: () => signedIn.record.token });
  return {
    ledger: ledger ?? chain.ledger,
    checkOperator: (g) => checkOperator(client, g),
    rpId: RP_ID,
    now: () => Date.now(),
  };
}

const refusal = (verdict: Verdict) => (verdict.kind === "refuse" ? verdict.refusal : verdict.kind);

beforeEach(async () => {
  chain = await gateLedger();
  gate = { event: chain.event, gate: "North" };
});

afterEach(async () => {
  await standIn?.close();
});

describe("T-050-04 parallel verdict", () => {
  it("AC-E2.1: a valid pass of the current holder, at an authorised gate, admits", async () => {
    const deps = await operatorDeps((event) => [grantFor(event)]);
    const holder = await chain.holder();
    const ticket = await chain.issue(holder);
    const verdict = await decide(deps, gate, await holder.pass(ticket));
    expect(verdict.kind).toBe("admit");
    if (verdict.kind === "admit") expect(verdict.authorisation.grant).toBe(GRANT);
  });

  it("AC-E1.2: a pass signed by a non-holder is refused with ERR-InvalidPass (REQ-AP-1)", async () => {
    const deps = await operatorDeps((event) => [grantFor(event)]);
    const holder = await chain.holder();
    const stranger = await chain.holder();
    const ticket = await chain.issue(holder);
    expect(refusal(await decide(deps, gate, await stranger.pass(ticket)))).toEqual({
      source: "ledger",
      code: "ERR-InvalidPass",
    });
  });

  it("AC-E1.2: a pass whose signature was tampered with is refused with ERR-InvalidPass", async () => {
    const deps = await operatorDeps((event) => [grantFor(event)]);
    const holder = await chain.holder();
    const ticket = await chain.issue(holder);
    const pass = await holder.pass(ticket);
    const tampered = { ...pass, pass: { ...pass.pass, notAfter: pass.pass.notAfter + 1 } };
    expect(refusal(await decide(deps, gate, tampered))).toEqual({
      source: "ledger",
      code: "ERR-InvalidPass",
    });
  });

  it("AC-E1.3: a pass whose valid_until has passed is refused with ERR-PassExpired", async () => {
    const deps = await operatorDeps((event) => [grantFor(event)]);
    const holder = await chain.holder();
    const ticket = await chain.issue(holder);
    const pass = await holder.pass(ticket, { notBefore: Date.now() - 2 * 60_000 });
    expect(refusal(await decide(deps, gate, pass))).toEqual({
      source: "ledger",
      code: "ERR-PassExpired",
    });
  });

  it("AC-E5.2: a revoked operator is refused on the next scan", async () => {
    const deps = await operatorDeps((event) => [grantFor(event)]);
    const holder = await chain.holder();
    const ticket = await chain.issue(holder);
    expect((await decide(deps, gate, await holder.pass(ticket))).kind).toBe("admit");
    standIn.revokeGrant(GRANT);
    expect(refusal(await decide(deps, gate, await holder.pass(ticket)))).toEqual({
      source: "operator",
      reason: "grant-revoked",
    });
  });

  it("AC-E5.2: an operator whose sessions were revoked is refused on the next scan", async () => {
    const deps = await operatorDeps((event) => [grantFor(event)]);
    const holder = await chain.holder();
    const ticket = await chain.issue(holder);
    standIn.revokeSessions();
    expect(refusal(await decide(deps, gate, await holder.pass(ticket)))).toEqual({
      source: "operator",
      reason: "signed-out",
    });
  });

  it("AC-E5.2: an operator outside their window, or at a gate not granted, is refused", async () => {
    const deps = await operatorDeps((event) => [
      grantFor(event, { gates: ["Later"], from: Date.now() + HOUR, until: Date.now() + 2 * HOUR }),
      grantFor(event, {
        id: "00000000-0000-4000-8000-00000000000b",
        gates: ["Ended"],
        from: Date.now() - 2 * HOUR,
        until: Date.now() - HOUR,
      }),
    ]);
    const holder = await chain.holder();
    const ticket = await chain.issue(holder);
    const at = (name: string) => ({ event: chain.event, gate: name });
    expect(refusal(await decide(deps, at("Later"), await holder.pass(ticket)))).toEqual({
      source: "operator",
      reason: "before-window",
    });
    expect(refusal(await decide(deps, at("Ended"), await holder.pass(ticket)))).toEqual({
      source: "operator",
      reason: "after-window",
    });
    expect(refusal(await decide(deps, at("North"), await holder.pass(ticket)))).toEqual({
      source: "operator",
      reason: "not-granted",
    });
  });

  it("AC-E2.1: a ticket whose allowance is spent says why", async () => {
    const deps = await operatorDeps((event) => [grantFor(event)]);
    const holder = await chain.holder();
    const ticket = await chain.issue(holder);
    const used = await holder.pass(ticket);
    const submitted = await chain.ledger.submitAccessPass(used, { presentedAt: Date.now() });
    expect(submitted.ok).toBe(true);
    expect(refusal(await decide(deps, gate, await holder.pass(ticket)))).toEqual({
      source: "ledger",
      code: "ERR-CannotAttend",
    });
  });

  it("a ticket of another event is refused, naming that event", async () => {
    const deps = await operatorDeps((event) => [grantFor(event)]);
    const holder = await chain.holder();
    const other = await chain.anotherEvent();
    const ticket = await chain.issue(holder, { kind: "Single" }, other);
    expect(refusal(await decide(deps, gate, await holder.pass(ticket)))).toEqual({
      source: "ledger",
      code: "ERR-TicketNotFound",
      ticketEvent: other,
    });
  });

  it("the operator's own authorisation is the reason shown first", async () => {
    const deps = await operatorDeps((event) => [grantFor(event, { revokedAt: null })]);
    standIn.revokeGrant(GRANT);
    const holder = await chain.holder();
    const stranger = await chain.holder();
    const ticket = await chain.issue(holder);
    expect(refusal(await decide(deps, gate, await stranger.pass(ticket)))).toEqual({
      source: "operator",
      reason: "grant-revoked",
    });
  });

  it("REQ-CL-3: with the ledger unreachable there is no verdict, and no admission", async () => {
    const unreachable: VerdictDeps["ledger"] = {
      getTicket: async () => ({ ok: false, error: { code: "ERR-LedgerUnavailable" } }),
      canAttend: async () => ({ ok: false, error: { code: "ERR-LedgerUnavailable" } }),
      getCredential: async () => ({ ok: false, error: { code: "ERR-LedgerUnavailable" } }),
    };
    const deps = await operatorDeps((event) => [grantFor(event)], unreachable);
    const holder = await chain.holder();
    const ticket = await chain.issue(holder);
    const verdict = await decide(deps, gate, await holder.pass(ticket));
    expect(verdict).toMatchObject({ kind: "unavailable", unreachable: "ledger" });
  });

  it("REQ-CL-3: with Kippu unreachable there is no verdict, and no admission", async () => {
    const holder = await chain.holder();
    const ticket = await chain.issue(holder);
    const deps: VerdictDeps = {
      ledger: chain.ledger,
      checkOperator: (g) => checkOperator(kippuClient({ url: "http://127.0.0.1:9" }), g),
      rpId: RP_ID,
      now: () => Date.now(),
    };
    expect(await decide(deps, gate, await holder.pass(ticket))).toMatchObject({
      kind: "unavailable",
      unreachable: "kippu",
    });
  });

  it("AC-E2.2: the three checks start together, and none of them writes", async () => {
    const holder = await chain.holder();
    const ticket = await chain.issue(holder);
    const started: string[] = [];
    let release: () => void = () => {};
    const gateOpen = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held =
      <T>(name: string, work: () => Promise<T>) =>
      async () => {
        started.push(name);
        await gateOpen;
        return work();
      };
    const ledger: Ticketto = chain.ledger;
    const cursorBefore = await ledger.log.read(LOG_START, 1_000);
    const deps: VerdictDeps = {
      ledger: {
        getTicket: (t) => held("getTicket", () => ledger.getTicket(t))(),
        canAttend: (e, t) => held("canAttend", () => ledger.canAttend(e, t))(),
        getCredential: (a, c) => held("getCredential", () => ledger.getCredential(a, c))(),
      },
      checkOperator: held("operators.check", async () => ({
        kind: "authorised" as const,
        authorisation: { event: chain.event, gate: "North", grant: GRANT, until: 0, checkedAt: 0 },
      })),
      rpId: RP_ID,
      now: () => Date.now(),
    };
    const pending = decide(deps, gate, await holder.pass(ticket));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started.sort()).toEqual(["canAttend", "getCredential", "getTicket", "operators.check"]);
    release();
    expect((await pending).kind).toBe("admit");
    expect(await ledger.log.read(LOG_START, 1_000)).toEqual(cursorBefore);
  });
});
