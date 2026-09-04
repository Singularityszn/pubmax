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
import {
  formatPintDatasetAsOf,
  formatPintDatasetSnapshot,
} from "@/lib/dataFreshness";
import { CENTRAL_PATCH } from "@/lib/nightPatches";
import { tonightHeading } from "@/lib/tonight";
import { nearMeAnswerHeadline } from "@/lib/nearMeAnswer";

describe("locality and recency claims", () => {
  it("names central London and the last collection date for older Today prices", () => {
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

    expect(html).toContain(`Lowest listed prices in central London. ${formatPintDatasetSnapshot()}.`);
    expect(html).not.toContain(formatPintDatasetAsOf());
    expect(html).not.toContain("Lowest listed prices near you today");
  });

  it("keeps the baseline collection date without presenting it as today's clock", () => {
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

    expect(html).toContain(`Lowest listed prices in central London. ${formatPintDatasetSnapshot()}.`);
    expect(html).not.toContain(formatPintDatasetAsOf());
  });

  it("names London's scope when Tonight has no locality", () => {
    expect(tonightHeading("london-default")).toBe("What’s on across London tonight.");
    expect(tonightHeading("remembered-patch")).toBe("What’s on near you tonight.");
  });

  it("limits Near's intro to listed price and ordering guarantees", () => {
    const html = renderToStaticMarkup(
      createElement(NearMeNow, { autoLocate: false }),
    );
    expect(html).toContain(
      "Compare listed pint prices near you, cheapest first.",
    );
    expect(html).not.toContain("good pints");
    expect(html).not.toContain("prices collected");
  });

  it("describes Near results as the cheapest listed prices", () => {
    expect(nearMeAnswerHeadline({ scope: "walkable" })).toBe("Cheapest listed near you");
    expect(nearMeAnswerHeadline({ scope: "walkable", borough: "Camden" })).toBe("Cheapest listed in Camden");
    expect(nearMeAnswerHeadline({ scope: "walkable", patchLabel: "Soho" })).toBe("Cheapest listed around Soho");
  });
});
