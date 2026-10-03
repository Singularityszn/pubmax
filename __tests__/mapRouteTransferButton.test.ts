import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MapRouteTransferButton } from "@/components/plan/MapRouteTransferButton";
import type { MapGeneratedRouteResponse } from "@/lib/mapRouteTransfer";

const response: MapGeneratedRouteResponse = {
  groundingProof: "payload.signature",
  operationKey: "operation-1",
  stops: [{ venueId: "venue-a", venueName: "Venue A", alternatives: [] }],
};

describe("MapRouteTransferButton", () => {
  it("renders the plain navigate-and-regenerate CTA with no captured Route", () => {
    const noRoute = renderToStaticMarkup(createElement(MapRouteTransferButton, { response: null }));

    expect(noRoute).toContain('href="/plan?src=mobile-route-preview"');
    expect(noRoute).toContain("Open Plan to lock it in");
  });

  it("keeps the identical navigation target with a Route: the transfer rides the click, not a re-render", () => {
    const withRoute = renderToStaticMarkup(createElement(MapRouteTransferButton, { response }));
    const noRoute = renderToStaticMarkup(createElement(MapRouteTransferButton, { response: null }));

    expect(withRoute).toContain('href="/plan?src=mobile-route-preview"');
    expect(withRoute).toBe(noRoute);
  });
});
