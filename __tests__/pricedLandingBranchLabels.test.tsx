import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PricedLandingRows from "@/components/drinks/PricedLandingRows";
import type { PricedLandingRow } from "@/lib/pricedLanding";

describe("priced landing branch labels", () => {
  it("distinguishes same-name branches in visible text and accessible link names", () => {
    const rows: PricedLandingRow[] = [
      {
        rank: 1, venueId: "venue-kingsbury", venueName: "J.J. Moon's",
        branchAddress: "553 Kingsbury Road, NW9 9EL", borough: "Brent",
        pintName: "Bud Light", priceGbp: 2.43, publisher: null,
      },
      {
        rank: 2, venueId: "venue-ruislip", venueName: "J.J. Moon's",
        branchAddress: "12 Victoria Road, HA4 0AA", borough: "Hillingdon",
        pintName: "Bud Light", priceGbp: 2.43, publisher: null,
      },
    ];
    const html = renderToStaticMarkup(createElement(PricedLandingRows, { rows }));
    expect(html).toContain('aria-label="J.J. Moon&#x27;s, 553 Kingsbury Road, NW9 9EL"');
    expect(html).toContain('aria-label="J.J. Moon&#x27;s, 12 Victoria Road, HA4 0AA"');
    expect(html).toContain('>553 Kingsbury Road, NW9 9EL</span>');
    expect(html).toContain('>12 Victoria Road, HA4 0AA</span>');
    expect(html).toContain('href="/ledger/venue-kingsbury"');
    expect(html).toContain('href="/ledger/venue-ruislip"');
  });

  it("keeps the existing name and borough when no branch address is recorded", () => {
    const html = renderToStaticMarkup(createElement(PricedLandingRows, {
      rows: [{
        rank: 1, venueId: "venue-one", venueName: "The Crown", borough: "Camden",
        pintName: "Guinness", priceGbp: 5, publisher: null,
      }],
    }));
    expect(html).toContain('>The Crown</a>');
    expect(html).toContain('>Camden</span>');
    expect(html).not.toContain("undefined");
    expect(html).not.toContain('aria-label="The Crown,');
  });
});
