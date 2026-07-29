import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContributionGateDialog } from "@/components/identity/ContributionGateDialog";

const noop = () => {};

describe("first-contribution age surface", () => {
  it("asks for date of birth only in the age-required state", () => {
    const age = renderToStaticMarkup(
      createElement(ContributionGateDialog, {
        mode: "age_required",
        dateOfBirth: "",
        busy: false,
        error: null,
        onDateOfBirthChange: noop,
        onConfirmAge: noop,
        onClose: noop,
      }),
    );
    expect(age).toContain('type="date"');
    expect(age).toContain("before your first contribution");

    const underage = renderToStaticMarkup(
      createElement(ContributionGateDialog, {
        mode: "underage",
        eligibleOn: "2028-07-30",
        dateOfBirth: "",
        busy: false,
        error: null,
        onDateOfBirthChange: noop,
        onConfirmAge: noop,
        onClose: noop,
      }),
    );
    expect(underage).not.toContain('type="date"');
    expect(underage).toContain("You must be 18 or over to contribute.");
    expect(underage).toContain("buying alcohol");
  });
});
