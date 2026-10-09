"use client";

import { PUB_LIST_REFRESHED_CAPTION } from "@/lib/nearPriceTrust";

/**
 * The honest date under the summary line: when the pub list was last
 * refreshed. A route is only as fresh as the list behind it, and the line says
 * so without claiming a date for any single price. It is its own chunk because
 * the date comes out of the data-freshness registry, which the describe-first
 * page every visitor opens has no other reason to carry.
 */
export default function PlanResultProvenance() {
  return <p className="planResult__provenance">{PUB_LIST_REFRESHED_CAPTION}</p>;
}
