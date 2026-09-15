// Expo app configuration, layered over app.json: the services Iriguchi reaches,
// and the holder RP id passes are verified against. Hostnames and the RP id's
// domain are not chosen yet, so they are configuration, with placeholders under
// the reserved `.example` TLD. A build for real operators must set them.

import type { ConfigContext, ExpoConfig } from "expo/config";

/** Placeholders for services whose hostnames are not chosen yet. */
export const PLACEHOLDER_ENDPOINTS = {
  kippuApiUrl: "https://api.kippu.example",
  ledgerUrl: "https://ledger.kippu.example",
  sponsorUrl: "https://sponsor.kippu.example",
} as const;

/**
 * The holder credentials' WebAuthn RP id, a deployment parameter of the V0 profile
 * (features/003-profile-v0/plan.md §5.3). It must equal Saifu's `SAIFU_RP_ID`, or
 * no holder's pass verifies. Placeholder, as in Saifu.
 */
export const PLACEHOLDER_RP_ID = "kippu.example";

export interface EndpointsConfig {
  /** kippu-api: operator sessions, grants, checks and admission reports (F-020, F-024). */
  readonly kippuApiUrl: string;
  /** The ledger service (`ticketto-offchain`), reached through `binding-offchain`. */
  readonly ledgerUrl: string;
  /** Kippu's sponsor relay (F-023). */
  readonly sponsorUrl: string;
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function readUrl(name: string, value: string | undefined, fallback: string): string {
  const url = value?.trim() || fallback;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${name} must be an http(s) URL: ${url}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${name} must be an http(s) URL: ${url}`);
  }
  return url.replace(/\/+$/, "");
}

export function endpointsConfig(env: Record<string, string | undefined>): EndpointsConfig {
  return {
    kippuApiUrl: readUrl(
      "IRIGUCHI_KIPPU_API_URL",
      env.IRIGUCHI_KIPPU_API_URL,
      PLACEHOLDER_ENDPOINTS.kippuApiUrl,
    ),
    ledgerUrl: readUrl(
      "IRIGUCHI_LEDGER_URL",
      env.IRIGUCHI_LEDGER_URL,
      PLACEHOLDER_ENDPOINTS.ledgerUrl,
    ),
    sponsorUrl: readUrl(
      "IRIGUCHI_SPONSOR_URL",
      env.IRIGUCHI_SPONSOR_URL,
      PLACEHOLDER_ENDPOINTS.sponsorUrl,
    ),
  };
}

export function holderRpId(env: Record<string, string | undefined>): string {
  const rpId = env.IRIGUCHI_RP_ID?.trim().toLowerCase() || PLACEHOLDER_RP_ID;
  if (!HOSTNAME.test(rpId)) {
    throw new Error(`IRIGUCHI_RP_ID must be a domain name, without scheme or port: ${rpId}`);
  }
  return rpId;
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Iriguchi",
  slug: config.slug ?? "iriguchi",
  extra: {
    ...config.extra,
    endpoints: endpointsConfig(process.env),
    holderRpId: holderRpId(process.env),
  },
});
