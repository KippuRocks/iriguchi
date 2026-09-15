import { TICKETTO_ERROR_ORIGINS } from "@ticketto/sdk";
import { describe, expect, it } from "vitest";
import { matches } from "../../tools/copy-lint/vocabulary.ts";
import {
  ANOTHER_EVENT_COPY,
  GATE_ERROR_COPY,
  GATE_ERRORS,
  OPERATOR_COPY,
  refusalCopy,
} from "./refusals.ts";

const everyCopy = [
  ...Object.values(GATE_ERROR_COPY),
  ANOTHER_EVENT_COPY,
  ...Object.values(OPERATOR_COPY),
];

describe("T-050-05 refusal reasons", () => {
  it("REQ-Q-3: each gate error shows a distinct reason, with an action", () => {
    const titles = everyCopy.map((copy) => copy.title);
    const actions = everyCopy.map((copy) => copy.action);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(actions).size).toBe(actions.length);
    for (const copy of everyCopy) {
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.action).toMatch(/\.$/);
      // Operator words, never a code.
      expect(`${copy.title} ${copy.action}`).not.toMatch(/ERR-/);
    }
  });

  it("REQ-Q-3: covers every §10 error a pass's checks and canAttend can raise", () => {
    for (const code of GATE_ERRORS) {
      expect(refusalCopy({ source: "ledger", code })).toBe(GATE_ERROR_COPY[code]);
      expect(TICKETTO_ERROR_ORIGINS[code]).toBeDefined();
    }
  });

  it("names spent, expired, cancelled event, not the holder, and not authorised (plan §5.1)", () => {
    const title = (code: (typeof GATE_ERRORS)[number]) => GATE_ERROR_COPY[code].title;
    expect(title("ERR-CannotAttend")).toMatch(/used/);
    expect(title("ERR-TicketExpired")).toMatch(/expired/);
    expect(title("ERR-EventCancelled")).toMatch(/cancelled/);
    expect(title("ERR-InvalidPass")).toMatch(/holder/);
    expect(OPERATOR_COPY["not-granted"].title).toMatch(/Not authorised/);
  });

  it("tells a ticket of another event apart from one that does not exist", () => {
    expect(
      refusalCopy({
        source: "ledger",
        code: "ERR-TicketNotFound",
        ticketEvent: "e".repeat(64) as never,
      }),
    ).toBe(ANOTHER_EVENT_COPY);
    expect(refusalCopy({ source: "ledger", code: "ERR-TicketNotFound" })).toBe(
      GATE_ERROR_COPY["ERR-TicketNotFound"],
    );
  });

  it("every operator refusal from operators.check has its own words", () => {
    for (const reason of [
      "grant-revoked",
      "before-window",
      "after-window",
      "not-granted",
      "signed-out",
    ] as const) {
      expect(refusalCopy({ source: "operator", reason })).toBe(OPERATOR_COPY[reason]);
    }
  });

  it("an unexpected code still refuses, and names it", () => {
    expect(refusalCopy({ source: "ledger", code: "ERR-NotOwner" }).action).toMatch(/ERR-NotOwner/);
  });

  it("REQ-SP-1a, REQ-TM-2: no reason uses fee vocabulary or trust claims", () => {
    for (const copy of everyCopy) expect(matches(`${copy.title} ${copy.action}`)).toEqual([]);
  });
});
