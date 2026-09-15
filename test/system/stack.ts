// The system stack Iriguchi's system tests run against — the ledger service
// (`ticketto-offchain`), Kippu's sponsor relay, and kippu-api wired to that ledger
// (its `staging` wiring) — and the steps of a journey that are not Iriguchi's: an
// organiser who signs in, creates an event and issues a ticket; a holder whose
// passkey is F-003's simulated authenticator. Those are test fixtures here: Iriguchi
// signs nobody in as an organiser and holds no holder key (REQ-CL-2).
//
// The ledger service is private, so these tests run only where the stack runs —
// locally, and in kippu-e2e (F-070). They are skipped unless
//   IRIGUCHI_TEST_LEDGER_URL, IRIGUCHI_TEST_SPONSOR_URL, IRIGUCHI_TEST_KIPPU_API_URL
// are set. IRIGUCHI_TEST_RP_ID (default kippu.example) is the stack's holder RP id,
// and IRIGUCHI_TEST_ORGANISER_ORIGIN (default http://localhost:5173) one of its login
// origins.

import { producePass } from "@ticketto/profile-v0";
import { simulatedWebAuthnSigner } from "@ticketto/profile-v0/testing";
import type { AttendancePolicy, EventId, TicketId } from "@ticketto/sdk";
import { createAdmissions, randomUuid } from "../../src/admission/admissions.ts";
import { reportAdmission } from "../../src/admission/report.ts";
import { createServerClock, timed } from "../../src/clock/server-clock.ts";
import { kippuClient } from "../../src/kippu/client.ts";
import { connectLedger, GATE_READ_RETRY } from "../../src/ledger/ticketto.ts";
import { checkOperator } from "../../src/operator/check.ts";
import { operatorApi, signIn } from "../../src/operator/session.ts";
import { memorySessionStore } from "../../src/operator/store.ts";
import type { VerdictDeps } from "../../src/verdict/verdict.ts";
import { SoftwareAuthenticator } from "./organiser-authenticator.ts";

const env = process.env;

export const stack = {
  ledgerUrl: env.IRIGUCHI_TEST_LEDGER_URL as string,
  sponsorUrl: env.IRIGUCHI_TEST_SPONSOR_URL as string,
  kippuUrl: env.IRIGUCHI_TEST_KIPPU_API_URL as string,
  rpId: env.IRIGUCHI_TEST_RP_ID ?? "kippu.example",
  organiserOrigin: env.IRIGUCHI_TEST_ORGANISER_ORIGIN ?? "http://localhost:5173",
};

export const stackAvailable =
  env.IRIGUCHI_TEST_LEDGER_URL !== undefined &&
  env.IRIGUCHI_TEST_SPONSOR_URL !== undefined &&
  env.IRIGUCHI_TEST_KIPPU_API_URL !== undefined;

export const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

const endpoints = () => ({
  ledgerUrl: stack.ledgerUrl,
  sponsorUrl: stack.sponsorUrl,
  rpId: stack.rpId,
});

async function ledger(retry?: typeof GATE_READ_RETRY) {
  const connected = await connectLedger(endpoints(), retry);
  if (!connected.ok) throw new Error(`ledger: ${connected.error.code}`);
  return connected.value;
}

/** An organiser signed in to kippu-api, as Ibento signs one in. */
export async function organiser() {
  const anonymous = kippuClient({ url: stack.kippuUrl });
  const email = `organiser-${crypto.randomUUID()}@organiser.example`;
  const passkey = new SoftwareAuthenticator({ origin: stack.organiserOrigin });
  const signUp = await anonymous.auth.organiser.beginSignUp.mutate({ email });
  const { session } = await anonymous.auth.organiser.completeSignUp.mutate({
    ceremonyId: signUp.ceremonyId,
    credential: passkey.create(signUp.options),
  });
  return kippuClient({ url: stack.kippuUrl, token: () => session.token });
}

/** A holder whose credential is registered on the ledger, as Saifu registers one. */
export async function holder() {
  const credential = simulatedWebAuthnSigner({ rpId: stack.rpId });
  const registered = await (await ledger()).registerCredential(credential.signer, {
    account: credential.signer.account,
    registration: credential.registration,
  });
  if (!registered.ok) throw new Error(`registration: ${registered.error.code}`);
  return {
    account: credential.signer.account,
    pass: (ticket: string) =>
      producePass(
        { ticket: ticket as TicketId, holder: credential.signer.account, notBefore: Date.now() },
        credential.signer,
      ),
  };
}

type Organiser = Awaited<ReturnType<typeof organiser>>;

/** An event with one unseated zone and a granted class, and a ticket of it issued to `account`. */
export async function ticketFor(
  api: Organiser,
  account: string,
  policy: AttendancePolicy = { kind: "Multiple", max: 5, until: null },
) {
  const zone = randomId();
  const { event } = await api.events.create.mutate({
    zones: [{ id: zone, kind: "Unseated" }],
    capacity: null,
  });
  const guests = await api.events.classes.define.mutate({
    event,
    name: "Guests",
    description: null,
    provenance: "Granted",
    policy,
    restrictions: { cannotResale: false, cannotTransfer: false },
    quota: null,
  });
  const { ticket, cursor } = await api.events.tickets.issueGranted.mutate({
    event,
    class: guests.id,
    zone,
    placement: { kind: "Unseated" },
    holder: account,
  });
  // The relay entitles a pass by the ticket in Kippu's copy.
  await api.derived.waitFor.query({ cursor, timeout: 10_000 });
  return { event: event as EventId, ticket: ticket as TicketId };
}

/** An operator of `api`'s organiser, granted `gates` of `event` for the next hour, on `devices` devices. */
export async function operatorDevices(
  api: Organiser,
  event: EventId,
  gates: readonly string[],
  devices: number,
) {
  const operator = await api.operators.create.mutate({ name: "Gate staff" });
  await api.operators.grants.create.mutate({
    operator: operator.id,
    event,
    gates: [...gates],
    from: Date.now() - 60_000,
    until: Date.now() + 60 * 60 * 1000,
  });
  const readLedger = await ledger(GATE_READ_RETRY);
  const writeLedger = await ledger();
  return Promise.all(
    Array.from({ length: devices }, async () => {
      const { code } = await api.operators.issueEnrolmentCode.mutate({ operator: operator.id });
      const store = memorySessionStore();
      const signedIn = await signIn(operatorApi(kippuClient({ url: stack.kippuUrl })), store, code);
      if (signedIn.kind !== "signed-in") throw new Error(`sign-in: ${signedIn.kind}`);
      const clock = createServerClock();
      const client = kippuClient({ url: stack.kippuUrl, token: () => signedIn.record.token });
      const report = reportAdmission(stack.kippuUrl);
      const verdict: VerdictDeps = {
        ledger: readLedger,
        checkOperator: (gate) =>
          timed(
            clock,
            () => checkOperator(client, gate),
            (check) => (check.kind === "authorised" ? check.authorisation.checkedAt : null),
          ),
        rpId: stack.rpId,
        now: clock.now,
      };
      return {
        token: signedIn.record.token,
        clock,
        verdict,
        admissions: createAdmissions({
          submit: (pass, presentedAt) => writeLedger.submitAccessPass(pass, { presentedAt }),
          report: (input, token) =>
            timed(
              clock,
              () => report(input, token),
              (r) => r.receivedAt,
            ),
          deviceClock: clock.deviceNow,
          reportId: randomUuid,
        }),
        ledger: readLedger,
      };
    }),
  );
}
