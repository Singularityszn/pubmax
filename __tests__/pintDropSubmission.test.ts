import { describe, expect, it } from "vitest";
import {
  startPintDropSubmission,
  transitionPintDropSubmission,
  type PintDropSubmission,
} from "@/lib/pintDropSubmission";

const posting = startPintDropSubmission("req-1", 3);
const saved: PintDropSubmission = { phase: "saved", requestId: "req-1", dropId: "drop-1" };
const failed: PintDropSubmission = { phase: "failed", requestId: "req-1", message: "No.", canRetry: true };

describe("transitionPintDropSubmission", () => {
  it("saves or fails the posting request for the same account", () => {
    expect(transitionPintDropSubmission(posting, { type: "succeeded", requestId: "req-1", accountRevision: 3, dropId: "drop-1" }))
      .toEqual(saved);
    expect(transitionPintDropSubmission(posting, { type: "failed", requestId: "req-1", accountRevision: 3, message: "No.", canRetry: true }))
      .toEqual(failed);
  });

  it.each([
    ["another account revision", posting, { requestId: "req-1", accountRevision: 4 }],
    ["another request", posting, { requestId: "req-2", accountRevision: 3 }],
    ["a saved request", saved, { requestId: "req-1", accountRevision: 3 }],
    ["a failed request", failed, { requestId: "req-1", accountRevision: 3 }],
  ] as const)("returns the same state for a response to %s", (_label, state, scope) => {
    expect(transitionPintDropSubmission(state, { type: "succeeded", ...scope, dropId: "drop-2" })).toBe(state);
    expect(transitionPintDropSubmission(state, { type: "failed", ...scope, message: "Late.", canRetry: true })).toBe(state);
  });
});
