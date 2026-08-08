"use client";

import { KeyboardEvent, useState } from "react";

import WantedPlanChips from "@/components/wanted/WantedPlanChips";
import { DESCRIBE_FIRST_CHIPS } from "@/lib/describeFirstChips";

export { DESCRIBE_FIRST_CHIPS };

export default function PlanDescribeFirst({
  onSubmit,
  onGuideMeInstead,
  initialQuery = "",
}: {
  onSubmit: (query: string) => void;
  onGuideMeInstead: () => void;
  /** Prefill from a confirmed Night OS Ask draft_plan proposal. */
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery.slice(0, 500));

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
      <WantedPlanChips onPick={onSubmit} />
      <div className="planDescribeFirst__chips" role="group" aria-label="Try an example">
        {DESCRIBE_FIRST_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            className="planDescribeFirst__chip"
            onClick={() => onSubmit(chip)}
          >
            {chip}
          </button>
        ))}
      </div>
      <button type="button" className="planDescribeFirst__guide" onClick={onGuideMeInstead}>
        Guide me instead
      </button>
    </section>
  );
}
