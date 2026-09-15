// What Iriguchi keeps on the device about the operator (T-050-02): the Kippu
// session an enrolment code was redeemed for (F-020 §5.1). The token is a bearer
// credential, so it lives in the platform's secure storage — the Keychain on iOS,
// the Keystore-backed store on Android — never in plain app storage. Iriguchi
// holds no holder key, and nothing here can sign on the ledger (REQ-CL-2).

export interface OperatorSessionRecord {
  readonly token: string;
  /** Milliseconds since the epoch. */
  readonly expiresAt: number;
  readonly operatorId: string;
}

export interface OperatorSessionStore {
  load(): Promise<OperatorSessionRecord | null>;
  save(record: OperatorSessionRecord): Promise<void>;
  clear(): Promise<void>;
}

/** Key-value access to the platform's secure storage; expo-secure-store in the app. */
export interface SecureStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const KEY = "iriguchi.operator-session.v1";

export function secureSessionStore(storage: SecureStorage): OperatorSessionStore {
  return {
    async load() {
      const raw = await storage.getItemAsync(KEY);
      return raw === null ? null : parseRecord(raw);
    },
    async save(record) {
      await storage.setItemAsync(KEY, JSON.stringify(record));
    },
    async clear() {
      await storage.deleteItemAsync(KEY);
    },
  };
}

/** A store in memory, for tests. */
export function memorySessionStore(
  initial: OperatorSessionRecord | null = null,
): OperatorSessionStore {
  let record = initial;
  return {
    load: async () => record,
    save: async (next) => {
      record = next;
    },
    clear: async () => {
      record = null;
    },
  };
}

/** A stored record that is not a session is forgotten, so the operator signs in again. */
function parseRecord(raw: string): OperatorSessionRecord | null {
  try {
    const r = JSON.parse(raw) as Partial<OperatorSessionRecord> | null;
    if (
      r !== null &&
      typeof r === "object" &&
      typeof r.token === "string" &&
      r.token.length > 0 &&
      typeof r.expiresAt === "number" &&
      typeof r.operatorId === "string"
    ) {
      return { token: r.token, expiresAt: r.expiresAt, operatorId: r.operatorId };
    }
  } catch {
    // Not JSON: treated as no session.
  }
  return null;
}
