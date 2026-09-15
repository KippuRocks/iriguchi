// node tools/ci/kippu-api-stand-in.ts — serves test/kippu-api-stand-in.ts on
// 127.0.0.1:8080 for the device smoke flow: enrolment code GATE-ENROL-TEST opens a
// session whose operator holds a grant of gate North at the Smoke Test Night event,
// for the next 24 hours.

import { startKippuStandIn } from "../../test/kippu-api-stand-in.ts";

export const SMOKE_EVENT = "5e".repeat(32);
const now = Date.now();

const standIn = await startKippuStandIn({
  code: "GATE-ENROL-TEST",
  operatorId: "00000000-0000-4000-8000-000000000001",
  port: 8080,
  grants: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      operator: "00000000-0000-4000-8000-000000000001",
      event: SMOKE_EVENT,
      gates: ["North"],
      from: now - 60 * 60 * 1000,
      until: now + 24 * 60 * 60 * 1000,
      createdAt: new Date(now).toISOString(),
      revokedAt: null,
    },
  ],
  eventNames: { [SMOKE_EVENT]: "Smoke Test Night" },
});
console.log(`kippu-api stand-in on ${standIn.url}`);
