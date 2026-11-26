import { describe, expect, it } from "vitest";

import { transitionPriceAlertSnapshot, type PriceAlertSnapshotEvent, type PriceAlertSnapshotState } from "@/lib/priceAlertSnapshotMachine";

const cases: Array<[PriceAlertSnapshotState["phase"], PriceAlertSnapshotEvent, PriceAlertSnapshotState["phase"]]> = [
  ["indexing", { type: "observed", last: false }, "indexing"],
  ["indexing", { type: "observed", last: true }, "dispatch"],
  ["dispatch", { type: "observed", last: false }, "dispatch"],
  ["dispatch", { type: "observed", last: true }, "dispatch"],
  ["complete", { type: "observed", last: false }, "complete"],
  ["complete", { type: "observed", last: true }, "complete"],
  ["indexing", { type: "advanced", complete: false }, "indexing"],
  ["indexing", { type: "advanced", complete: true }, "complete"],
  ["dispatch", { type: "advanced", complete: false }, "dispatch"],
  ["dispatch", { type: "advanced", complete: true }, "complete"],
  ["complete", { type: "advanced", complete: false }, "complete"],
  ["complete", { type: "advanced", complete: true }, "complete"],
];

describe("price alert snapshot transitions", () => {
  it.each(cases)("transitions %s on %j to %s", (phase, event, expected) => {
    expect(transitionPriceAlertSnapshot({ phase }, event).phase).toBe(expected);
  });
  it("indexes before dispatch and retains the current phase on incomplete work", () => {
    const indexing: PriceAlertSnapshotState = { phase: "indexing" };
    expect(transitionPriceAlertSnapshot(indexing, { type: "observed", last: false })).toBe(indexing);
    const dispatch = transitionPriceAlertSnapshot(indexing, { type: "observed", last: true });
    expect(dispatch).toEqual({ phase: "dispatch" });
    expect(transitionPriceAlertSnapshot(dispatch, { type: "advanced", complete: false })).toBe(dispatch);
    const complete = transitionPriceAlertSnapshot(dispatch, { type: "advanced", complete: true });
    expect(complete).toEqual({ phase: "complete" });
    expect(transitionPriceAlertSnapshot(complete, { type: "observed", last: true })).toBe(complete);
    expect(transitionPriceAlertSnapshot(complete, { type: "advanced", complete: false })).toBe(complete);
  });
});
