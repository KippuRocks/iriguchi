import { describe, expect, it } from "vitest";
import { CLOCK_TOLERANCE_MS, createServerClock, timed } from "./server-clock.ts";

describe("T-050-07 server clock", () => {
  it("measures drift at the middle of the request, so the round trip is not drift", () => {
    let device = 1_000_000;
    const clock = createServerClock(() => device);
    clock.observe(1_000_150, 1_000_000, 1_000_300);
    expect(clock.drift()).toBe(0);
    device = 2_000_000;
    clock.observe(1_970_000, 1_999_900, 2_000_100);
    expect(clock.drift()).toBe(-30_000);
    expect(clock.now()).toBe(1_970_000);
    expect(clock.deviceNow()).toBe(2_000_000);
  });

  it("is within tolerance until drift exceeds 10 s, either way", () => {
    const clock = createServerClock(() => 0);
    expect(clock.outsideTolerance()).toBe(false);
    clock.observe(CLOCK_TOLERANCE_MS, 0, 0);
    expect(clock.outsideTolerance()).toBe(false);
    clock.observe(CLOCK_TOLERANCE_MS + 1, 0, 0);
    expect(clock.outsideTolerance()).toBe(true);
    clock.observe(-CLOCK_TOLERANCE_MS - 1, 0, 0);
    expect(clock.outsideTolerance()).toBe(true);
  });

  it("uses device time unadjusted before any response, and notifies on change", async () => {
    let device = 500;
    const clock = createServerClock(() => device);
    expect(clock.now()).toBe(500);
    let notified = 0;
    const unsubscribe = clock.subscribe(() => notified++);
    await timed(
      clock,
      async () => {
        device += 100;
        return { checkedAt: 40_550 };
      },
      (response) => response.checkedAt,
    );
    expect(clock.drift()).toBe(40_000);
    expect(notified).toBe(1);
    unsubscribe();
    clock.observe(0, 0, 0);
    expect(notified).toBe(1);
  });
});
