import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AreaNewsList from "@/components/areanews/AreaNewsList";

describe("AreaNewsList empty state", () => {
  it("renders an honest state when no current entries remain", () => {
    const html = renderToStaticMarkup(
      createElement(AreaNewsList, { areaLabel: "Soho", entries: [] }),
    );

    expect(html).toContain("Soho, lately");
    expect(html).toContain("No current updates here.");
  });
});
