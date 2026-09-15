// Pending admission reports, kept on the device until kippu-api acknowledges them
// (T-050-11; REQ-OP-3, NFR-2; features/050-iriguchi/plan.md §5.6).
//
// An admission is written here as soon as it is made, before its submission is
// sent, and again once the submission has ended; it is removed only when its report
// has been recorded, refused for good, or given up on. So an app killed at any
// moment loses no REQ-OP-3 evidence: on the next start, every entry left is
// reported (admissions.ts, `resume`).
//
// The entries live in app storage (AsyncStorage). The session token each report is
// sent with is a bearer credential, so it lives in the platform's secure storage,
// one item per report, never in app storage. Nothing here is personal data: event,
// gate, ticket, pass id and holder account are ledger identifiers.

import type { AdmissionSubmission } from "@kippu/api";

/** A report waiting for kippu-api's acknowledgement. */
export interface PendingReport {
  readonly reportId: string;
  readonly event: string;
  readonly gate: string;
  readonly ticket: string;
  readonly passId: string;
  /** The holder account the decoded pass names, hex. */
  readonly holder: string;
  /** The presentation time, exactly as submitted. */
  readonly presentedAt: number;
  /** The device's clock when the admission was made: the report's deadline counts from it. */
  readonly admittedAt: number;
  /** How the submission ended; absent while it was still in flight. */
  readonly submission?: AdmissionSubmission;
  /** The session token the admission was made under. */
  readonly token: string;
}

export interface ReportStore {
  list(): Promise<readonly PendingReport[]>;
  /** Adds a report, or replaces the one with its report id. */
  put(report: PendingReport): Promise<void>;
  remove(reportId: string): Promise<void>;
}

/** Key-value access to app storage; AsyncStorage in the app. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Key-value access to the platform's secure storage; expo-secure-store in the app. */
export interface SecureStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const ENTRIES_KEY = "iriguchi.pending-reports.v1";
const tokenKey = (reportId: string) => `iriguchi.report-token.${reportId}`;

type StoredEntry = Omit<PendingReport, "token">;

const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isEntry(value: unknown): value is StoredEntry {
  const e = value as Partial<StoredEntry> | null;
  return (
    e !== null &&
    typeof e === "object" &&
    typeof e.reportId === "string" &&
    REPORT_ID.test(e.reportId) &&
    typeof e.event === "string" &&
    typeof e.gate === "string" &&
    typeof e.ticket === "string" &&
    typeof e.passId === "string" &&
    typeof e.holder === "string" &&
    typeof e.presentedAt === "number" &&
    typeof e.admittedAt === "number"
  );
}

/** The store over app storage and secure storage. Writes are serialised, so none is lost. */
export function persistentReportStore(kv: KeyValueStorage, secure: SecureStorage): ReportStore {
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => {});
    return next;
  };

  const readEntries = async (): Promise<StoredEntry[]> => {
    const raw = await kv.getItem(ENTRIES_KEY);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
    } catch {
      return [];
    }
  };
  const writeEntries = (entries: readonly StoredEntry[]) =>
    kv.setItem(ENTRIES_KEY, JSON.stringify(entries));

  return {
    list: () =>
      serial(async () => {
        const entries = await readEntries();
        const reports: PendingReport[] = [];
        for (const entry of entries) {
          const token = await secure.getItemAsync(tokenKey(entry.reportId));
          // Without its token a report cannot be sent; it is left for `remove`.
          if (token !== null) reports.push({ ...entry, token });
        }
        return reports;
      }),
    put: (report) =>
      serial(async () => {
        const { token, ...entry } = report;
        // The token first: an entry never exists without the token to send it.
        await secure.setItemAsync(tokenKey(report.reportId), token);
        const entries = (await readEntries()).filter((e) => e.reportId !== report.reportId);
        await writeEntries([...entries, entry]);
      }),
    remove: (reportId) =>
      serial(async () => {
        const entries = await readEntries();
        await writeEntries(entries.filter((e) => e.reportId !== reportId));
        await secure.deleteItemAsync(tokenKey(reportId));
      }),
  };
}

/** A store in memory: reports survive only as long as the process. */
export function memoryReportStore(): ReportStore {
  const reports = new Map<string, PendingReport>();
  return {
    list: async () => [...reports.values()],
    put: async (report) => {
      reports.set(report.reportId, report);
    },
    remove: async (reportId) => {
      reports.delete(reportId);
    },
  };
}
