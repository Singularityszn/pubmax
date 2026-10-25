// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PreparedBriefStamp from "@/components/seo/PreparedBriefStamp";

describe("a cached brief's preparation date", () => {
  it.each([
    ["2026-01-15T12:34:00Z", "2026-01-15T12:34:00.000Z", "15 Jan 2026, 12:34 GMT"],
    ["2026-07-15T12:34:00Z", "2026-07-15T12:34:00.000Z", "15 Jul 2026, 13:34 BST"],
    ["2026-07-15T23:45:00Z", "2026-07-15T23:45:00.000Z", "16 Jul 2026, 00:45 BST"],
    ["2026-03-29T00:59:59Z", "2026-03-29T00:59:59.000Z", "29 Mar 2026, 00:59 GMT"],
    ["2026-03-29T01:00:00Z", "2026-03-29T01:00:00.000Z", "29 Mar 2026, 02:00 BST"],
    ["2026-10-25T00:59:59Z", "2026-10-25T00:59:59.000Z", "25 Oct 2026, 01:59 BST"],
    ["2026-10-25T01:00:00Z", "2026-10-25T01:00:00.000Z", "25 Oct 2026, 01:00 GMT"],
    ["2026-10-25T01:30:00+01:00", "2026-10-25T00:30:00.000Z", "25 Oct 2026, 01:30 BST"],
    ["2026-10-25T01:30:00+00:00", "2026-10-25T01:30:00.000Z", "25 Oct 2026, 01:30 GMT"],
  ])("identifies the exact London instant %s without redating any source", (preparedAt, iso, label) => {
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
