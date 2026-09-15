// The operator services the app's screens use: the build's configuration
// (app.config.ts), the device's secure storage, kippu-api, and the ledger.

import type { Result, Ticketto } from "@ticketto/sdk";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { kippuClient } from "../kippu/client.ts";
import { connectLedger, GATE_READ_RETRY } from "../ledger/ticketto.ts";
import { checkOperator } from "../operator/check.ts";
import { type OperatorApi, operatorApi } from "../operator/session.ts";
import {
  type OperatorSessionRecord,
  type OperatorSessionStore,
  secureSessionStore,
} from "../operator/store.ts";
import type { VerdictDeps } from "../verdict/verdict.ts";

export interface BuildConfig {
  readonly kippuApiUrl: string;
  readonly ledgerUrl: string;
  readonly sponsorUrl: string;
  readonly rpId: string;
}

export function buildConfig(): BuildConfig {
  const extra = Constants.expoConfig?.extra as
    | {
        endpoints?: { kippuApiUrl?: string; ledgerUrl?: string; sponsorUrl?: string };
        holderRpId?: string;
      }
    | undefined;
  const endpoints = extra?.endpoints;
  const rpId = extra?.holderRpId;
  if (
    endpoints?.kippuApiUrl === undefined ||
    endpoints.ledgerUrl === undefined ||
    endpoints.sponsorUrl === undefined ||
    rpId === undefined
  ) {
    throw new Error("the build is missing its endpoint configuration (app.config.ts)");
  }
  return {
    kippuApiUrl: endpoints.kippuApiUrl,
    ledgerUrl: endpoints.ledgerUrl,
    sponsorUrl: endpoints.sponsorUrl,
    rpId,
  };
}

export interface OperatorServices {
  readonly store: OperatorSessionStore;
  /** kippu-api, as the operator of `session` when there is one. */
  api(session: OperatorSessionRecord | null): OperatorApi;
  /** What a verdict needs, as the operator of `session`, now. */
  verdict(session: OperatorSessionRecord | null): VerdictDeps;
}

const LEDGER_UNAVAILABLE = {
  ok: false,
  error: { code: "ERR-LedgerUnavailable" },
} as const satisfies Result<never>;

export function operatorServices(config: BuildConfig = buildConfig()): OperatorServices {
  // One connection to the ledger service for the gate's reads, made on first use; a
  // failed attempt is forgotten, so the next scan tries again.
  let connection: Promise<Result<Ticketto>> | null = null;
  const ledger = () => {
    connection ??= connectLedger(config, GATE_READ_RETRY).catch(() => LEDGER_UNAVAILABLE);
    return connection.then((connected) => {
      if (!connected.ok) connection = null;
      return connected;
    });
  };
  const viaLedger =
    <K extends "getTicket" | "canAttend" | "getCredential">(name: K) =>
    async (...args: Parameters<Ticketto[K]>) => {
      const connected = await ledger();
      if (!connected.ok) return LEDGER_UNAVAILABLE;
      return (connected.value[name] as (...a: Parameters<Ticketto[K]>) => ReturnType<Ticketto[K]>)(
        ...args,
      );
    };

  return {
    store: secureSessionStore(SecureStore),
    api: (session) =>
      operatorApi(kippuClient({ url: config.kippuApiUrl, token: () => session?.token })),
    verdict: (session) => {
      const client = kippuClient({ url: config.kippuApiUrl, token: () => session?.token });
      return {
        ledger: {
          getTicket: viaLedger("getTicket"),
          canAttend: viaLedger("canAttend"),
          getCredential: viaLedger("getCredential"),
        } as VerdictDeps["ledger"],
        checkOperator: (gate) => checkOperator(client, gate),
        rpId: config.rpId,
        now: () => Date.now(),
      };
    },
  };
}
