"use client";

import { useState } from "react";
import { FEED_FILTERS, type FeedFilter } from "@/lib/feed";

type FeedFiltersProps = {
  active: FeedFilter;
  onChange: (filter: FeedFilter) => void;
};

// Airbnb-clean lane switcher: primary lanes first; demo / niche lanes behind More.
const PRIMARY_FILTERS = FEED_FILTERS.filter(
  (f) =>
    f.id === "latest" ||
    f.id === "for-you" ||
    f.id === "tonight" ||
    f.id === "friends" ||
    f.id === "cheap",
);
const MORE_FILTERS = FEED_FILTERS.filter((f) => !PRIMARY_FILTERS.some((p) => p.id === f.id));

export default function FeedFilters({ active, onChange }: FeedFiltersProps) {
  const moreActive = MORE_FILTERS.some((f) => f.id === active);
  const [moreOpen, setMoreOpen] = useState(moreActive);
  // When a More-lane filter is active but the strip is collapsed, keep that
  // chip visible so the active lane isn't hidden behind a lit "More" only.
  const visible = moreOpen
    ? FEED_FILTERS
    : moreActive
      ? [...PRIMARY_FILTERS, ...MORE_FILTERS.filter((f) => f.id === active)]
      : PRIMARY_FILTERS;

  return (
    <div className="feedFilters" role="group" aria-label="Feed lanes">
      {visible.map((filter) => {
        const isActive = filter.id === active;
        return (
          <button
            key={filter.id}
            type="button"
            className={`feedFilterChip${isActive ? " isActive" : ""}`}
            aria-pressed={isActive}
            onClick={() => onChange(filter.id)}
          >
            {filter.label}
            {filter.demo ? (
              <span className="feedFilterDemo" title="Demo lane — best-effort in this prototype">
                demo
              </span>
            ) : null}
          </button>
        );
      })}
      {!moreOpen ? (
        <button
          type="button"
          className={`feedFilterChip feedFilterMore${moreActive ? " isActive" : ""}`}
          aria-expanded={false}
          onClick={() => setMoreOpen(true)}
        >
          More
        </button>
      ) : (
        <button
          type="button"
          className="feedFilterChip feedFilterMore"
          aria-expanded={true}
          onClick={() => setMoreOpen(false)}
        >
          Less
        </button>
      )}
    </div>
  );
}
