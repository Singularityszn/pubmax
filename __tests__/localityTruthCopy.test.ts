import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  it("names central London and the actual collection date for older Today prices", () => {
    const html = renderToStaticMarkup(
      createElement(TodayPintsCard, {
        nowIso: "2026-07-29T12:00:00.000Z",
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

    expect(html).toContain("Lowest listed prices in central London, collected 3 July 2026");
    expect(html).not.toContain("Lowest listed prices near you today");
  });

  it("uses today only when the pint dataset was collected today", () => {
    const html = renderToStaticMarkup(
      createElement(TodayPintsCard, {
        nowIso: "2026-07-03T20:00:00.000Z",
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

    expect(html).toContain("Lowest listed prices in central London today");
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
    const source = readFileSync(
      join(process.cwd(), "components/nearme/NearMeNow.tsx"),
      "utf8",
    );

    expect(source).toContain("Cheapest listed near you");
    expect(source).toContain("Cheapest listed in");
    expect(source).toContain("Cheapest listed around");
    expect(source).not.toContain("Finding the cheapest");
    expect(source).not.toContain("Pulling up the cheapest");
  });
});
