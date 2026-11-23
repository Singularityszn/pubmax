import { describe, expect, it } from "vitest";

import {
  HANDLE_PASSWORD_GENERIC_ERROR,
  MIN_PASSWORD_LENGTH,
  PASSWORD_HINT,
  PASSWORD_POLICY_ERROR,
  PASSWORD_RULES,
  checkPassword,
  meetsPasswordPolicy,
  passwordRuleResults,
} from "@/lib/passwordPolicy";

const GOOD = "Pubmaxx1!";

describe("password policy rules", () => {
  it("accepts a password that clears every rule", () => {
    expect(checkPassword(GOOD)).toEqual({ ok: true });
    expect(meetsPasswordPolicy(GOOD)).toBe(true);
  });

  it("refuses a password under the minimum length", () => {
    const short = "Ab1!";
    expect(short.length).toBeLessThan(MIN_PASSWORD_LENGTH);
    const result = checkPassword(short);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failed).toContain("length");
  });

  it("refuses a password with no capital letter", () => {
    const result = checkPassword("pubmaxx1!");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failed).toEqual(["capital"]);
  });

  it("refuses a password with no number", () => {
    const result = checkPassword("Pubmaxxx!");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failed).toEqual(["number"]);
  });

  it("refuses a password with no special character", () => {
    const result = checkPassword("Pubmaxx12");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failed).toEqual(["special"]);
  });

  it("names every failed rule at once", () => {
    const result = checkPassword("abc");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failed).toEqual(["length", "capital", "number", "special"]);
    }
  });

  it("treats a non-string as a password that clears nothing", () => {
    for (const value of [null, undefined, 42, {}]) {
      const result = checkPassword(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failed).toHaveLength(PASSWORD_RULES.length);
    }
  });

  it("counts a non-ASCII capital and digit, because the rule says capital and number", () => {
    expect(meetsPasswordPolicy("Ünicode1!")).toBe(true);
    expect(checkPassword("ünicode1!").ok).toBe(false);
  });

  it("counts any non-letter, non-number as the special character", () => {
    for (const symbol of ["!", "@", "#", "-", "_", " ", "£", "~"]) {
      expect(meetsPasswordPolicy(`Pubmaxx1${symbol}`)).toBe(true);
    }
  });
});

describe("the live ticks", () => {
  it("reports one result per rule, in the hint's order", () => {
    const results = passwordRuleResults("");
    expect(results.map((rule) => rule.id)).toEqual([
      "length",
      "capital",
      "number",
      "special",
    ]);
    expect(results.every((rule) => rule.met)).toBe(false);
  });

  it("turns each rule on as it is met", () => {
    const met = (value: string) =>
      passwordRuleResults(value)
        .filter((rule) => rule.met)
        .map((rule) => rule.id);
    expect(met("")).toEqual([]);
    expect(met("pubmaxxx")).toEqual(["length"]);
    expect(met("Pubmaxxx")).toEqual(["length", "capital"]);
    expect(met("Pubmaxx1")).toEqual(["length", "capital", "number"]);
    expect(met(GOOD)).toEqual(["length", "capital", "number", "special"]);
  });

  it("labels each rule so a tick reads on its own", () => {
    expect(passwordRuleResults("").map((rule) => rule.label)).toEqual([
      "8 characters or more",
      "One capital letter",
      "One number",
      "One special character",
    ]);
  });
});

describe("the copy", () => {
  it("says the same rules in the hint and in the refusal", () => {
    for (const line of [PASSWORD_HINT, PASSWORD_POLICY_ERROR]) {
      expect(line).toContain("8 characters");
      expect(line).toContain("capital letter");
      expect(line).toContain("number");
      expect(line).toContain("special character");
      expect(line.endsWith(".")).toBe(true);
      expect(line).not.toContain("!");
      expect(line).not.toContain("—");
    }
  });

  it("keeps the sign-in refusal opaque about which half was wrong", () => {
    expect(HANDLE_PASSWORD_GENERIC_ERROR).toBe("Handle or password is wrong.");
  });
});
