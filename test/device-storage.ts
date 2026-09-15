// App storage and secure storage as a device keeps them across app restarts: plain
// maps that outlive the app instances a test creates and drops.

import type { KeyValueStorage, SecureStorage } from "../src/admission/report-store.ts";

export interface DeviceStorage {
  readonly kv: KeyValueStorage & { readonly items: Map<string, string> };
  readonly secure: SecureStorage & { readonly items: Map<string, string> };
}

export function deviceStorage(): DeviceStorage {
  const kvItems = new Map<string, string>();
  const secureItems = new Map<string, string>();
  return {
    kv: {
      items: kvItems,
      getItem: async (key) => kvItems.get(key) ?? null,
      setItem: async (key, value) => {
        kvItems.set(key, value);
      },
    },
    secure: {
      items: secureItems,
      getItemAsync: async (key) => secureItems.get(key) ?? null,
      setItemAsync: async (key, value) => {
        secureItems.set(key, value);
      },
      deleteItemAsync: async (key) => {
        secureItems.delete(key);
      },
    },
  };
}
