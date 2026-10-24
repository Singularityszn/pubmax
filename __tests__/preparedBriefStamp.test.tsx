// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PreparedBriefStamp from "@/components/seo/PreparedBriefStamp";

describe("a cached brief's preparation date", () => {
  it.each([
    ["2026-10-25T01:30:00+01:00", "2026-10-25T00:30:00.000Z", "25 Oct 2026, 01:30 BST"],
    ["2026-10-25T01:30:00+00:00", "2026-10-25T01:30:00.000Z", "25 Oct 2026, 01:30 GMT"],
  ])("identifies the exact repeated-hour instant %s without redating any source", (preparedAt, iso, label) => {
    const html = renderToStaticMarkup(createElement(PreparedBriefStamp, { preparedAt }));
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelector("time")?.getAttribute("datetime")).toBe(iso);
    expect(document.querySelector("time")?.textContent).toBe(label);
    expect(html).toContain("Source dates can be older");
  });

  it("prints no invented date when the preparation time is absent or invalid", () => {
    for (const preparedAt of [undefined, "unknown"]) {
      expect(renderToStaticMarkup(createElement(PreparedBriefStamp, { preparedAt }))).toBe("");
    }
  });
});
