// The operator services the app's screens use (T-050-02): the build's
// configuration (app.config.ts), the device's secure storage, and kippu-api.

import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { kippuClient } from "../kippu/client.ts";
import { type OperatorApi, operatorApi } from "../operator/session.ts";
import {
  type OperatorSessionRecord,
  type OperatorSessionStore,
  secureSessionStore,
} from "../operator/store.ts";

export interface BuildConfig {
  readonly kippuApiUrl: string;
}

export function buildConfig(): BuildConfig {
  const extra = Constants.expoConfig?.extra as { endpoints?: { kippuApiUrl?: string } } | undefined;
  const kippuApiUrl = extra?.endpoints?.kippuApiUrl;
  if (kippuApiUrl === undefined) {
    throw new Error("the build is missing its endpoint configuration (app.config.ts)");
  }
  return { kippuApiUrl };
}

export interface OperatorServices {
  readonly store: OperatorSessionStore;
  /** kippu-api, as the operator of `session` when there is one. */
  api(session: OperatorSessionRecord | null): OperatorApi;
}

export function operatorServices(config: BuildConfig = buildConfig()): OperatorServices {
  return {
    store: secureSessionStore(SecureStore),
    api: (session) =>
      operatorApi(kippuClient({ url: config.kippuApiUrl, token: () => session?.token })),
  };
}
