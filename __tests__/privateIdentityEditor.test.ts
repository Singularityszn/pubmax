import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PrivateIdentityEditorForm } from "@/components/identity/PrivateIdentityEditor";

describe("private identity editor", () => {
  it("marks both private fields optional and keeps the public boundary explicit", () => {
    const html = renderToStaticMarkup(
      createElement(PrivateIdentityEditorForm, {
        fullName: "",
        sex: "",
        busy: false,
        message: "",
        onFullNameChange: () => {},
        onSexChange: () => {},
        onSubmit: () => {},
      }),
    );

    expect(html).toContain("Full name");
    expect(html).toContain("Sex");
    expect(html.match(/Optional/g)).toHaveLength(2);
    expect(html).toContain("Only your handle is public");
  });
});
