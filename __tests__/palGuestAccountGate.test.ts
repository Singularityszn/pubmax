import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PalGuestAccountGate from "@/components/pal/PalGuestAccountGate";

describe("Pal guest account gate", () => {
  it("keeps the fifth answer visible and offers account routes instead of a sixth ask", () => {
    const html = renderToStaticMarkup(
      createElement(PalGuestAccountGate, { answeredPrompts: 5 }),
    );

    expect(html).toContain("Create your account");
    expect(html).toContain("Five guest answers complete");
    expect(html).toContain('href="/login?mode=signup&amp;from=%2Fpal"');
    expect(html).toContain('href="/login?mode=signin&amp;from=%2Fpal"');
  });
});
