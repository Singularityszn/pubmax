"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import { Chip } from "@/components/ui/chip";
import {
  SCRAPED_SOURCE_LABELS,
  type ScrapedPubSourceId,
} from "@/lib/scrapedPubs";
import { samePathWithQuery } from "@/lib/appLink";
import type { ZoneSelection } from "@/lib/zones";

export type PubsFilterKey = "all" | ScrapedPubSourceId;
export type PubsFilterCounts = Record<PubsFilterKey, number>;

const FILTERS: { key: PubsFilterKey; label: string }[] = [
  { key: "all", label: "All" },
  {
    key: "nicholsonspubs.co.uk",
    label: SCRAPED_SOURCE_LABELS["nicholsonspubs.co.uk"],
  },
  { key: "youngs.co.uk", label: SCRAPED_SOURCE_LABELS["youngs.co.uk"] },
  {
    key: "greene-king.co.uk",
    label: SCRAPED_SOURCE_LABELS["greene-king.co.uk"],
  },
  { key: "other", label: SCRAPED_SOURCE_LABELS.other },
];

function queryFor(filter: PubsFilterKey, zone: ZoneSelection): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("source", filter);
  if (zone !== "all") params.set("zone", String(zone));
  return params.toString();
}

export default function PubsFilters({
  counts,
  filter,
  zone,
  zonesPresent,
  showCounts,
}: {
  counts: PubsFilterCounts;
  filter: PubsFilterKey;
  zone: ZoneSelection;
  zonesPresent: number[];
  showCounts: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function navigate(nextFilter: PubsFilterKey, nextZone: ZoneSelection): void {
    const query = queryFor(nextFilter, nextZone);
    startTransition(() => {
      router.push(samePathWithQuery(pathname, query));
    });
  }

  return (
    <>
      <div
        className="pubsFilters"
        role="group"
        aria-label="Filter by pub chain"
        aria-busy={pending}
      >
        {FILTERS.map((item) => {
          const count = counts[item.key];
          if (item.key !== "all" && count === 0) return null;
          const selected = filter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={selected}
              className={selected ? "pubsFilter isActive" : "pubsFilter"}
              onClick={() => navigate(item.key, zone)}
            >
              <span>{item.label}</span>
              {showCounts ? <span className="pubsFilterCount">{count}</span> : null}
            </button>
          );
        })}
      </div>

      {/* The fare zones are number squares, and a number square is ONE family:
          this row renders the same `Chip variant="number"` the planner's
          pub-stop count renders (components/ui/chip.tsx), rather than a
          look-alike square of its own. */}
      {zonesPresent.length > 0 ? (
        <div className="zoneChips pubsZoneChips" role="group" aria-label="Filter by fare zone">
          <Chip
            variant="number"
            aria-pressed={zone === "all"}
            onClick={() => navigate(filter, "all")}
          >
            All zones
          </Chip>
          {zonesPresent.map((id) => (
            <Chip
              key={id}
              variant="number"
              aria-pressed={zone === id}
              aria-label={`Zone ${id}${zone === id ? " (selected)" : ""}`}
              onClick={() => navigate(filter, id as ZoneSelection)}
            >
              {id}
            </Chip>
          ))}
        </div>
      ) : null}
    </>
  );
}
