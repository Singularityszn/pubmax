"use client";

// The Social Loop's top-level feed axis (Cycle 15 Lane C). Three chronological
// tabs — "Your lot" (mutual friends' drops + check-ins), "Nearby" (area-level
// activity), "London" (the city-wide public feed). This is a re-composition over
// the SAME feed cards, not a new surface: it swaps the data source, the feed list
// underneath is unchanged. Presentational + controlled — the /feed page owns the
// active tab and does the fetching.

export type SocialTab = "lot" | "nearby" | "london";

const TABS: { id: SocialTab; label: string; hint: string }[] = [
  { id: "lot", label: "Your lot", hint: "Friends' nights, chronological" },
  { id: "nearby", label: "Nearby", hint: "Area-level activity" },
  { id: "london", label: "London", hint: "The whole city" },
];

export default function SocialTabs({
  active,
  onChange,
}: {
  active: SocialTab;
  onChange: (tab: SocialTab) => void;
}) {
  return (
    <div className="feedSocialTabs" role="tablist" aria-label="Feed">
      {TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            title={tab.hint}
            className={`feedSocialTab${selected ? " isActive" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
