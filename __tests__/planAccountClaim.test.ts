import { describe, expect, it } from "vitest";

import {
  INITIAL_PLAN_ACCOUNT_CLAIM,
  planAccountClaimOutcome,
  transitionPlanAccountClaim,
  type PlanAccountClaimEvent,
  type PlanAccountClaimState,
} from "@/lib/planAccountClaim";

type Sending = Extract<PlanAccountClaimState, { phase: "sending" }>;
type Waiting = Extract<PlanAccountClaimState, { phase: "waiting" }>;
const sending = (attempt: Sending["attempt"], lifetime = 0): PlanAccountClaimState => ({ phase: "sending", lifetime, attempt });
const waiting = (attempt: Waiting["attempt"], lifetime = 0): PlanAccountClaimState =>
  ({ phase: "waiting", lifetime, attempt });
const exhausted = (lifetime = 0): PlanAccountClaimState => ({ phase: "exhausted", lifetime });
const claimed: PlanAccountClaimState = { phase: "claimed" };
const refused: PlanAccountClaimState = { phase: "refused" };
const stopped: PlanAccountClaimState = { phase: "stopped" };

const answered = (outcome: "claimed" | "refused" | "transient", attempt: Sending["attempt"] = 0, lifetime = 0): PlanAccountClaimEvent =>
  ({ type: "answered", lifetime, attempt, outcome });
const waited = (attempt: Waiting["attempt"], lifetime = 0): PlanAccountClaimEvent => ({ type: "waited", lifetime, attempt });
const interrupted = (sameAccount: boolean, lifetime = 0): PlanAccountClaimEvent =>
  ({ type: "interrupted", lifetime, sameAccount });
const resumed: PlanAccountClaimEvent = { type: "resumed" };
const disposed: PlanAccountClaimEvent = { type: "disposed" };

describe("the Plan account claim lifecycle", () => {
  it("starts by sending the first attempt in the first lifetime", () => {
    expect(INITIAL_PLAN_ACCOUNT_CLAIM).toEqual(sending(0));
  });

  it.each([
    ["a claim ends claimed", sending(0), answered("claimed"), claimed],
    ["a definite refusal ends refused", sending(2), answered("refused", 2), refused],
    ["a first transient answer schedules the first retry", sending(0), answered("transient"), waiting(1)],
    ["a second transient answer schedules the final retry", sending(1), answered("transient", 1), waiting(2)],
    ["a third transient answer waits for the app", sending(2), answered("transient", 2), exhausted()],
    ["a finished wait sends its attempt", waiting(1), waited(1), sending(1)],
    ["a same-account interruption while sending starts again", sending(2), interrupted(true), sending(0, 1)],
    ["a same-account interruption while waiting starts again", waiting(1), interrupted(true), sending(0, 1)],
    ["a same-account interruption after exhaustion keeps waiting", exhausted(), interrupted(true), exhausted(1)],
    ["a departed account stops a send", sending(0), interrupted(false), stopped],
    ["a departed account stops a wait", waiting(2), interrupted(false), stopped],
    ["a departed account stops an exhausted claim", exhausted(3), interrupted(false, 3), stopped],
    ["the app's return starts a fresh lifetime after exhaustion", exhausted(2), resumed, sending(0, 3)],
    ["disposal stops a send", sending(1), disposed, stopped],
    ["disposal stops a wait", waiting(1), disposed, stopped],
    ["disposal stops an exhausted claim", exhausted(), disposed, stopped],
  ])("%s", (_name, state, event, next) => {
    expect(transitionPlanAccountClaim(state, event)).toEqual(next);
  });

  it.each([
    ["an answer from an old lifetime", sending(0, 1), answered("claimed", 0, 0)],
    ["an answer for another attempt", sending(1), answered("claimed", 0)],
    ["an answer while waiting", waiting(1), answered("claimed", 1)],
    ["an answer after exhaustion", exhausted(), answered("claimed", 2)],
    ["an answer after disposal", stopped, answered("claimed")],
    ["a second answer after a claim", claimed, answered("claimed")],
    ["a wait from an old lifetime", waiting(1, 1), waited(1, 0)],
    ["a wait for another attempt", waiting(2), waited(1)],
    ["a wait while sending", sending(1), waited(1)],
    ["an interruption of an old lifetime", sending(0, 2), interrupted(true, 1)],
    ["an interruption after a claim", claimed, interrupted(true)],
    ["an interruption after a refusal", refused, interrupted(true)],
    ["an interruption after disposal", stopped, interrupted(true)],
    ["a return while sending", sending(0), resumed],
    ["a return while waiting", waiting(1), resumed],
    ["a return after a claim", claimed, resumed],
    ["a return after a refusal", refused, resumed],
    ["a return after the account departed", stopped, resumed],
    ["disposal after a claim", claimed, disposed],
    ["disposal after a refusal", refused, disposed],
  ])("refuses %s and keeps the same state", (_name, state, event) => {
    expect(transitionPlanAccountClaim(state, event)).toBe(state);
  });

  it.each([
    [{ ok: true, status: 200 }, "claimed"],
    [{ ok: true, status: 204 }, "claimed"],
    [{ ok: false, status: 401 }, "refused"],
    [{ ok: false, status: 403 }, "refused"],
    [{ ok: false, status: 404 }, "refused"],
    [{ ok: false, status: 500 }, "refused"],
    [{ ok: false, status: 429 }, "transient"],
    [{ ok: false, status: 503 }, "transient"],
    [null, "transient"],
  ] as const)("reads %j as %s", (response, outcome) => {
    expect(planAccountClaimOutcome(response)).toBe(outcome);
  });
});
