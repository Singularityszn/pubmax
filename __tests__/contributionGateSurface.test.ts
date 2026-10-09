import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ContributionGateDialog,
  type ContributionGateDialogMode,
} from "@/components/identity/ContributionGateDialog";
import { ADULT_SELF_ASSERTION_ACTION } from "@/lib/socialLaunch";

function render(mode: ContributionGateDialogMode): string {
  return renderToStaticMarkup(
    createElement(ContributionGateDialog, {
      mode,
      error: null,
      onClose: () => {},
    }),
  );
}

describe("contribution identity gate", () => {
  it("offers sign-in when no account is available", () => {
    expect(render("sign_in_required")).toContain("Sign in to contribute");
  });

  it("routes a handle-less account back to handle setup", () => {
    const html = render("onboarding_required");
    expect(html).toContain("Choose your handle");
    expect(html).toContain("Choose a handle");
    expect(html).toContain('href="/u/you"');
    expect(html).toContain(
      "Pick a handle before you log a price.",
    );
  });

  it("asks the age question as the one tap, never as a birth date", () => {
    // ONE RULE (captain, 5 Sep 2026): the recorded tap IS the age answer, so
    // this door records it where the drinker asked to log a price.
    const html = render("adult_check_required");
    expect(html).toContain("Confirm your age");
    // The markup escapes the apostrophe, so the fence reads the words either
    // side of it rather than a second copy of the label.
    expect(ADULT_SELF_ASSERTION_ACTION).toBe("I'm 18 or over");
    expect(html).toContain("18 or over");
    expect(html).not.toContain('href="/u/you"');
  });

  it("collects no birth date in any mode", () => {
    const html = (
      [
        "sign_in_required",
        "onboarding_required",
        "adult_check_required",
      ] as const
    )
      .map(render)
      .join("");
    expect(html).not.toContain('type="date"');
    expect(html).not.toMatch(/date of birth/i);
  });

  it("keeps the age question out of the other two doors", () => {
    const html = `${render("sign_in_required")}${render("onboarding_required")}`;
    expect(html).not.toMatch(/18 or over|under 18|age confirmation/i);
  });
});
