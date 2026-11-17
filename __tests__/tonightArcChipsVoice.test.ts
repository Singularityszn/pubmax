// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import TonightArcChips from "@/components/map/TonightArcChips";
import { defaultVenueKindVisibility } from "@/lib/venueKindFilters";

// A component name is not reader words. "TONIGHT ARC" printed over the desktop
// map and stood as a section heading in the phone Filters sheet, in the
// accessibility tree as well as on screen. docs/VOICE.md rule 2 bans exactly
// that. The chips name the venue types themselves, so the group needs no title.

function render(variant: "popover" | "sheet"): string {
  return renderToStaticMarkup(
    createElement(TonightArcChips, {
      visibility: defaultVenueKindVisibility(),
      variant,
      onChange: vi.fn(),
    }),
  );
}

describe("Venue-type chips — no component name reaches the reader", () => {
  for (const variant of ["popover", "sheet"] as const) {
    it(`prints no internal name in the ${variant} variant`, () => {
      const html = render(variant);
      expect(html.toLowerCase()).not.toContain("tonight arc");
      // The accessible name is read out loud, so it is copy too.
      expect(html).toContain('aria-label="Venue types"');
      // The chips are still there, and they still say what they filter.
      expect(html).toContain("Pubs");
      expect(html).toContain("Restaurants");
    });
  }
});

it("keeps optional restaurant state when the control is unavailable outside London", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Controls({ available }: { available: boolean }) {
    const [visibility, setVisibility] = useState(defaultVenueKindVisibility("london"));
    return createElement(TonightArcChips, { visibility, restaurantLayerAvailable: available, onChange: setVisibility });
  }
  const allRestaurants = () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("All restaurants"));
  try {
    await act(async () => root.render(createElement(Controls, { available: false })));
    expect(allRestaurants()).toBeUndefined();
    await act(async () => host.querySelector("button")?.click());
    await act(async () => root.render(createElement(Controls, { available: true })));
    expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
    expect(allRestaurants()?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => allRestaurants()?.click());
    expect(allRestaurants()?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
