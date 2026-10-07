"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";

import Screen from "@/components/ui/screen";
import WantedPlanChips from "@/components/wanted/WantedPlanChips";
import { CULTURE_CRAWL_CHIPS, CULTURE_CRAWL_MISSION } from "@/lib/cultureCrawl";
import { DESCRIBE_FIRST_CHIPS } from "@/lib/describeFirstChips";
import { inferNightContext } from "@/lib/nightPlanning";
import { resolveDescribeChipSubmit } from "@/lib/planComposerChipFill";
import { normalizePlanStopCount, type PlanStopCount } from "@/lib/planStopCount";
import PlanStopCountPicker from "@/components/plan/PlanStopCountPicker";

export { DESCRIBE_FIRST_CHIPS };

export default function PlanDescribeFirst({
  onSubmit,
  onGuideMeInstead,
  onQueryChange,
  onPrefillQueryChange,
  initialQuery = "",
  ready = true,
}: {
  onSubmit: (query: string, stopCount?: PlanStopCount) => void;
  onGuideMeInstead: () => void;
  onQueryChange?: (query: string) => void;
  /** External handoffs only: URL or Ask prefills while the field stays untouched. */
  onPrefillQueryChange?: (query: string) => void;
  /** Prefill from a confirmed Night OS Ask draft_plan proposal. */
  initialQuery?: string;
  /**
   * False on the server-painted form PlanComposer replaces once it hydrates.
   * That form is thrown away with whatever was typed into it, so until the
   * real one mounts the field reads only and no action is available.
   */
  ready?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery.slice(0, 500));
  const [stopCount, setStopCount] = useState<PlanStopCount>(normalizePlanStopCount(inferNightContext(initialQuery).context.stopCount));
  // The prefill arrives AFTER mount: the composer reads the URL in an effect,
  // so an `?occasion=` deep link would otherwise land on an empty field and
  // read as a broken destination. Adopt a later prefill only while the field is
  // untouched, never over something the visitor typed.
  const [touched, setTouched] = useState(false);
  const [stopCountTouched, setStopCountTouched] = useState(false);
  const appliedPrefill = useRef(initialQuery);
  const reportedPrefill = useRef<string | null>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  // Set when Sort it is tapped on an empty field, so the field says what it
  // needs instead of only taking the caret.
  const [emptyAsk, setEmptyAsk] = useState(false);
  const onQueryChangeRef = useRef(onQueryChange);
  const onPrefillQueryChangeRef = useRef(onPrefillQueryChange);
  useEffect(() => {
    onQueryChangeRef.current = onQueryChange;
  }, [onQueryChange]);
  useEffect(() => {
    onPrefillQueryChangeRef.current = onPrefillQueryChange;
  }, [onPrefillQueryChange]);
  useEffect(() => {
    const nextQuery = initialQuery.slice(0, 500);
    if (!nextQuery || reportedPrefill.current === nextQuery) return;
    reportedPrefill.current = nextQuery;
    onPrefillQueryChangeRef.current?.(nextQuery);
  }, [initialQuery]);
  useEffect(() => {
    if (touched || initialQuery === appliedPrefill.current) return;
    appliedPrefill.current = initialQuery;
    const nextQuery = initialQuery.slice(0, 500);
    const nextStopCount = normalizePlanStopCount(inferNightContext(initialQuery).context.stopCount);
    let cancelled = false;
    // Prefill is an external handoff. Defer its state adoption so React 19 does
    // not treat the effect as a synchronous render cascade.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setQuery(nextQuery);
      if (!stopCountTouched) setStopCount(nextStopCount);
      if (nextQuery && reportedPrefill.current !== nextQuery) {
        reportedPrefill.current = nextQuery;
        onPrefillQueryChangeRef.current?.(nextQuery);
      }
    });
    return () => { cancelled = true; };
  }, [initialQuery, stopCountTouched, touched]);

  function submit(queryOverride = query) {
    if (!ready) return;
    const trimmed = queryOverride.trim();
    if (!trimmed) return;
    onSubmit(trimmed, stopCount);
  }

  function submitChip(value: string) {
    if (!ready) return;
    const chipInferredStopCount = normalizePlanStopCount(inferNightContext(value).context.stopCount);
    const hadTypedQuery = Boolean(query.trim());
    const resolved = resolveDescribeChipSubmit({
      query,
      stopCountTouched,
      stopCount,
      chipText: value,
      chipInferredStopCount,
    });
    if (!stopCountTouched) setStopCount(resolved.stopCount);
    // Typed text wins: a chip may fill an empty field and submit, but it must
    // never wipe or auto-submit over a query the drinker already typed.
    if (hadTypedQuery) return;
    onSubmit(resolved.query, resolved.stopCount);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit();
  }

  return (
    /* The route's head (docs/design/LAUNCH_SCREENS.md): kicker, the h1, the
       ask, and ONE painted action, the submit control of this form. The
       Screen owns the heading, so app/plan/page.tsx prints none of its own.
       A route-owned rule in app/plan/plan.css seats the field between the
       heading and the actions, the order a form reads in. */
    <Screen
      as="section"
      className="planDescribeFirst planPage__intro"
      kicker="Sort the outing"
      title={<>Describe the outing. We&rsquo;ll put it in order.</>}
      titleId="plan-describe-first-title"
      primary={
        // Never disabled: with nothing typed, the tap says what to type and
        // puts the caret in the field, which is the one thing left to do.
        <button
          type="button"
          aria-disabled={ready ? undefined : true}
          onClick={() => {
            if (query.trim()) {
              submit();
              return;
            }
            if (!ready) return;
            setEmptyAsk(true);
            queryInput.current?.focus();
          }}
        >
          Sort it
        </button>
      }
      secondary={
        <button
          type="button"
          aria-disabled={ready ? undefined : true}
          onClick={() => { if (ready) onGuideMeInstead(); }}
        >
          Guide me instead
        </button>
      }
    >
      {/* Plain markup, not a form: this whole surface already sits inside
          PlanComposerForm's own <form>, and a nested <form> is invalid HTML
          that browsers silently reparent, breaking native submission. */}
      <div className="planDescribeFirst__form">
        <label className="planComposer__srOnly" htmlFor="plan-describe-first-query">Describe the outing</label>
        <input
          ref={queryInput}
          id="plan-describe-first-query"
          type="text"
          value={query}
          readOnly={!ready}
          aria-invalid={emptyAsk && !query.trim() ? true : undefined}
          aria-describedby={emptyAsk && !query.trim() ? "plan-describe-first-empty" : undefined}
          onChange={(event) => {
            setTouched(true);
            setEmptyAsk(false);
            const value = event.target.value;
            setQuery(value);
            onQueryChange?.(value);
            if (!stopCountTouched) {
              setStopCount(normalizePlanStopCount(inferNightContext(value).context.stopCount));
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Quiet in Clapham for 4"
          maxLength={500}
        />
        {emptyAsk && !query.trim() ? (
          <p id="plan-describe-first-empty" className="planDescribeFirst__empty" role="alert">
            Say where and who with, for example quiet in Clapham for 4.
          </p>
        ) : null}
      </div>
      <PlanStopCountPicker
        value={stopCount}
        ready={ready}
        onChange={(next) => {
          setStopCountTouched(true);
          setStopCount(next);
        }}
      />
      <WantedPlanChips ready={ready} onPick={submitChip} />
      <div className="planDescribeFirst__culture" role="group" aria-label="Culture Crawl">
        <p className="planDescribeFirst__cultureLead">{CULTURE_CRAWL_MISSION}</p>
        <div className="planDescribeFirst__cultureChips">
          {CULTURE_CRAWL_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="planDescribeFirst__chip planDescribeFirst__chip--culture"
              aria-disabled={ready ? undefined : true}
              onClick={() => submitChip(chip.query)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
      <div className="planDescribeFirst__chips" role="group" aria-label="Try an example">
        {DESCRIBE_FIRST_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            className="planDescribeFirst__chip"
            aria-disabled={ready ? undefined : true}
            onClick={() => submitChip(chip)}
          >
            {chip}
          </button>
        ))}
      </div>
    </Screen>
  );
}
