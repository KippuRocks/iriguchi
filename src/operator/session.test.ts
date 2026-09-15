import type { OperatorGrant } from "@kippu/api";
import { afterEach, describe, expect, it } from "vitest";
import { type StandIn, startKippuStandIn } from "../../test/kippu-api-stand-in.ts";
import { kippuClient } from "../kippu/client.ts";
import { currentSession, loadGates, operatorApi, signIn, signOut } from "./session.ts";
import { memorySessionStore, type OperatorSessionRecord } from "./store.ts";

const EVENT_A = "a1".repeat(32);
const EVENT_B = "b2".repeat(32);
const HOUR = 60 * 60 * 1000;

function grant(overrides: Partial<OperatorGrant>): OperatorGrant {
  return {
    id: crypto.randomUUID(),
    operator: "operator-1",
    event: EVENT_A,
    gates: ["North"],
    from: Date.now() - HOUR,
    until: Date.now() + HOUR,
    createdAt: new Date().toISOString(),
    revokedAt: null,
    ...overrides,
  };
}

let standIn: StandIn | null = null;
afterEach(async () => {
  await standIn?.close();
  standIn = null;
});

async function kippu(grants: readonly OperatorGrant[]) {
  standIn = await startKippuStandIn({
    code: "enrol-1234",
    operatorId: "operator-1",
    grants,
    eventNames: { [EVENT_A]: "Harbour Lights" },
  });
  const url = standIn.url;
  return {
    anonymous: operatorApi(kippuClient({ url })),
    as: (session: OperatorSessionRecord | null) =>
      operatorApi(kippuClient({ url, token: () => session?.token })),
  };
}

describe("T-050-02 operator sign-in", () => {
  it("US-E5: an operator redeems an enrolment code, and the session is kept on the device", async () => {
    const api = await kippu([]);
    const store = memorySessionStore();
    const outcome = await signIn(api.anonymous, store, "  enrol-1234 ");
    expect(outcome.kind).toBe("signed-in");
    const record = await store.load();
    expect(record?.operatorId).toBe("operator-1");
    expect(record?.expiresAt).toBeGreaterThan(Date.now() + 23 * HOUR);
    expect(await currentSession(store, Date.now())).toEqual(record);
  });

  it("a used or unknown code is refused, and nothing is kept", async () => {
    const api = await kippu([]);
    const store = memorySessionStore();
    expect((await signIn(api.anonymous, store, "enrol-1234")).kind).toBe("signed-in");
    const other = memorySessionStore();
    expect(await signIn(api.anonymous, other, "enrol-1234")).toEqual({ kind: "refused" });
    expect(await signIn(api.anonymous, other, "wrong")).toEqual({ kind: "refused" });
    expect(await signIn(api.anonymous, other, "   ")).toEqual({ kind: "refused" });
    expect(await other.load()).toBeNull();
  });

  it("kippu-api not answering is told apart from a refusal", async () => {
    const api = operatorApi(kippuClient({ url: "http://127.0.0.1:9" }));
    expect(await signIn(api, memorySessionStore(), "enrol-1234")).toEqual({
      kind: "unreachable",
    });
  });

  it("an ended session on the device is forgotten", async () => {
    const store = memorySessionStore({ token: "t", expiresAt: Date.now() - 1, operatorId: "o" });
    expect(await currentSession(store, Date.now())).toBeNull();
    expect(await store.load()).toBeNull();
  });
});

describe("T-050-02 event and gate selection", () => {
  it("US-E5: an operator with a grant is offered its event's gates, soonest first", async () => {
    const later = grant({ event: EVENT_B, gates: ["VIP"], from: Date.now() + HOUR });
    const now = grant({ gates: ["South", "North"] });
    const api = await kippu([later, now]);
    const store = memorySessionStore();
    const signedIn = await signIn(api.anonymous, store, "enrol-1234");
    if (signedIn.kind !== "signed-in") throw new Error(signedIn.kind);

    const gates = await loadGates(api.as(signedIn.record), store);
    expect(gates).toEqual({
      kind: "gates",
      choices: [
        {
          grant: now.id,
          event: EVENT_A,
          eventName: "Harbour Lights",
          gate: "North",
          from: now.from,
          until: now.until,
        },
        {
          grant: now.id,
          event: EVENT_A,
          eventName: "Harbour Lights",
          gate: "South",
          from: now.from,
          until: now.until,
        },
        {
          grant: later.id,
          event: EVENT_B,
          eventName: null,
          gate: "VIP",
          from: later.from,
          until: later.until,
        },
      ],
    });
  });

  it("an operator without grants is offered no gate", async () => {
    const api = await kippu([]);
    const store = memorySessionStore();
    const signedIn = await signIn(api.anonymous, store, "enrol-1234");
    if (signedIn.kind !== "signed-in") throw new Error(signedIn.kind);
    expect(await loadGates(api.as(signedIn.record), store)).toEqual({ kind: "gates", choices: [] });
  });

  it("a revoked session signs the operator out", async () => {
    const api = await kippu([grant({})]);
    const store = memorySessionStore();
    const signedIn = await signIn(api.anonymous, store, "enrol-1234");
    if (signedIn.kind !== "signed-in") throw new Error(signedIn.kind);
    standIn?.revokeSessions();
    expect(await loadGates(api.as(signedIn.record), store)).toEqual({ kind: "signed-out" });
    expect(await store.load()).toBeNull();
  });

  it("signing out ends the session with kippu-api and forgets it", async () => {
    const api = await kippu([grant({})]);
    const store = memorySessionStore();
    const signedIn = await signIn(api.anonymous, store, "enrol-1234");
    if (signedIn.kind !== "signed-in") throw new Error(signedIn.kind);
    await signOut(api.as(signedIn.record), store);
    expect(await store.load()).toBeNull();
    expect(await loadGates(api.as(signedIn.record), store)).toEqual({ kind: "signed-out" });
  });
});
