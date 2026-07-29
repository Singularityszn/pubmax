import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AccountOnboardingForm,
  AccountOnboardingLoadError,
  canSubmitCheckedHandle,
} from "@/components/identity/AccountOnboarding";
import {
  checkAccountHandleAvailability,
  loadAccountOnboardingStatus,
} from "@/lib/accountOnboardingClient";

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
  it("requires only a public handle and keeps private details optional", () => {
    const html = render("idle");
    expect(html.indexOf("Public handle")).toBeLessThan(html.indexOf("Full name"));
    expect(html.indexOf("Full name")).toBeLessThan(html.indexOf("Sex"));
    expect(html).not.toContain("Date of birth");
    expect(html).toContain("Optional");
    expect(html).toContain("Skip optional details");
    expect(html).toContain("Only your handle is public");
    expect(html).toContain("product analytics and social features");
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

  it("enables handle claim without collecting a date of birth", () => {
    const html = render("available");
    expect(html).toContain(">Claim handle</button>");
    expect(html).not.toContain('disabled="">Claim handle');
    expect(html).not.toContain('type="date"');
  });

  it("uses different copy for a taken handle and a reserved handle", () => {
    expect(render("taken")).toContain("That handle is already taken.");
    expect(render("reserved")).toContain("That handle is not available.");
    expect(render("available")).toContain("Handle available.");
  });

  it("keeps failed availability checks distinct from taken handles", async () => {
    for (const status of [429, 503]) {
      const request = async () =>
        new Response(
          JSON.stringify({ error: "Handle availability is unavailable." }),
          { status },
        );
      await expect(
        checkAccountHandleAvailability("night_owl", request),
      ).resolves.toEqual({
        status: "unavailable",
        error: "Handle availability is unavailable.",
      });
    }
  });

  it("offers a retry when account status cannot be loaded", async () => {
    const request = async () =>
      new Response(
        JSON.stringify({ error: "Account details are unavailable right now." }),
        { status: 503 },
      );
    await expect(loadAccountOnboardingStatus(request)).resolves.toEqual({
      status: "unavailable",
      error: "Account details are unavailable right now.",
    });

    const html = renderToStaticMarkup(
      createElement(AccountOnboardingLoadError, {
        error: "Account details are unavailable right now.",
        onRetry: noop,
      }),
    );
    expect(html).toContain("Account details are unavailable right now.");
    expect(html).toContain("Try again");
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
