"use client";

import { KeyboardEvent, useState } from "react";

import { trackEvent } from "@/lib/analytics";
import {
  DESCRIBE_FIRST_CHIP_KEYS,
  type DescribeFirstChipKey,
} from "@/lib/analyticsEvents";

// Suggestion chips are real, working examples. Each string here was posted to
// /api/plans/generate keyless and returned a priced three-stop route before
// it was allowed to ship as a chip: an example that 422s is a lie.
// Verified 2026-08-07 keyless on localhost: classic night chips plus
// alcohol-free / soft-drink / food / coffee / chill Spoons occasions.
// Dropped: "chill Wetherspoons in Zone 2 for 3" (422 Choose an area).
//
// Analytics uses the stable key beside each query (DESCRIBE_FIRST_CHIP_KEYS),
// never the free-text string itself.
const DESCRIBE_FIRST_CHIP_QUERIES: Record<DescribeFirstChipKey, string> = {
  quiet_clapham: "Quiet in Clapham for 4, not pricey",
  cheap_pints_shoreditch: "cheap pints tonight in Shoreditch",
  alcohol_free_camden: "alcohol-free drinks in Camden for 3",
  soft_drinks_clapham: "quiet afternoon in Clapham for 2, soft drinks",
  food_soft_shoreditch: "food then a soft drink in Shoreditch for 4",
  coffee_clapham: "coffee and a catch-up in Clapham for 2",
  chill_spoons_clapham: "chill Wetherspoons in Clapham for 3",
};

export const DESCRIBE_FIRST_CHIPS: readonly string[] = DESCRIBE_FIRST_CHIP_KEYS.map(
  (key) => DESCRIBE_FIRST_CHIP_QUERIES[key],
);

export default function PlanDescribeFirst({
  onSubmit,
  onGuideMeInstead,
}: {
  onSubmit: (query: string) => void;
  onGuideMeInstead: () => void;
}) {
  const [query, setQuery] = useState("");

  function submit() {
    const trimmed = query.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit();
  }

  function pickChip(key: DescribeFirstChipKey) {
    trackEvent("plan_describe_chip_selected", { chip: key });
    onSubmit(DESCRIBE_FIRST_CHIP_QUERIES[key]);
  }

  return (
    <section className="planDescribeFirst" aria-labelledby="plan-describe-first-title">
      <h2 id="plan-describe-first-title">What&rsquo;s the plan?</h2>
      {/* Plain markup, not a form: this whole surface already sits inside
          PlanComposerForm's own <form>, and a nested <form> is invalid HTML
          that browsers silently reparent, breaking native submission. */}
      <div className="planDescribeFirst__form">
        <label className="planComposer__srOnly" htmlFor="plan-describe-first-query">Describe the outing</label>
        <input
          id="plan-describe-first-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="coffee and a catch-up in Clapham for 2"
          maxLength={500}
        />
        <button type="button" onClick={submit} disabled={!query.trim()}>Make a plan</button>
      </div>
      <div className="planDescribeFirst__chips" role="group" aria-label="Try an example">
        {DESCRIBE_FIRST_CHIP_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="planDescribeFirst__chip"
            onClick={() => pickChip(key)}
          >
            {DESCRIBE_FIRST_CHIP_QUERIES[key]}
          </button>
        ))}
      </div>
      <button type="button" className="planDescribeFirst__guide" onClick={onGuideMeInstead}>
        Guide me instead
      </button>
    </section>
  );
}
