// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { GET } from "@/app/app-entry/route";

describe("the static app-entry document", () => {
  it("loads only the entry script, with no landing preload or React assets", async () => {
    const response = GET();
    const html = await response.text();
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(new TextEncoder().encode(html).length).toBeLessThan(1024);
    expect([...document.querySelectorAll("script")].map((script) => script.getAttribute("src")))
      .toEqual(["/theme-init.js?v=entry-v1"]);
    expect(document.querySelectorAll("link, img, style")).toHaveLength(0);
    expect(html).not.toContain("_next/");
  });
});
