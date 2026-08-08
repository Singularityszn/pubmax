import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const setPasswordSource = readFileSync(
  join(process.cwd(), "components/auth/SetAccountPassword.tsx"),
  "utf8",
);

describe("SetAccountPassword gating", () => {
  it("requires a claimed handle before saving a password", () => {
    expect(setPasswordSource).toContain("Claim a handle before setting a password.");
    expect(setPasswordSource).toContain("/api/identity/handle/current");
  });

  it("enforces the minimum password length", () => {
    expect(setPasswordSource).toContain("MIN_HANDLE_PASSWORD_LENGTH");
    expect(setPasswordSource).toContain("updateUser({ password })");
  });
});
