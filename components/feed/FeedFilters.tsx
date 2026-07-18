"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

// Not a real FeedFilter id — a sentinel key for the collapsed "More" chip's own
// measured rect, so the gliding indicator can also settle under "More" when the
// active lane is tucked away and the strip is collapsed.
const MORE_KEY = "__more__";

type IndicatorRect = { left: number; top: number; width: number };

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

  // ── Gliding active indicator ────────────────────────────────────────────
  // The active pill's own fill still crossfades in place (border/background/
  // color, see feed.css), but a slim brass underline now GLIDES from the old
  // active chip to the new one instead of just popping — measured off the real
  // chip buttons via refs so it tracks correctly whether the strip has wrapped
  // to a second row (desktop) or sits mid-scroll (mobile). `null` until the
  // first client measurement lands; each chip's own active border/text colour
  // already reads correctly on its own in that brief window, so there's no
  // legibility regression — only the extra glide cue arrives a beat later.
  const railRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState<IndicatorRect | null>(null);
  // Mobile edge-fade hint — the last chip ("Cheapest") used to read as simply
  // cut off with no affordance that the strip scrolls further right.
  const [hintMore, setHintMore] = useState(false);

  const indicatorKey = moreActive && !moreOpen ? MORE_KEY : active;

  useLayoutEffect(() => {
    const chip = chipRefs.current.get(indicatorKey);
    if (!chip) return;
    const inset = Math.min(14, chip.offsetWidth * 0.22);
    setIndicator({
      left: chip.offsetLeft + inset,
      top: chip.offsetTop + chip.offsetHeight + 4,
      width: Math.max(16, chip.offsetWidth - inset * 2),
    });
    // visible.length as a dep (not `visible` itself, which is a fresh array
    // each render) — re-measures when More/Less reshapes the row.
  }, [indicatorKey, visible.length]);

  // Recompute on resize/scroll so the edge-fade backs off once the viewer has
  // actually scrolled to the end — never a fade hinting at content that isn't
  // there. Also re-measures the indicator so a viewport resize (e.g. rotating
  // a phone) doesn't leave the glide underline stranded at a stale position.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const update = () => {
      setHintMore(rail.scrollWidth - rail.clientWidth - rail.scrollLeft > 4);
      const chip = chipRefs.current.get(indicatorKey);
      if (!chip) return;
      const inset = Math.min(14, chip.offsetWidth * 0.22);
      setIndicator({
        left: chip.offsetLeft + inset,
        top: chip.offsetTop + chip.offsetHeight + 4,
        width: Math.max(16, chip.offsetWidth - inset * 2),
      });
    };
    update();
    rail.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(rail);
    }
    return () => {
      rail.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, [indicatorKey, visible.length]);

  return (
    <div
      className={`feedFilters${hintMore ? " hasScrollHint" : ""}`}
      ref={railRef}
      role="group"
      aria-label="Feed lanes"
    >
      {indicator ? (
        <span
          className="feedFilterIndicator"
          aria-hidden="true"
          style={{
            transform: `translate(${indicator.left}px, ${indicator.top}px)`,
            width: `${indicator.width}px`,
          }}
        />
      ) : null}
      {visible.map((filter) => {
        const isActive = filter.id === active;
        return (
          <button
            key={filter.id}
            ref={(el) => {
              if (el) chipRefs.current.set(filter.id, el);
              else chipRefs.current.delete(filter.id);
            }}
            type="button"
            className={`feedFilterChip${isActive ? " isActive" : ""}`}
            aria-pressed={isActive}
            onClick={() => onChange(filter.id)}
          >
            {filter.label}
            {filter.demo ? (
              <span className="feedFilterDemo" title="Demo lane. Best-effort in this prototype">
                demo
              </span>
            ) : null}
          </button>
        );
      })}
      {!moreOpen ? (
        <button
          type="button"
          ref={(el) => {
            if (el) chipRefs.current.set(MORE_KEY, el);
            else chipRefs.current.delete(MORE_KEY);
          }}
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
