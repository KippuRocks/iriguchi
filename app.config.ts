// Expo app configuration, layered over app.json: the service endpoints Iriguchi
// reaches. Their hostnames are not chosen yet, so they are configuration, with
// placeholders under the reserved `.example` TLD. A build for real operators must
// set them.

import type { ConfigContext, ExpoConfig } from "expo/config";

/** Placeholders for services whose hostnames are not chosen yet. */
export const PLACEHOLDER_ENDPOINTS = {
  kippuApiUrl: "https://api.kippu.example",
} as const;

export interface EndpointsConfig {
  /** kippu-api: operator sessions and grants (F-020, F-024). */
  readonly kippuApiUrl: string;
}

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
  };
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Iriguchi",
  slug: config.slug ?? "iriguchi",
  extra: { ...config.extra, endpoints: endpointsConfig(process.env) },
});
