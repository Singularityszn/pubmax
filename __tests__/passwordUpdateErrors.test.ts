import { describe, expect, it } from "vitest";

import {
  PASSWORD_CHANGE_GENERIC_ERROR,
  PASSWORD_POLICY_ERROR,
  PASSWORD_UNCHANGED_ERROR,
  passwordUpdateErrorMessage,
} from "@/lib/passwordPolicy";

// Changing a password gave "Could not change your password. Try again." for a
// wrong current password and for a new password equal to the old one. The
// reader is signed in, so each cause is named.
describe("passwordUpdateErrorMessage", () => {
  it("names a new password that matches the current one", () => {
    expect(passwordUpdateErrorMessage({ code: "same_password" })).toBe(PASSWORD_UNCHANGED_ERROR);
    expect(
      passwordUpdateErrorMessage({
        message: "New password should be different from the old password.",
      }),
    ).toBe(PASSWORD_UNCHANGED_ERROR);
  });

  it("repeats the policy line for a password GoTrue calls weak", () => {
    expect(passwordUpdateErrorMessage({ code: "weak_password" })).toBe(PASSWORD_POLICY_ERROR);
  });

  it("falls back to the generic line when the cause is unknown", () => {
    expect(passwordUpdateErrorMessage({})).toBe(PASSWORD_CHANGE_GENERIC_ERROR);
    expect(passwordUpdateErrorMessage({ code: "unexpected_failure", message: "boom" })).toBe(
      PASSWORD_CHANGE_GENERIC_ERROR,
    );
  });
});
