// Web platform APIs Hermes does not provide. `install-polyfills.ts` installs
// them before anything else runs (index.ts imports it first).
//
// - `crypto.getRandomValues` — the SDK draws operation ids from it, and Iriguchi
//   its admission report ids. Backed by the platform's secure random source
//   through expo-crypto.
// - `TextDecoder` — `scale-ts` decodes strings with it. Expo's runtime installs
//   it; this module only checks it is there, with `TextEncoder`, which Hermes has.
//
// The same module as Saifu's (T-030-02), without the SHA-256 digest only Saifu's
// passkey authenticator needs.

/** Fills `bytes` from the platform's cryptographically secure random source. */
export type RandomSource = (bytes: Uint8Array) => void;

export function installPolyfills(target: typeof globalThis, fillRandom: RandomSource): void {
  const scope = target as { crypto?: Partial<Crypto> };
  const crypto: Partial<Crypto> = scope.crypto ?? {};
  if (scope.crypto === undefined) {
    Object.defineProperty(target, "crypto", { value: crypto, configurable: true });
  }

  if (typeof crypto.getRandomValues !== "function") {
    Object.defineProperty(crypto, "getRandomValues", {
      value: <T extends ArrayBufferView | null>(array: T): T => {
        if (!(array instanceof Uint8Array) && !(array instanceof Uint32Array)) {
          // Only the integer arrays WebCrypto accepts, narrowed to those the app uses.
          throw new TypeError("getRandomValues: expected a Uint8Array or Uint32Array");
        }
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        fillRandom(bytes);
        return array;
      },
      configurable: true,
    });
  }

  for (const name of ["TextEncoder", "TextDecoder"] as const) {
    if (typeof (target as Record<string, unknown>)[name] !== "function") {
      throw new Error(`${name} is missing from the JavaScript runtime`);
    }
  }
}
