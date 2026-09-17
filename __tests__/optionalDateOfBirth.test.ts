import { describe, expect, it } from "vitest";

import { readOptionalDateOfBirth } from "@/lib/privateIdentity";

// ONE RULE (captain, 5 Sep 2026). A date of birth is optional everywhere a
// person types one, so "nothing was typed" and "that is not a date" are two
// findings and only the second is a refusal. This is the one place that
// reading lives, shared by the claim path and by PATCH
// /api/identity/onboarding.
const NOW = Date.parse("2026-09-05T20:00:00.000Z");

describe("an optional date of birth", () => {
  it("reads an untyped field as absent, in every shape a browser sends", () => {
    for (const value of [undefined, null, "", "   "]) {
      expect(readOptionalDateOfBirth(value, NOW)).toEqual({ status: "absent" });
    }
  });

  it("reads a real date as given, trimmed to the stored shape", () => {
    expect(readOptionalDateOfBirth("1990-01-01", NOW)).toEqual({
      status: "given",
      dateOfBirth: "1990-01-01",
    });
    expect(readOptionalDateOfBirth(" 1990-01-01 ", NOW)).toEqual({
      status: "given",
      dateOfBirth: "1990-01-01",
    });
  });

  it("still refuses a value that is not a date", () => {
    for (const value of ["not-a-date", "1990-13-01", "1899-12-31", 19900101, {}]) {
      expect(readOptionalDateOfBirth(value, NOW)).toEqual({ status: "invalid" });
    }
  });

  it("still refuses a date in the future", () => {
    expect(readOptionalDateOfBirth("2026-09-06", NOW)).toEqual({
      status: "invalid",
    });
    expect(readOptionalDateOfBirth("2026-09-05", NOW)).toEqual({
      status: "given",
      dateOfBirth: "2026-09-05",
    });
  });
});
