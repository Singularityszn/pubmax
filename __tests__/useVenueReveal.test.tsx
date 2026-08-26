// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  VENUE_REVEAL_CINEMA_MS,
} from "@/lib/venueReveal";
import { useVenueReveal } from "@/components/map/useVenueReveal";

function RevealHarness({ startedAt }: { startedAt: number }) {
  const { beginReveal, reveal } = useVenueReveal();

  useEffect(() => {
    beginReveal("venue-1", undefined, undefined, {
      form: "full",
      startedAt,
    });
  }, [beginReveal, startedAt]);

  return createElement("output", {
    "data-reveal": reveal
      ? `${reveal.form}:${String(reveal.active)}:${String(reveal.interrupted)}`
      : "none",
  });
}

describe("useVenueReveal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps a completed full record when inspector mounts after entrance", async () => {
    const startedAt = Date.now() - VENUE_REVEAL_CINEMA_MS - 1;

    await act(async () => {
      root.render(createElement(RevealHarness, { startedAt }));
      await Promise.resolve();
    });

    expect(container.querySelector("output")?.getAttribute("data-reveal")).toBe(
      "full:false:false",
    );
  });
});
