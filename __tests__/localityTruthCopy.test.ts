import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    usePathname: () => "/near",
    useRouter: () => ({
      back: () => undefined,
      forward: () => undefined,
      refresh: () => undefined,
      push: () => undefined,
      replace: () => undefined,
      prefetch: () => Promise.resolve(),
    }),
  };
});

import TodayPintsCard from "@/app/today/TodayPintsCard";
import NearMeNow from "@/components/nearme/NearMeNow";
import { CENTRAL_PATCH } from "@/lib/nightPatches";
import { tonightHeading } from "@/lib/tonight";

describe("locality and recency claims", () => {
  it("names central London before Today has a remembered locality", () => {
    const html = renderToStaticMarkup(
      createElement(TodayPintsCard, {
        index: {
          [CENTRAL_PATCH.id]: {
            patchId: CENTRAL_PATCH.id,
            areaName: "Piccadilly & Soho",
            rows: [{
              id: "test-pub",
              name: "The Test Arms",
              price: 4.8,
              priceLabel: "£4.80",
              mapHref: "/map?venue=test-pub",
            }],
          },
        },
      }),
    );

    expect(html).toContain("Cheapest pints in central London today");
    expect(html).not.toContain("Cheapest pints near you today");
  });

  it("names London's scope when Tonight has no locality", () => {
    expect(tonightHeading("london-default")).toBe("What’s on across London tonight.");
    expect(tonightHeading("remembered-patch")).toBe("What’s on near you tonight.");
  });

  it("names Near's price collection month instead of claiming right now", () => {
    const html = renderToStaticMarkup(
      createElement(NearMeNow, { autoLocate: false }),
    );
    expect(html).toContain("prices collected July 2026");
    expect(html).not.toContain("right now");
  });
});
