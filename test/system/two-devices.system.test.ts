// T-050-09 against the real system (see stack.ts for when it runs): two devices
// admit the same pass, the ledger service records one attendance, and the organiser
// sees the flag in Ibento's read, `derived.admissionFlags.list`.

import { describe, expect, it } from "vitest";
import { decide } from "../../src/verdict/verdict.ts";
import { holder, operatorDevices, organiser, stackAvailable, ticketFor } from "./stack.ts";

describe.skipIf(!stackAvailable)(
  "T-050-09 two devices against kippu-api and the ledger service",
  () => {
    it("AC-E3.4: both admit, the ledger records one, and a flag appears in Ibento", async () => {
      const api = await organiser();
      const guest = await holder();
      const { event, ticket } = await ticketFor(api, guest.account);
      const [north, south] = await operatorDevices(api, event, ["North", "South"], 2);
      if (north === undefined || south === undefined) throw new Error("no devices");
      const pass = await guest.pass(ticket);

      const [atNorth, atSouth] = await Promise.all(
        [
          { device: north, gate: "North" },
          { device: south, gate: "South" },
        ].map(async ({ device, gate }) => ({
          device,
          gate,
          presentedAt: device.clock.now(),
          verdict: await decide(device.verdict, { event, gate }, pass),
        })),
      );
      if (atNorth === undefined || atSouth === undefined) throw new Error("no verdicts");
      expect(atNorth.verdict.kind).toBe("admit");
      expect(atSouth.verdict.kind).toBe("admit");

      const outcomes = await Promise.all(
        [
          atNorth,
          { ...atSouth, presentedAt: Math.max(atSouth.presentedAt, atNorth.presentedAt + 1) },
        ].map(({ device, gate, presentedAt }) =>
          device.admissions.admit({ event, gate, pass, presentedAt, token: device.token }),
        ),
      );
      expect(outcomes.map((outcome) => outcome.kind)).toEqual(["recorded", "recorded"]);

      const recorded = await north.ledger.getTicket(ticket);
      expect(recorded.ok && recorded.value.attendances).toBe(1);

      const { flags } = await api.derived.admissionFlags.list.query({ event });
      expect(flags).toEqual([
        expect.objectContaining({
          passId: pass.pass.id,
          cause: "same-pass-at-two-gates",
          refusal: { errorCode: "ERR-PassReplayed" },
        }),
      ]);
    }, 120_000);
  },
);
