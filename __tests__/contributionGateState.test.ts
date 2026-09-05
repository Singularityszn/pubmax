import { describe, expect, it } from "vitest";

import {
  contributionGateError,
  contributionGateReducer,
  type ContributionGateState,
} from "@/components/identity/ContributionGateDialog";
import {
  CONTRIBUTION_ADULT_REFUSAL,
  CONTRIBUTION_HANDLE_REFUSAL,
} from "@/lib/contributionGateStatus";

describe("contribution gate account state", () => {
  it("clears mode and errors whenever account owner changes", () => {
    const stale: ContributionGateState = {
      userId: "user-a",
      mode: "sign_in_required",
      error: "Your sign-in expired.",
    };

    expect(
      contributionGateReducer(stale, {
        type: "account_changed",
        userId: "user-b",
      }),
    ).toEqual({
      userId: "user-b",
      mode: null,
      error: null,
    });
  });

  it("ignores a response from the previous account", () => {
    const current: ContributionGateState = {
      userId: "user-b",
      mode: null,
      error: null,
    };

    expect(
      contributionGateReducer(current, {
        type: "show",
        userId: "user-a",
        mode: "onboarding_required",
        error: "Old account error.",
      }),
    ).toBe(current);
  });

  it("prints no alarm line under a door that only asks a question", () => {
    // The age door already says what it wants in its own heading, so the
    // server's refusal sentence beside it would read as a fault.
    expect(
      contributionGateError(
        { status: "adult_check_required", error: CONTRIBUTION_ADULT_REFUSAL },
        true,
      ),
    ).toBeNull();
  });

  it("prints a sentence the gate did not write", () => {
    // A door that asks drops its OWN refusal; anything else is news.
    expect(
      contributionGateError(
        { status: "onboarding_required", error: CONTRIBUTION_HANDLE_REFUSAL },
        true,
      ),
    ).toBeNull();
    expect(
      contributionGateError(
        { status: "onboarding_required", error: "That handle is taken." },
        true,
      ),
    ).toBe("That handle is taken.");
  });

  it("tells a signed-in reader what an expired sign-in needs", () => {
    expect(
      contributionGateError({ status: "sign_in_required" }, true),
    ).toBe("Your sign-in expired. Sign out, then sign in again.");
    expect(
      contributionGateError({ status: "sign_in_required" }, false),
    ).toBe("That action could not be completed.");
  });
});
