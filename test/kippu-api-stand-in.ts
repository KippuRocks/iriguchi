// A stand-in for kippu-api's operator procedures, served the way tRPC serves them
// over HTTP (`/v0/trpc/<path>`, no batching, no transformer), for Iriguchi's
// tests and for the device smoke flow (PLAN.md §5.3: clients develop against
// recorded tRPC fixtures). Every response is typed by `@kippu/api`'s router, so a
// change to the contract fails to compile here. It is not kippu-api: it holds one
// enrolment code and a fixed set of grants, and enforces nothing else.

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AppRouter, OperatorGrant } from "@kippu/api";
import type { inferRouterOutputs } from "@trpc/server";

type Outputs = inferRouterOutputs<AppRouter>;

export interface StandInOptions {
  /** The one enrolment code the stand-in accepts, once. */
  readonly code: string;
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
  close(): Promise<void>;
}

class Refusal extends Error {
  readonly code: "UNAUTHORIZED" | "BAD_REQUEST" | "NOT_FOUND" | "FORBIDDEN";
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
  let codeRedeemed = false;
  const sessions = new Set<string>();
  let issued = 0;

  const authenticated = (request: IncomingMessage) => {
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    if (token === undefined || !sessions.has(token)) {
      throw new Refusal("UNAUTHORIZED", 401, "no live session");
    }
    return token;
  };

  const procedures: Record<string, (request: IncomingMessage, input: unknown) => unknown> = {
    "auth.operator.redeemEnrolmentCode": (_request, input) => {
      const code = (input as { code?: unknown } | undefined)?.code;
      if (typeof code !== "string" || code.length === 0) {
        throw new Refusal("BAD_REQUEST", 400, "expected a code");
      }
      if (code !== options.code || codeRedeemed) {
        throw new Refusal("UNAUTHORIZED", 401, "unknown, used or expired enrolment code");
      }
      codeRedeemed = true;
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
              },
        freshness: { cursor: "", records: 1, lastRecordedAt: null },
      };
      return output;
    },
    "auth.session.signOut": (request) => {
      sessions.delete(authenticated(request));
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
    revokeSessions: () => sessions.clear(),
    revokeGrant: (id) => {
      const grant = grants.find((g) => g.id === id);
      if (grant !== undefined) Object.assign(grant, { revokedAt: new Date(now()).toISOString() });
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
