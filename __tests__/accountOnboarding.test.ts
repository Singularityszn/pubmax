import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AccountOnboardingForm,
  canSubmitCheckedHandle,
} from "@/components/identity/AccountOnboarding";

const noop = () => {};

function render(
  availability: "idle" | "checking" | "available" | "taken" | "reserved",
): string {
  return renderToStaticMarkup(
    createElement(AccountOnboardingForm, {
      handle: "night_owl",
      fullName: "",
      sex: "",
      availability,
      busy: false,
      error: null,
      onHandleChange: noop,
      onFullNameChange: noop,
      onSexChange: noop,
      onSubmit: noop,
      onSkipOptional: noop,
    }),
  );
}

describe("account onboarding surface", () => {
  it("puts required public handle before private optional details", () => {
    const html = render("idle");
    expect(html.indexOf("Public handle")).toBeLessThan(
      html.indexOf("Full name"),
    );
    expect(html.indexOf("Full name")).toBeLessThan(html.indexOf("Sex"));
    expect(html).toContain("Optional");
    expect(html).toContain("Skip optional details");
    expect(html).toContain("Only your handle is public");
  });

  it("keeps submit disabled until the exact handle was checked as available", () => {
    expect(canSubmitCheckedHandle("night_owl", "night_owl", "available")).toBe(
      true,
    );
    expect(canSubmitCheckedHandle("night_owl_2", "night_owl", "available")).toBe(
      false,
    );
    expect(canSubmitCheckedHandle("night_owl", "night_owl", "checking")).toBe(
      false,
    );
    expect(render("checking")).toContain("Checking");
    expect(render("checking")).toContain("disabled");
  });

  it("uses different copy for a taken handle and a reserved handle", () => {
    expect(render("taken")).toContain("That handle is already taken.");
    expect(render("reserved")).toContain("That handle is not available.");
    expect(render("available")).toContain("Handle available.");
  });

  it("ships a one-column phone sheet with full tap targets", () => {
    const css = readFileSync(
      join(process.cwd(), "components/identity/accountOnboarding.css"),
      "utf8",
    );
    expect(css).toMatch(/@media \(max-width: 520px\)/);
    expect(css).toMatch(
      /\.accountOnboardingOptional,\s*\.accountOnboardingActions\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(
      /\.accountOnboardingActions button\s*\{[^}]*min-height: 46px/,
    );
    expect(css).toMatch(/max-height: calc\(100dvh/);
    expect(css).toMatch(/overflow-y: auto/);
  });
});
