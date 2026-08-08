import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PrivateIdentityEditorForm } from "@/components/identity/PrivateIdentityEditor";
import { loadPrivateIdentity } from "@/lib/privateIdentityClient";

const formProps = {
  email: "",
  fullName: "",
  sex: "" as const,
  gender: "" as const,
  genderSelfDescribed: "",
  dateOfBirth: "",
  saving: false,
  saveEnabled: true,
  message: "",
  onRetryLoad: null,
  onFullNameChange: () => {},
  onSexChange: () => {},
  onGenderChange: () => {},
  onGenderSelfDescribedChange: () => {},
  onDateOfBirthChange: () => {},
  onSubmit: () => {},
};

describe("private identity editor", () => {
  it("exposes the personal fields and states the privacy boundary", () => {
    const html = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, formProps),
    );

    expect(html).toContain("Full name");
    expect(html).toContain("Date of birth");
    expect(html).toContain('type="date"');
    expect(html).toContain("Gender");
    expect(html).toContain("Self-described");
    expect(html).toContain("Prefer not to say");
    expect(html).toContain("Sex");
    expect(html).toContain("Only your handle is public");
    expect(html).toContain("stay private");
  });

  it("shows the sign-in email read-only with its explanation", () => {
    const withEmail = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, {
        ...formProps,
        email: "person@example.com",
      }),
    );
    expect(withEmail).toContain("person@example.com");
    expect(withEmail).toContain('readOnly=""');
    expect(withEmail).toContain("Your sign-in address");

    const withoutEmail = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, formProps),
    );
    expect(withoutEmail).not.toContain("Your sign-in address");
  });

  it("offers the self-describe line only for a self-described gender", () => {
    const closed = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, {
        ...formProps,
        gender: "woman" as const,
      }),
    );
    expect(closed).not.toContain("Your words");

    const open = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, {
        ...formProps,
        gender: "self_described" as const,
        genderSelfDescribed: "genderfluid",
      }),
    );
    expect(open).toContain("Your words");
    expect(open).toContain("genderfluid");
  });

  it("keeps save disabled and offers retry after a failed load", async () => {
    const auth = { userId: "user-a", accessToken: "token-a" };
    const result = await loadPrivateIdentity(
      auth,
      async () =>
        new Response(
          JSON.stringify({ error: "Private details are unavailable." }),
          { status: 503 },
        ),
    );
    expect(result).toEqual({
      status: "unavailable",
      error: "Private details are unavailable.",
    });
    if (result.status !== "unavailable") {
      throw new Error("Expected unavailable private identity state.");
    }

    const html = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, {
        ...formProps,
        saveEnabled: false,
        message: result.error,
        onRetryLoad: () => {},
      }),
    );
    expect(html).toContain('type="submit" disabled=""');
    expect(html).toContain("Try again");
  });

  it("loads every private field for the owner", async () => {
    const auth = { userId: "user-a", accessToken: "token-a" };
    const result = await loadPrivateIdentity(
      auth,
      async () =>
        new Response(
          JSON.stringify({
            complete: true,
            handle: "night_person",
            fullName: "Full Name",
            sex: "female",
            gender: "self_described",
            genderSelfDescribed: "genderfluid",
            dateOfBirth: "1990-01-01",
          }),
          { status: 200 },
        ),
    );
    expect(result).toEqual({
      status: "ready",
      fullName: "Full Name",
      sex: "female",
      gender: "self_described",
      genderSelfDescribed: "genderfluid",
      dateOfBirth: "1990-01-01",
    });
  });
});
