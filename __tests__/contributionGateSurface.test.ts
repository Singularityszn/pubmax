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

  it("routes incomplete accounts back to profile setup without age blocking", () => {
    const html = render("onboarding_required");
    expect(html).toContain("Finish account setup");
    expect(html).toContain("private date of birth");
    expect(html).not.toContain("18 or over");
    expect(html).not.toContain('type="date"');
  });
});
