import { describe, expect, it } from "vitest";
import { deviceStorage } from "../../test/device-storage.ts";
import { type PendingReport, persistentReportStore } from "./report-store.ts";

const report = (overrides: Partial<PendingReport> = {}): PendingReport => ({
  reportId: "00000000-0000-4000-8000-000000000001",
  event: "e1".repeat(32),
  gate: "North",
  ticket: "7e".repeat(32),
  passId: "c4".repeat(16),
  holder: "03".repeat(32),
  presentedAt: 1_000,
  admittedAt: 1_001,
  token: "session-token",
  ...overrides,
});

describe("T-050-11 pending report store", () => {
  it("keeps reports in app storage and their session tokens only in secure storage", async () => {
    const device = deviceStorage();
    const store = persistentReportStore(device.kv, device.secure);
    await store.put(report());
    await store.put(report({ reportId: "00000000-0000-4000-8000-000000000002", token: "other" }));

    const stored = [...device.kv.items.values()].join("");
    expect(stored).toContain("00000000-0000-4000-8000-000000000001");
    expect(stored).not.toContain("session-token");
    expect([...device.secure.items.values()].sort()).toEqual(["other", "session-token"]);

    // Another app instance on the same device reads them back.
    const again = persistentReportStore(device.kv, device.secure);
    expect(await again.list()).toEqual([
      report(),
      report({ reportId: "00000000-0000-4000-8000-000000000002", token: "other" }),
    ]);
  });

  it("replaces a report by its id, and removes it with its token", async () => {
    const device = deviceStorage();
    const store = persistentReportStore(device.kv, device.secure);
    await store.put(report());
    await store.put(report({ submission: { outcome: "settled", cursor: "42" } }));
    expect(await store.list()).toEqual([
      report({ submission: { outcome: "settled", cursor: "42" } }),
    ]);
    await store.remove(report().reportId);
    expect(await store.list()).toEqual([]);
    expect(device.secure.items.size).toBe(0);
  });

  it("loses no write when writes interleave", async () => {
    const device = deviceStorage();
    const store = persistentReportStore(device.kv, device.secure);
    const ids = Array.from(
      { length: 20 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    await Promise.all(ids.map((reportId) => store.put(report({ reportId }))));
    expect((await store.list()).map((r) => r.reportId).sort()).toEqual(ids);
  });

  it("ignores stored data it cannot read, rather than failing to start", async () => {
    const device = deviceStorage();
    await device.kv.setItem("iriguchi.pending-reports.v1", "not json");
    expect(await persistentReportStore(device.kv, device.secure).list()).toEqual([]);
    await device.kv.setItem("iriguchi.pending-reports.v1", JSON.stringify([{ reportId: 1 }]));
    expect(await persistentReportStore(device.kv, device.secure).list()).toEqual([]);
  });
});
