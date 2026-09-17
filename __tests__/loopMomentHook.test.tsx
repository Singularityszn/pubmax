// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("@/lib/analytics", () => ({ trackEvent: analytics.trackEvent }));

import { useLoopMoment } from "@/components/loop/useLoopMoment";

let container: HTMLDivElement;
let root: Root;

function Probe({ momentKey, muted }: { momentKey: string | null; muted: boolean }) {
  // A fresh props object on every render, which is how a real surface calls it.
  useLoopMoment("briefing_viewed", momentKey, { personalized: true, muted });
  return null;
}

function render(props: { momentKey: string | null; muted: boolean }): void {
  act(() => {
    root.render(createElement(Probe, props));
  });
}

beforeEach(() => {
  analytics.trackEvent.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useLoopMoment", () => {
  it("reports an impression once, however often the surface re-renders", () => {
    render({ momentKey: "true:false", muted: false });
    render({ momentKey: "true:false", muted: false });
    render({ momentKey: "true:false", muted: false });
    expect(analytics.trackEvent).toHaveBeenCalledTimes(1);
    expect(analytics.trackEvent).toHaveBeenCalledWith("briefing_viewed", {
      personalized: true,
      muted: false,
    });
  });

  it("says nothing while the key is null, then reports the resolved answer", () => {
    // The morning brief personalizes itself in an effect, so its props arrive
    // after mount. Reporting before they land would date the impression to a
    // brief the reader was never shown.
    render({ momentKey: null, muted: false });
    expect(analytics.trackEvent).not.toHaveBeenCalled();

    render({ momentKey: "true:true", muted: true });
    expect(analytics.trackEvent).toHaveBeenCalledTimes(1);
    expect(analytics.trackEvent).toHaveBeenCalledWith("briefing_viewed", {
      personalized: true,
      muted: true,
    });
  });

  it("reports again only when the surface really moves to another thing", () => {
    render({ momentKey: "true:false", muted: false });
    render({ momentKey: "true:true", muted: true });
    expect(analytics.trackEvent).toHaveBeenCalledTimes(2);
    expect(analytics.trackEvent).toHaveBeenLastCalledWith("briefing_viewed", {
      personalized: true,
      muted: true,
    });

    // And never a third time for a key it has already reported in this mount.
    render({ momentKey: "true:true", muted: true });
    expect(analytics.trackEvent).toHaveBeenCalledTimes(2);
  });
});
