import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";

function render(props: Parameters<typeof PubmaxxWordmark>[0] = {}): string {
  return renderToStaticMarkup(createElement(PubmaxxWordmark, props));
}

describe("PUBMAXX wordmark", () => {
  it("renders the canonical visible brand as PUBMA plus two X glyphs", () => {
    const html = render();
    const letters = html.match(
      /<span class="pubmaxxWordmarkLetters"[\s\S]*?<\/span><\/span>/,
    )?.[0] ?? "";

    expect(letters, "visible letter lockup is present").not.toBe("");
    expect(letters).toContain(">PUBMA</span>");
    expect(letters).not.toContain("ING");
    expect((letters.match(/class="pubmaxxDoubleX(?:\s|\")/g) ?? []).length).toBe(2);
    expect((letters.match(/<svg /g) ?? []).length).toBe(2);
  });

  it("keeps the app name and decorative role for assistive technology", () => {
    const html = render();

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="PUBMAXXING"');
    expect(html).toContain('class="pubmaxxWordmarkSr">PUBMAXXING</span>');
  });

  it("keeps the mark lockup API intact", () => {
    const html = render({ withMark: true, markVariant: "duo", markSize: 22 });

    expect(html).toContain('class="pubmaxxLockup"');
    expect(html).toContain('class="pubmaxxMark"');
    expect(html).toContain('width="22"');
    expect(html).toContain('class="pubmaxxWordmark"');
  });
});
