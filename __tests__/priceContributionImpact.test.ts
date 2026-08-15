import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PriceContributionImpact from "@/components/map/PriceContributionImpact";

describe("PriceContributionImpact", () => {
  it("links credited attribution to its encoded anchored public impact", () => {
    const html = renderToStaticMarkup(createElement(PriceContributionImpact, {
      attribution: { status: "credited", handle: "night owl/club" },
    }));

    expect(html).toContain("Counted under");
    expect(html).toContain("@night owl/club");
    expect(html).toContain('href="/u/night%20owl%2Fclub#contribution-impact"');
    expect(html).toContain("See your impact");
  });

  it("renders no profile link for anonymous attribution", () => {
    const html = renderToStaticMarkup(createElement(PriceContributionImpact, {
      attribution: { status: "anonymous" },
    }));

    expect(html).toBe("");
  });

  it("keeps the fragment, which is the whole promise of the link", () => {
    // Reviewed as "use Link, not <a>, so the map survives the tap". Measured
    // instead: a client transition from /map (CDN-cached, no nonce) to
    // /u/[handle] (nonce'd, dynamic) is a hard navigation either way, and Next
    // drops the hash on it, landing the reader at the top of a long profile
    // rather than on the impact card the link names. Proved in
    // e2e/price-submission with IntentLink and with a bare next/link.
    //
    // So the anchor stays, and this fence records why, because "why is this a
    // raw <a>?" is exactly the question the next reader will ask.
    const source = readFileSync(
      new URL("../components/map/PriceContributionImpact.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/^import .*from "next\/link";$/m);
    expect(source).not.toMatch(/^import .*IntentLink.*$/m);
    expect(source).toContain("#contribution-impact");
    // The reason is carried in the source, not in a commit message nobody reads.
    expect(source).toContain("FRAGMENT GONE");
  });
});
