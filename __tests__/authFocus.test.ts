import { describe, expect, it } from "vitest";

import { AUTH_MENU_FOCUSABLE_SELECTOR } from "@/components/auth/SignInButton";

describe("auth popover focus trap", () => {
  it("excludes controls disabled after a magic link is sent", () => {
    expect(AUTH_MENU_FOCUSABLE_SELECTOR).toContain("button:not(:disabled)");
    expect(AUTH_MENU_FOCUSABLE_SELECTOR).toContain("input:not(:disabled)");
  });
});
