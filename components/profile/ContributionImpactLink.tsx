"use client";

import Link from "next/link";

import { trackEvent } from "@/lib/analytics";

export default function ContributionImpactLink({ handle }: { handle: string }) {
  return (
    <Link
      className="vpsubImpactLink"
      href={`/u/${encodeURIComponent(handle)}#your-contributions`}
      onClick={() => trackEvent("contribution_impact_opened")}
    >
      See your impact
    </Link>
  );
}
