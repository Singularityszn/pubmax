"use client";

import IntentLink from "@/components/nav/IntentLink";
import { trackEvent } from "@/lib/analytics";
import type { CommunityPriceAttribution } from "@/lib/communityPrice";

type Props = {
  attribution: CommunityPriceAttribution;
};

export default function PriceContributionImpact({ attribution }: Props) {
  if (attribution.status !== "credited") return null;

  return (
    <div className="vpsubImpactRow">
      <p className="vpsubStampHint">
        Counted under <strong>@{attribution.handle}</strong> on the contributor
        record.
      </p>
      {/* A client transition, never a plain <a>: this link sits inside the map
          sheet, so a document load would throw the camera, the filters and the
          whole MapLibre instance away to read one count. IntentLink because
          /u/[handle] is dynamic, so it is warmed on intent rather than
          prefetched on sight (see the client-router-cache rule in AGENTS.md). */}
      <IntentLink
        className="vpsubImpactLink"
        href={`/u/${encodeURIComponent(attribution.handle)}#contribution-impact`}
        onClick={() => trackEvent("price_impact_opened")}
      >
        See your impact
      </IntentLink>
    </div>
  );
}
