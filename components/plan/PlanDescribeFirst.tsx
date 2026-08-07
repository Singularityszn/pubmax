"use client";

import { KeyboardEvent, useState } from "react";

// Suggestion chips are real, working examples. Each string here was posted to
// /api/plans/generate keyless and returned a priced three-stop route before
// it was allowed to ship as a chip — an example that 422s is a lie.
const DESCRIBE_FIRST_CHIPS: readonly string[] = [
  "Quiet in Clapham for 4, not pricey",
  "cheap pints tonight in Shoreditch",
  "birthday drinks for 8 in Camden",
  "pubs screening the match tonight in Clapham",
];

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

  return (
    <section className="planDescribeFirst" aria-labelledby="plan-describe-first-title">
      <h2 id="plan-describe-first-title">What&rsquo;s the plan?</h2>
      {/* Plain markup, not a form: this whole surface already sits inside
          PlanComposerForm's own <form>, and a nested <form> is invalid HTML
          that browsers silently reparent, breaking native submission. */}
      <div className="planDescribeFirst__form">
        <label className="planComposer__srOnly" htmlFor="plan-describe-first-query">Describe the night</label>
        <input
          id="plan-describe-first-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Quiet in Clapham for 4, not pricey"
          maxLength={500}
        />
        <button type="button" onClick={submit} disabled={!query.trim()}>Plan my night</button>
      </div>
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
