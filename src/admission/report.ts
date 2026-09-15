// Sending an admission report to kippu-api (F-024 §5.3, `operators.reportAdmission`).

import type { AdmissionReport, AdmissionReportInput } from "@kippurocks/api";
import { kippuClient } from "../kippu/client.ts";

export function reportAdmission(kippuApiUrl: string) {
  return (input: AdmissionReportInput, token: string): Promise<AdmissionReport> =>
    kippuClient({ url: kippuApiUrl, token: () => token }).operators.reportAdmission.mutate(input);
}
