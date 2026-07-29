import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PrivateIdentityEditorForm } from "@/components/identity/PrivateIdentityEditor";
import { loadPrivateIdentity } from "@/lib/privateIdentityClient";

describe("private identity editor", () => {
  it("keeps optional identity fields private", () => {
    const html = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, {
        fullName: "",
        sex: "",
        saving: false,
        saveEnabled: true,
        message: "",
        onRetryLoad: null,
        onFullNameChange: () => {},
        onSexChange: () => {},
        onSubmit: () => {},
      }),
    );

    expect(html).toContain("Full name");
    expect(html).not.toContain("Date of birth");
    expect(html).toContain("Sex");
    expect(html.match(/Optional/g)).toHaveLength(2);
    expect(html).toContain("Only your handle is public");
    expect(html).toContain("optional details stay private");
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

    const html = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, {
        fullName: "",
        sex: "",
        saving: false,
        saveEnabled: false,
        message: result.error,
        onRetryLoad: () => {},
        onFullNameChange: () => {},
        onSexChange: () => {},
        onSubmit: () => {},
      }),
    );
    expect(html).toContain('type="submit" disabled=""');
    expect(html).toContain("Try again");
  });
});
