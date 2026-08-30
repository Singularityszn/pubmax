import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PASSWORD_PROMPT_DESTINATION } from "@/lib/passwordPrompt";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const promptSource = read("components/auth/CreatePasswordPrompt.tsx");
const shellSource = read("components/DeferredShellExtras.tsx");
const accountHubSource = read("components/profile/PubmaxxAccountHub.tsx");
const setPasswordSource = read("components/auth/SetAccountPassword.tsx");
const promptCardCss = read("components/native/nativePushPrompt.css");

describe("create-password prompt asks, and hands over", () => {
  it("sets no password of its own", () => {
    // The one place a password is set is SetAccountPassword, bound to the
    // caller's own GoTrue session. A second setter is the account-takeover
    // shape that law exists to prevent, so this surface holds no field at all.
    expect(promptSource).not.toContain("updateUser");
    expect(promptSource).not.toContain("<input");
    expect(promptSource).not.toContain('type="password"');
  });

  it("leaves SetAccountPassword as the only password setter", () => {
    expect(setPasswordSource).toContain("supabase.auth.updateUser({ password })");
  });

  it("sends people to a destination the account hub really answers", () => {
    expect(promptSource).toContain("PASSWORD_PROMPT_DESTINATION");
    const anchor = PASSWORD_PROMPT_DESTINATION.split("#")[1];
    expect(anchor).toBeTruthy();
    expect(accountHubSource).toContain(`id="${anchor}"`);
    // And the form is really mounted on that surface.
    expect(accountHubSource).toContain("<SetAccountPassword />");
  });
});

describe("create-password prompt gating", () => {
  it("reads the shared decision rather than inlining its own gate", () => {
    expect(promptSource).toContain("shouldOfferPasswordPrompt");
    expect(promptSource).toContain("identityResolved");
    expect(promptSource).toContain("hasPassword");
  });

  it("keeps the password answer tri-state on the wire", () => {
    // Anything that is not a boolean stays null, so a read that could not
    // answer can never be reported as "you have no password".
    expect(promptSource).toContain(
      'typeof body.hasPassword === "boolean" ? body.hasPassword : null',
    );
  });

  it("carries its bearer token to the actor-gated identity read", () => {
    expect(promptSource).toContain("authedActionFetch");
    expect(promptSource).toContain("/api/identity/handle/current");
  });

  it("lets go of a body it decided not to read", () => {
    expect(promptSource).toContain("discardBody");
  });

  it("spends the session prompt budget so it cannot stack on another ask", () => {
    expect(promptSource).toContain("hasPromptBudgetFor");
    expect(promptSource).toContain("claimPromptBudget");
    expect(promptSource).toContain("PASSWORD_PROMPT_SURFACE");
  });

  it("spends the ask on either answer", () => {
    // Both buttons end it. Asking again somebody who said yes and then walked
    // away is the nagging the one-shot discipline exists to stop.
    const spends = promptSource.match(/markPasswordPromptAnswered\(accountId\)/g);
    expect(spends?.length).toBe(2);
  });
});

describe("create-password prompt mount", () => {
  it("mounts exactly once, in the deferred prompt host", () => {
    const mounts = shellSource.match(/<CreatePasswordPrompt \/>/g);
    expect(mounts?.length).toBe(1);
    expect(shellSource).toContain(
      'import("@/components/auth/CreatePasswordPrompt")',
    );
    expect(shellSource).toContain("ssr: false");
  });

  it("keeps its link action on the audited 44px tap floor", () => {
    // The accept action is an anchor, and an anchor is inline by default, so
    // the button rules' min-height would not apply to it without this.
    expect(promptCardCss).toContain("a.nativePushPrompt__enable");
    expect(promptCardCss).toMatch(
      /a\.nativePushPrompt__later,\s*\n\s*a\.nativePushPrompt__enable \{[^}]*display: inline-flex;/,
    );
  });
});
