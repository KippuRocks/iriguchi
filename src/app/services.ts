// The operator services the app's screens use: the build's configuration
// (app.config.ts), the device's secure storage, kippu-api, and the ledger.

import { createSubmission, type Result, type Ticketto } from "@ticketto/sdk";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { type Admissions, createAdmissions, randomUuid } from "../admission/admissions.ts";
import { reportAdmission } from "../admission/report.ts";
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
  /** Background submission and reporting of admissions (T-050-06). */
  readonly admissions: Admissions;
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

  // Submissions run in the background with the binding's full retry budget (NFR-2),
  // over their own connection.
  let submitting: Promise<Result<Ticketto>> | null = null;
  const submissionLedger = () => {
    submitting ??= connectLedger(config).catch(() => LEDGER_UNAVAILABLE);
    return submitting.then((connected) => {
      if (!connected.ok) submitting = null;
      return connected;
    });
  };
  const admissions = createAdmissions({
    submit: (pass, presentedAt) => {
      const controller = createSubmission();
      submissionLedger()
        .then(async (connected) => {
          if (!connected.ok) {
            controller.rejected(connected.error);
            return;
          }
          const result = await connected.value.submitAccessPass(pass, { presentedAt });
          if (result.ok) controller.settled(result.value);
          else controller.rejected(result.error);
        })
        .catch((reason: unknown) => controller.failed(reason));
      return controller.submission;
    },
    report: reportAdmission(config.kippuApiUrl),
    deviceClock: () => Date.now(),
    reportId: randomUuid,
  });

  return {
    admissions,
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
