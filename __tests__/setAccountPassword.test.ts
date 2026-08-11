import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const setPasswordSource = readFileSync(
  join(process.cwd(), "components/auth/SetAccountPassword.tsx"),
  "utf8",
);

const loginPageSource = readFileSync(
  join(process.cwd(), "components/auth/LoginPage.tsx"),
  "utf8",
);

const handleSignInSource = readFileSync(
  join(process.cwd(), "components/auth/HandlePasswordSignIn.tsx"),
  "utf8",
);

describe("SetAccountPassword gating", () => {
  it("waits for the live identity answer before reading account password state", () => {
    expect(setPasswordSource).toContain("identityResolved");
    expect(setPasswordSource).toMatch(/if \(!user \|\| !identityResolved\)/);
    expect(setPasswordSource).toMatch(
      /!configured \|\| !user \|\| !identityResolved \|\| !handleLoaded/,
    );
  });

  it("requires a claimed handle before saving a password", () => {
    expect(setPasswordSource).toContain("Claim a handle before setting a password.");
    expect(setPasswordSource).toContain("/api/identity/handle/current");
  });

  it("enforces the shared policy, not a local rule of its own", () => {
    expect(setPasswordSource).toContain("@/lib/passwordPolicy");
    expect(setPasswordSource).toContain("checkPassword(password)");
  });

  it("hands the password to Supabase auth for the CURRENT session only", () => {
    // GoTrue binds `updateUser` to the caller's own JWT. A route of ours in
    // this path could set a password for a handle, which is takeover.
    expect(setPasswordSource).toContain("updateUser({ password })");
    expect(setPasswordSource).not.toMatch(/updateUserById|admin\.auth/);
  });
});

describe("creating a password is a signed-in act", () => {
  it("is offered nowhere on the sign-in page", () => {
    // Whatever the login page grows, it may never carry a way to SET a
    // password: the form is reachable with no session at all.
    for (const source of [loginPageSource, handleSignInSource]) {
      expect(source).not.toContain("SetAccountPassword");
      expect(source).not.toContain("updateUser");
      expect(source).not.toContain("new-password");
    }
  });

  it("mounts only inside the signed-in account surface", () => {
    const mounts = readFileSync(
      join(process.cwd(), "components/profile/PubmaxxAccountHub.tsx"),
      "utf8",
    );
    expect(mounts).toContain("<SetAccountPassword />");
  });
});

describe("the create / change heading is tri-state", () => {
  it("names a state only when the read answered", () => {
    expect(setPasswordSource).toContain('"Change password"');
    expect(setPasswordSource).toContain('"Create password"');
    // The neutral third case: a read that could not answer names neither.
    expect(setPasswordSource).toContain('hasPassword === true');
    expect(setPasswordSource).toContain('hasPassword === false');
    expect(setPasswordSource).toContain('"Password"');
  });

  it("only takes the prominent slot when an account is known to have none", () => {
    expect(setPasswordSource).toContain(
      'hasPassword === false ? " accountHubPasswordOwed" : ""',
    );
    const css = readFileSync(
      join(process.cwd(), "app/u/[handle]/profile.css"),
      "utf8",
    );
    expect(css).toMatch(/\.accountHubPasswordOwed\s*\{[^}]*grid-column: 1 \/ -1/);
  });

  it("is a section and never a dialog, per the arrival laws", () => {
    expect(setPasswordSource).not.toMatch(/role="dialog"|<dialog/);
  });
});

describe("the login page's way out", () => {
  it("points a stuck signer at the email link, without saying who exists", () => {
    expect(handleSignInSource).toContain(
      "No password yet? Sign in with your email link and create one from your profile.",
    );
    // Rendered for every failure. A conditional line would be an oracle.
    expect(handleSignInSource).toMatch(
      /\{error \? \(\s*<>[\s\S]*NO_PASSWORD_GUIDANCE/,
    );
  });

  it("does not fight autocapitalize on the handle field", () => {
    expect(handleSignInSource).toContain('autoCapitalize="none"');
  });
});
