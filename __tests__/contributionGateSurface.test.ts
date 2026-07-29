import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ContributionGateDialog,
  type ContributionGateDialogMode,
} from "@/components/identity/ContributionGateDialog";

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

  it("routes incomplete accounts back to handle setup", () => {
    const html = render("onboarding_required");
    expect(html).toContain("Finish account setup");
    expect(html).toContain("public handle");
    expect(html).not.toContain("date of birth");
  });

  it("asks for date of birth only at first contribution", () => {
    const html = render("age_assessment_required");
    expect(html).toContain("Confirm you’re 18 or over");
    expect(html).toContain('type="date"');
    expect(html).toContain("discard");
  });

  it("explains under-18 blocking plainly", () => {
    const html = render("age_restricted");
    expect(html).toContain("You can’t contribute yet");
    expect(html).toContain("under 18");
    expect(html).not.toContain('type="date"');
  });
});
