"use client";

import { LocateFixed, MapPin } from "lucide-react";
import { KeyboardEvent, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { Chip } from "@/components/ui/chip";
import Screen from "@/components/ui/screen";
import WantedPlanChips from "@/components/wanted/WantedPlanChips";
import { trackEvent } from "@/lib/analytics";
import { CULTURE_CRAWL_CHIPS } from "@/lib/cultureCrawl";
import { DESCRIBE_FIRST_CHIPS } from "@/lib/describeFirstChips";
import { DRY_ROUND_LABEL, DRY_ROUND_NOTE, dryRoundFromSearch, dryRoundQuery } from "@/lib/dryRound";
import { tryGetNightArea } from "@/lib/nightAreas";
import { readRememberedArea } from "@/lib/nightPatches";
import { NEAR_ME_LOCATION_OPTIONS, nearMeLocationFailure } from "@/lib/nearMeLocation";
import { inferNightContext } from "@/lib/nightPlanning";
import {
  PLAN_BUDGET_CRAWL_LABEL,
  PLAN_BUDGET_CRAWL_NOTE,
  planBudgetCrawlQuery,
} from "@/lib/planBudgetCrawl";
import { resolveDescribeChipSubmit } from "@/lib/planComposerChipFill";
import {
  PLAN_FIELD_LABEL,
  PLAN_HEADING,
  PLAN_STEP_BY_STEP_LABEL,
  PLAN_SUBMIT_LABEL,
} from "@/lib/planCopy";
import {
  locatedOneTapArea,
  oneTapLabel,
  oneTapMessage,
  oneTapQuery,
  rememberedOneTapArea,
} from "@/lib/planOneTap";
import { DEFAULT_PLAN_STOP_COUNT, normalizePlanStopCount, type PlanStopCount } from "@/lib/planStopCount";
import PlanStopCountPicker from "@/components/plan/PlanStopCountPicker";

export { DESCRIBE_FIRST_CHIPS };

/**
 * THREE EXAMPLES, NOT ELEVEN. The field is the way in; examples only show what
 * to type. Two pub nights and one Culture Crawl, in one row, all from the closed
 * sets (the full lists still serve `?occasion=` links and Tonight).
 */
export const DESCRIBE_FIRST_SHOWN_EXAMPLES: readonly { key: string; label: string; query: string; culture: boolean }[] = [
  ...DESCRIBE_FIRST_CHIPS.slice(0, 2).map((query) => ({ key: query, label: query, query, culture: false })),
  ...CULTURE_CRAWL_CHIPS.slice(0, 1).map((chip) => ({ key: chip.id, label: chip.label, query: chip.query, culture: true })),
];

// The remembered area is read from this device's storage, which the server
// cannot see: the server and the hydrating render answer "near me", and the
// remembered area's name takes over once mounted. A slug is the snapshot so
// the store never answers a fresh object on every read.
const noSubscription = () => () => {};
function readRememberedOneTapSlug(): string {
  return rememberedOneTapArea(readRememberedArea())?.slug ?? "";
}
const serverRememberedOneTapSlug = () => "";

export default function PlanDescribeFirst({
  onSubmit,
  onGuideMeInstead,
  onQueryChange,
  onPrefillQueryChange,
  initialQuery = "",
  ready = true,
}: {
  onSubmit: (query: string, stopCount?: PlanStopCount) => void;
  /** The guide takes the count this form holds when the reader chose it or their words named it. */
  onGuideMeInstead: (stopCount?: PlanStopCount) => void;
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
  // Set when Plan it is tapped on an empty field, so the field says what it
  // needs instead of only taking the caret.
  const [emptyAsk, setEmptyAsk] = useState(false);
  const rememberedArea = tryGetNightArea(
    useSyncExternalStore(noSubscription, readRememberedOneTapSlug, serverRememberedOneTapSlug),
  );
  const [locating, setLocating] = useState(false);
  const [oneTapNote, setOneTapNote] = useState("");
  // The £20 crawl is a budget OPTION, not an example: it rides on whatever is
  // asked next, as words the generator already reads (lib/planBudgetCrawl.ts).
  const [budgetCrawl, setBudgetCrawl] = useState(false);
  // The Dry round is the second OPTION, words the generator reads the same way
  // (lib/dryRound.ts): only pubs that list an alcohol-free price.
  const [dryRound, setDryRound] = useState(false);
  const dryRoundTouched = useRef(false);
  const withOptions = (ask: string) => {
    const dry = dryRound ? dryRoundQuery(ask) : ask;
    return budgetCrawl ? planBudgetCrawlQuery(dry) : dry;
  };
  // Tonight's Dry round door opens /plan?dry=1. The server knows no address,
  // so the chip paints off and turns on once the browser holds the address.
  // A layout effect, because on a client navigation the router has written
  // the new address by then, and a render-phase read would still see the page
  // the reader came from. The reader's own tap always wins.
  useLayoutEffect(() => {
    if (dryRoundTouched.current || !dryRoundFromSearch(window.location.search)) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled && !dryRoundTouched.current) setDryRound(true);
    });
    return () => { cancelled = true; };
  }, []);
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
    onSubmit(withOptions(trimmed), stopCount);
  }

  // An untouched default carries nothing, so a count the guide already holds
  // keeps its own. A count the reader picked, or one their words named, goes.
  function guideStopCount(): PlanStopCount | undefined {
    return stopCountTouched || stopCount !== DEFAULT_PLAN_STOP_COUNT ? stopCount : undefined;
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
    onSubmit(withOptions(resolved.query), resolved.stopCount);
  }

  // One tap to a route. It submits a sentence through the same path as typing,
  // with the stop count the picker holds, and asks for location only when the
  // reader taps it with no remembered area to plan.
  function submitOneTap() {
    if (!ready || locating) return;
    setOneTapNote("");
    if (rememberedArea) {
      trackEvent("plan_one_tap", { outcome: "remembered" });
      onSubmit(withOptions(oneTapQuery(rememberedArea)), stopCount);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      trackEvent("plan_one_tap", { outcome: "no-location" });
      setOneTapNote(oneTapMessage("unsupported"));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        const area = locatedOneTapArea(coords.latitude, coords.longitude);
        if (!area) {
          trackEvent("plan_one_tap", { outcome: "out-of-range" });
          setOneTapNote(oneTapMessage("out-of-range"));
          queryInput.current?.focus();
          return;
        }
        trackEvent("plan_one_tap", { outcome: "located" });
        onSubmit(withOptions(oneTapQuery(area)), stopCount);
      },
      (error) => {
        setLocating(false);
        trackEvent("plan_one_tap", { outcome: "no-location" });
        setOneTapNote(oneTapMessage(nearMeLocationFailure(error)));
        queryInput.current?.focus();
      },
      NEAR_ME_LOCATION_OPTIONS,
    );
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
      kicker="Plan"
      title={PLAN_HEADING}
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
          {PLAN_SUBMIT_LABEL}
        </button>
      }
      secondary={
        <button
          type="button"
          aria-disabled={ready ? undefined : true}
          onClick={() => { if (ready) onGuideMeInstead(guideStopCount()); }}
        >
          {PLAN_STEP_BY_STEP_LABEL}
        </button>
      }
    >
      {/* Plain markup, not a form: this whole surface already sits inside
          PlanComposerForm's own <form>, and a nested <form> is invalid HTML
          that browsers silently reparent, breaking native submission. */}
      <div className="planDescribeFirst__form">
        <label className="planComposer__srOnly" htmlFor="plan-describe-first-query">{PLAN_FIELD_LABEL}</label>
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
            Say where, how many and what budget, for example quiet in Clapham for 4.
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
      <div className="planDescribeFirst__budget">
        <Chip
          aria-pressed={budgetCrawl}
          aria-describedby="plan-describe-first-budget-note"
          aria-disabled={ready ? undefined : true}
          onClick={() => { if (ready) setBudgetCrawl((on) => !on); }}
        >
          {PLAN_BUDGET_CRAWL_LABEL}
        </Chip>
        <p id="plan-describe-first-budget-note" className="planDescribeFirst__budgetNote">{PLAN_BUDGET_CRAWL_NOTE}</p>
      </div>
      <div className="planDescribeFirst__dry">
        <Chip
          aria-pressed={dryRound}
          aria-describedby="plan-describe-first-dry-note"
          aria-disabled={ready ? undefined : true}
          onClick={() => {
            if (!ready) return;
            dryRoundTouched.current = true;
            setDryRound((on) => !on);
          }}
        >
          {DRY_ROUND_LABEL}
        </Chip>
        <p id="plan-describe-first-dry-note" className="planDescribeFirst__budgetNote">{DRY_ROUND_NOTE}</p>
      </div>
      {/* Gone once the reader types: their words are the plan, and a tap that
          replaced them would be the chip rule broken (see submitChip). */}
      {query.trim() ? null : (
        <div className="planDescribeFirst__oneTap">
          <button
            type="button"
            className="planDescribeFirst__chip planDescribeFirst__chip--oneTap"
            aria-disabled={ready && !locating ? undefined : true}
            aria-busy={locating || undefined}
            onClick={submitOneTap}
          >
            {/* The same two marks the step-by-step area question uses. */}
            {rememberedArea ? <MapPin size={16} aria-hidden="true" /> : <LocateFixed size={16} aria-hidden="true" />}
            {locating ? "Finding where you are…" : oneTapLabel(rememberedArea)}
          </button>
          {oneTapNote ? (
            <p className="planDescribeFirst__oneTapNote" role="status">{oneTapNote}</p>
          ) : null}
        </div>
      )}
      <WantedPlanChips ready={ready} onPick={submitChip} />
      <div className="planDescribeFirst__chips" role="group" aria-label="Try an example">
        {DESCRIBE_FIRST_SHOWN_EXAMPLES.map((example) => (
          <button
            key={example.key}
            type="button"
            className={example.culture ? "planDescribeFirst__chip planDescribeFirst__chip--culture" : "planDescribeFirst__chip"}
            aria-disabled={ready ? undefined : true}
            onClick={() => submitChip(example.query)}
          >
            {example.label}
          </button>
        ))}
      </div>
    </Screen>
  );
}
