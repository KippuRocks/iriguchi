import { describe, expect, it } from "vitest";
import { installPolyfills } from "./polyfills.ts";

function bareRuntime(): typeof globalThis {
  return { TextEncoder, TextDecoder } as unknown as typeof globalThis;
}

describe("runtime polyfills", () => {
  it("installs crypto.getRandomValues over the platform random source", () => {
    const target = bareRuntime();
    const calls: number[] = [];
    installPolyfills(target, (bytes) => {
      calls.push(bytes.length);
      bytes.fill(7);
    });
    const words = target.crypto.getRandomValues(new Uint32Array(2));
    expect(calls).toEqual([8]);
    expect([...words]).toEqual([0x07070707, 0x07070707]);
    expect(() => target.crypto.getRandomValues(new Float32Array(1) as never)).toThrow(TypeError);
  });

  it("keeps a runtime's own implementations", () => {
    const own = { getRandomValues: () => null, subtle: { digest: async () => new ArrayBuffer(0) } };
    const target = { ...bareRuntime(), crypto: own } as unknown as typeof globalThis;
    installPolyfills(target, () => {
      throw new Error("unused");
    });
    expect(target.crypto).toBe(own);
    expect(target.crypto.getRandomValues).toBe(own.getRandomValues);
  });

  it("fails loudly when TextDecoder is missing", () => {
    const target = { TextEncoder } as unknown as typeof globalThis;
    expect(() => installPolyfills(target, () => {})).toThrow(/TextDecoder/);
  });
});
