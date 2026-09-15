// Sending an admission report to kippu-api (F-024 §5.3, `operators.reportAdmission`).

import type { AdmissionReportInput } from "@kippu/api";
import { kippuClient } from "../kippu/client.ts";

export function reportAdmission(kippuApiUrl: string) {
  return (input: AdmissionReportInput, token: string) =>
    kippuClient({ url: kippuApiUrl, token: () => token }).operators.reportAdmission.mutate(input);
}
