// A stand-in for kippu-api's operator procedures, served the way tRPC serves them
// over HTTP (`/v0/trpc/<path>`, no batching, no transformer), for Iriguchi's
// tests and for the device smoke flow (PLAN.md §5.3: clients develop against
// recorded tRPC fixtures). Every response is typed by `@kippu/api`'s router, so a
// change to the contract fails to compile here. It is not kippu-api: it holds one
// enrolment code and a fixed set of grants, and enforces nothing else.

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AdmissionReport, AppRouter, OperatorGrant } from "@kippu/api";
import type { inferRouterOutputs } from "@trpc/server";

type Outputs = inferRouterOutputs<AppRouter>;

export interface StandInOptions {
  /** The enrolment codes the stand-in accepts, each once: one per device. */
  readonly code: string | readonly string[];
  readonly operatorId: string;
  readonly grants: readonly OperatorGrant[];
  /** Event names, by event id, as their public metadata documents carry them. */
  readonly eventNames?: Readonly<Record<string, string>>;
  readonly port?: number;
  readonly host?: string;
  /** Session lifetime in milliseconds; 24 h, as kippu-api's operator sessions. */
  readonly sessionLifetime?: number;
  /** Kippu's clock. Defaults to the system clock. */
  readonly now?: () => number;
}

export interface StandIn {
  readonly url: string;
  /** Ends every session, as an organiser revoking the operator's sessions does. */
  revokeSessions(): void;
  /** Revokes a grant: the next check under it is refused. */
  revokeGrant(id: string): void;
  /** The admission reports recorded, in the order first received. */
  readonly reports: readonly AdmissionReport[];
  /** Makes the next `count` report requests fail as if kippu-api did not answer. */
  dropReports(count: number): void;
  close(): Promise<void>;
}

class Refusal extends Error {
  readonly code:
    | "UNAUTHORIZED"
    | "BAD_REQUEST"
    | "NOT_FOUND"
    | "FORBIDDEN"
    | "INTERNAL_SERVER_ERROR";
  readonly httpStatus: number;
  readonly reason: string | null;

  constructor(
    code: Refusal["code"],
    httpStatus: number,
    message: string,
    reason: string | null = null,
  ) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.reason = reason;
  }
}

const JSON_RPC_CODES = {
  BAD_REQUEST: -32600,
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
  NOT_FOUND: -32004,
  INTERNAL_SERVER_ERROR: -32603,
} as const;

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length === 0 ? undefined : JSON.parse(text);
}

export async function startKippuStandIn(options: StandInOptions): Promise<StandIn> {
  const lifetime = options.sessionLifetime ?? 24 * 60 * 60 * 1000;
  const now = options.now ?? (() => Date.now());
  const grants = options.grants.map((grant) => ({ ...grant }));
  const unredeemed = new Set(typeof options.code === "string" ? [options.code] : options.code);
  const sessions = new Set<string>();
  /** Revoked or signed-out sessions, with when they ended. */
  const ended = new Map<string, number>();
  const reports: AdmissionReport[] = [];
  let dropping = 0;
  let issued = 0;

  const tokenOf = (request: IncomingMessage) =>
    request.headers.authorization?.replace(/^Bearer /, "");

  const authenticated = (request: IncomingMessage) => {
    const token = tokenOf(request);
    if (token === undefined || !sessions.has(token)) {
      throw new Refusal("UNAUTHORIZED", 401, "no live session");
    }
    return token;
  };

  const endSession = (token: string) => {
    if (sessions.delete(token)) ended.set(token, now());
  };

  const procedures: Record<string, (request: IncomingMessage, input: unknown) => unknown> = {
    "auth.operator.redeemEnrolmentCode": (_request, input) => {
      const code = (input as { code?: unknown } | undefined)?.code;
      if (typeof code !== "string" || code.length === 0) {
        throw new Refusal("BAD_REQUEST", 400, "expected a code");
      }
      if (!unredeemed.delete(code)) {
        throw new Refusal("UNAUTHORIZED", 401, "unknown, used or expired enrolment code");
      }
      const token = `stand-in-session-${++issued}`;
      sessions.add(token);
      const output: Outputs["auth"]["operator"]["redeemEnrolmentCode"] = {
        session: { token, expiresAt: new Date(Date.now() + lifetime).toISOString() },
        operator: { id: options.operatorId, organiserId: "stand-in-organiser" },
      };
      return output;
    },
    "operators.grants.mine": (request) => {
      authenticated(request);
      const at = now();
      const output: Outputs["operators"]["grants"]["mine"] = grants
        .filter((grant) => grant.revokedAt === null && grant.until > at)
        .sort((a, b) => a.from - b.from);
      return output;
    },
    // As kippu-api#81: a session revoked or signed out still reports, for 24 hours,
    // the passes presented before it ended; a revoked grant likewise.
    "operators.reportAdmission": (request, input) => {
      if (dropping > 0) {
        dropping--;
        throw new Refusal("INTERNAL_SERVER_ERROR", 500, "dropped");
      }
      const report = input as Omit<AdmissionReport, "operator" | "receivedAt">;
      const token = tokenOf(request);
      const endedAt = token === undefined ? undefined : ended.get(token);
      const live = token !== undefined && sessions.has(token);
      const late =
        endedAt !== undefined &&
        report.presentedAt < endedAt &&
        now() < endedAt + 24 * 60 * 60 * 1000;
      if (!live && !late) throw new Refusal("UNAUTHORIZED", 401, "no session");
      const existing = reports.find((r) => r.reportId === report.reportId);
      if (existing !== undefined) return existing;
      const granted = grants.filter(
        (grant) => grant.event === report.event && grant.gates.includes(report.gate),
      );
      if (granted.length === 0) {
        throw new Refusal("FORBIDDEN", 403, "never granted", "not-granted");
      }
      const recorded: Outputs["operators"]["reportAdmission"] = {
        ...report,
        operator: options.operatorId,
        receivedAt: now(),
      };
      reports.push(recorded);
      return recorded;
    },
    "operators.check": (request, input) => {
      authenticated(request);
      const { event, gate } = (input ?? {}) as { event?: unknown; gate?: unknown };
      if (typeof event !== "string" || typeof gate !== "string") {
        throw new Refusal("BAD_REQUEST", 400, "expected an event and a gate");
      }
      const at = now();
      const forGate = grants.filter((grant) => grant.event === event && grant.gates.includes(gate));
      const active = forGate.find((grant) => grant.from <= at && at < grant.until);
      if (active !== undefined && active.revokedAt === null) {
        const output: Outputs["operators"]["check"] = {
          event,
          gate,
          grant: active.id,
          until: active.until,
          checkedAt: at,
        };
        return output;
      }
      const reason =
        active !== undefined
          ? "grant-revoked"
          : forGate.length === 0
            ? "not-granted"
            : forGate.some((grant) => grant.from > at)
              ? "before-window"
              : "after-window";
      throw new Refusal("FORBIDDEN", 403, "not authorised at this gate now", reason);
    },
    "derived.events.get": (_request, input) => {
      const event = (input as { event?: unknown } | undefined)?.event;
      if (typeof event !== "string") throw new Refusal("BAD_REQUEST", 400, "expected an event");
      const name = options.eventNames?.[event];
      const output: Outputs["derived"]["events"]["get"] = {
        event:
          name === undefined
            ? null
            : {
                authoritative: false,
                sequence: 1,
                id: event,
                owner: "00".repeat(32),
                status: "Active",
                maxCapacity: null,
                issued: 0,
                zones: [],
                metadataLocator: null,
                metadata: { name },
                passWindow: { windowMs: 60_000, isDefault: true },
              },
        freshness: { cursor: "", records: 1, lastRecordedAt: null },
      };
      return output;
    },
    "auth.session.signOut": (request) => {
      endSession(authenticated(request));
      const output: Outputs["auth"]["session"]["signOut"] = { signedOut: true };
      return output;
    },
  };

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://stand-in");
    const path = url.pathname.replace(/^\/v0\/trpc\//, "");
    const respond = (status: number, payload: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    (async () => {
      const procedure = procedures[path];
      if (procedure === undefined) throw new Refusal("NOT_FOUND", 404, `no procedure ${path}`);
      const raw = url.searchParams.get("input");
      const input =
        request.method === "GET"
          ? raw === null
            ? undefined
            : JSON.parse(raw)
          : await body(request);
      respond(200, { result: { data: procedure(request, input) } });
    })().catch((error: unknown) => {
      const refusal =
        error instanceof Refusal ? error : new Refusal("BAD_REQUEST", 400, String(error));
      respond(refusal.httpStatus, {
        error: {
          message: refusal.message,
          code: JSON_RPC_CODES[refusal.code],
          data: {
            code: refusal.code,
            httpStatus: refusal.httpStatus,
            path,
            errorCode: null,
            reason: refusal.reason,
          },
        },
      });
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve),
  );
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${options.host ?? "127.0.0.1"}:${port}`,
    revokeSessions: () => {
      for (const token of [...sessions]) endSession(token);
    },
    reports,
    dropReports: (count) => {
      dropping = count;
    },
    revokeGrant: (id) => {
      const grant = grants.find((g) => g.id === id);
      if (grant !== undefined) Object.assign(grant, { revokedAt: new Date(now()).toISOString() });
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
