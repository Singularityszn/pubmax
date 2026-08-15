"use client";

import Link from "next/link";

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
      <Link
        className="vpsubImpactLink"
        href={`/u/${encodeURIComponent(attribution.handle)}`}
        onClick={() => trackEvent("price_impact_opened")}
      >
        See your impact
      </Link>
    </div>
  );
}
