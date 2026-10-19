// @vitest-environment jsdom
import { Thumbnail } from "@remotion/player";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import RecapVideo from "@/components/recap/RecapVideo";
import { buildRecapVideoInput, RECAP_VIDEO_FPS, RECAP_VIDEO_HEIGHT, RECAP_VIDEO_WIDTH } from "@/lib/recapVideo";
import type { RecapView } from "@/lib/recapView";

/**
 * The composition draws each beat at its own frames: the Plan name first, a
 * Stop with its stored price, and the PUBMAXX wordmark last.
 */
const view: RecapView = {
  title: "Soho, slowly",
  completedAt: null,
  route: [{ position: 0, venueId: "v-lamb", venueName: "The Lamb", caption: null }],
  pints: [{ venueId: "v-lamb", venueName: "The Lamb", drink: "Bitter", priceGbp: 5.4, priceLabel: "£5.40", note: null }],
  photos: [],
  ending: null,
  guardian: null,
  closingLine: "",
  stats: { stopCount: 1, pintCount: 1, totalGbp: 5.4, cheapestPintGbp: 5.4 },
};
const input = buildRecapVideoInput({ view, published: [] })!;

function frameText(frame: number): string {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
    <Thumbnail
      component={RecapVideo}
      inputProps={input}
      durationInFrames={input.timing.durationInFrames}
      fps={RECAP_VIDEO_FPS}
      compositionWidth={RECAP_VIDEO_WIDTH}
      compositionHeight={RECAP_VIDEO_HEIGHT}
      frameToDisplay={frame}
    />,
    );
  });
  const text = container.textContent ?? "";
  act(() => root.unmount());
  container.remove();
  return text;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the recap video composition", () => {
  it("opens on the Plan name", () => {
    expect(frameText(20)).toContain("Soho, slowly");
  });

  it("shows a Stop with its stored price", () => {
    const text = frameText(input.timing.introFrames + 20);
    expect(text).toContain("The Lamb");
    expect(text).toContain("£5.40");
  });

  it("ends on the PUBMAXX wordmark and never counts drinks", () => {
    const last = frameText(input.timing.durationInFrames - 1);
    expect(last).toContain("PUBMAXX");
    for (let frame = 0; frame < input.timing.durationInFrames; frame += 15) {
      expect(frameText(frame)).not.toMatch(/\d+\s*(pints?|drinks?|rounds?)/i);
    }
  });
});
