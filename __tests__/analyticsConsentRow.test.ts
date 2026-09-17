import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AnalyticsConsentPromptContent } from "@/components/AnalyticsConsentPrompt";

// THE CARD IS ONE 56PX ROW. Site audit 13 Sep 2026, D3: the phone card was
// 115px, a four-line sentence beside two stacked buttons, and with the dock it
// took a fifth of the screen. The row holds the sentence and both choices side
// by side, so the sentence has to be short enough to sit beside them on a
// 320px phone. e2e/first-run-chrome-share.spec.ts measures the rendered row;
// this reads the words it is built from.

/** Longest sentence, the Privacy link left out, that wraps inside the row at 320px. */
const ROW_SENTENCE_MAX_CHARS = 64;

function render(): string {
  return renderToStaticMarkup(
    createElement(AnalyticsConsentPromptContent, { onDecision: vi.fn() }),
  );
}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("analytics consent row", () => {
  it("keeps the sentence short enough to share one row with both choices", () => {
    const paragraph = render().match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
    const sentence = textOf(paragraph.replace(/<a[\s\S]*?<\/a>/, ""));
    expect(sentence.length).toBeGreaterThan(0);
    expect(sentence).not.toContain("Privacy");
    expect(sentence.length).toBeLessThanOrEqual(ROW_SENTENCE_MAX_CHARS);
  });

  it("still says what is collected, why, and that it is never sold or used for ads", () => {
    const copy = textOf(render()).toLowerCase();
    expect(copy).toContain("analytics");
    expect(copy).toContain("what people use");
    expect(copy).toContain("never sold");
    expect(copy).toContain("no ads");
  });

  it("keeps the route to the privacy notice and both equal choices", () => {
    const markup = render();
    expect(markup).toContain('href="/privacy"');
    const actions = markup.match(/class="analyticsConsentPromptActions"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    const buttons = [...actions.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)];
    expect(buttons.map(([, , label]) => label)).toEqual(["Allow", "No thanks"]);
    // Equal weight: the two choices carry the same attributes, so neither is
    // painted as the one to press.
    expect(buttons[0]?.[1]).toBe(buttons[1]?.[1]);
  });
});
