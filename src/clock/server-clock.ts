// The gate's clock against Kippu's (T-050-07; REQ-OP-3; features/050-iriguchi/plan.md
// §5.3).
//
// Iriguchi compares its clock with server time on every response that carries
// one: `operators.check`'s `checkedAt` and an admission report's `receivedAt`,
// both Kippu's clock. The server's time is taken at the middle of the request, so
// the network's round trip does not count as drift. Beyond the tolerance agreed
// with F-025 — 10 seconds (features/025-derived-state/plan.md §5.5) — the operator
// is warned; the drift reaches the organiser through every admission report, which
// carries the device's unadjusted clock beside Kippu's receipt time (F-024 §5.3).
//
// Iriguchi never corrects the device's clock. It uses server-adjusted time for a
// pass's presentation time, and for judging its window.

export const CLOCK_TOLERANCE_MS = 10_000;

export interface ServerClock {
  /** Records a response: Kippu's time in it, and the device's clock before and after the request. */
  observe(serverTime: number, sentAt: number, receivedAt: number): void;
  /** The device's clock, unadjusted. */
  deviceNow(): number;
  /** Server-adjusted time: the device's clock corrected by the last observed drift. */
  now(): number;
  /** Server time minus device time, from the last response; `null` before the first. */
  drift(): number | null;
  /** Whether the last observed drift is beyond the tolerance. */
  outsideTolerance(): boolean;
  subscribe(listener: () => void): () => void;
}

export function createServerClock(deviceNow: () => number = Date.now): ServerClock {
  let drift: number | null = null;
  const listeners = new Set<() => void>();
  return {
    observe(serverTime, sentAt, receivedAt) {
      const next = Math.round(serverTime - (sentAt + receivedAt) / 2);
      if (next === drift) return;
      drift = next;
      for (const listener of listeners) listener();
    },
    deviceNow,
    now: () => deviceNow() + (drift ?? 0),
    drift: () => drift,
    outsideTolerance: () => drift !== null && Math.abs(drift) > CLOCK_TOLERANCE_MS,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Runs `request`, observing the server time its response carries. */
export async function timed<T>(
  clock: ServerClock,
  request: () => Promise<T>,
  serverTimeOf: (response: T) => number | null,
): Promise<T> {
  const sentAt = clock.deviceNow();
  const response = await request();
  const serverTime = serverTimeOf(response);
  if (serverTime !== null) clock.observe(serverTime, sentAt, clock.deviceNow());
  return response;
}
