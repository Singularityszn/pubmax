"use client";

import { FEED_FILTERS, type FeedFilter } from "@/lib/feed";

type FeedFiltersProps = {
  active: FeedFilter;
  onChange: (filter: FeedFilter) => void;
};

// The InstaPint lane switcher. A single-select radiogroup of chips, fully
// controlled by the page (active + onChange). Real <button>s so it is keyboard-
// operable; aria-pressed tracks the active lane for assistive tech. Demo-only
// lanes carry a small honest badge so we never imply a capability we lack.
export default function FeedFilters({ active, onChange }: FeedFiltersProps) {
  return (
    <div className="feedFilters" role="group" aria-label="Feed lanes">
      {FEED_FILTERS.map((filter) => {
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
    </div>
  );
}
