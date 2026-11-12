"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname } from "next/navigation";

import {
  claimTourPromptBudget,
  getTourSeenServerSnapshot,
  getTourSeenSnapshot,
  markTourSeen,
  shouldShowFirstRunTour,
  subscribeTour,
  tourHasPromptBudget,
} from "@/lib/firstRunTour";
import {
  restoredSessionHasExplicitIntent,
  searchHasExplicitMapIntent,
} from "@/lib/explicitMapIntent";
import {
  ORIENTATION_LEGEND_TITLE,
  orientationLegendRows,
} from "@/lib/mapPriceLegend";
import { readMobileMapSession } from "@/lib/mobileShell";
import { trackEvent } from "@/lib/analytics";
import { subscribePromptBudget } from "@/lib/promptBudget";
import "./firstRunTour.css";

/** Fallback finalize delay so we unmount even if animationend never fires. */
const EXIT_MS = 260;

const LEGEND_ROWS = orientationLegendRows();

type TourStep = {
  eyebrow: string;
  title: string;
  body: string;
  legend?: true;
};

const STEPS: readonly TourStep[] = [
  {
    eyebrow: "The map",
    title: ORIENTATION_LEGEND_TITLE,
    body: "Pin colour is the listed pint band. Grey means nobody has logged a price the map can trust yet.",
    legend: true,
  },
  {
    eyebrow: "Log a pint",
    title: "Paid for a pint? Log it",
    body: "Open a pub and log what you paid. Add the bill if you have it. The price shows on the map once we check a bill that matches it, or a second drinker confirms it.",
  },
  {
    eyebrow: "Been here",
    title: "Tick off your pubs",
    body: "Open a pub and save it to Been here. No dates, just the pubs. Signed in, the list shows on your profile.",
  },
  {
    eyebrow: "Plan",
    title: "One link for your mates",
    body: "Plan a crawl on listed prices and send one link to the group chat. Nobody needs an account to open it.",
  },
];

const LAST_STEP = STEPS.length - 1;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export default function FirstRunTour(): React.JSX.Element | null {
  const pathname = usePathname() ?? "";
  const seen = useSyncExternalStore(
    subscribeTour,
    getTourSeenSnapshot,
    getTourSeenServerSnapshot,
  );
  const hasPromptBudget = useSyncExternalStore(
    subscribePromptBudget,
    tourHasPromptBudget,
    () => false,
  );

  // Mount guard: first client render returns null (matching the SSR "seen"
  // snapshot) so there is never a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  // §4.7: freeze whether THIS arrival is an explicit/restored Map intent, so a
  // deep link suppresses the tour before the selected sheet mounts. Frozen at
  // mount from the arrival URL + restored session (the sentinel keeps `sel` in
  // the final URL, so the read is stable). Search params alone are enough here
  // — PlanningIntent-only arrivals carry sel/accept anyway.
  const [explicitIntent] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      searchHasExplicitMapIntent(window.location.search) ||
      restoredSessionHasExplicitIntent(readMobileMapSession())
    );
  });
  const [closing, setClosing] = useState(false);
  const [step, setStep] = useState(0);
  // 1 = forward, -1 = back. Picks the slide direction in firstRunTour.css.
  const [dir, setDir] = useState<1 | -1>(1);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const finalizedRef = useRef(false);

  // Flip the mount gate from an async microtask (never the sync effect body) per
  // react-hooks/set-state-in-effect — the repo convention (see app/feed/page.tsx).
  useEffect(() => {
    void Promise.resolve().then(() => setMounted(true));
  }, []);

  // Map-only, one-time gate (see lib/firstRunTour.ts) — AND the shared
  // one-prompt-per-session budget: don't open if a sibling surface (A2HS /
  // identity / push) already holds it. See docs/PROMPT_ORCHESTRATION.md.
  const active =
    shouldShowFirstRunTour({ mounted, seen, pathname, explicitIntent }) &&
    hasPromptBudget;

  // Claim the shared budget at the moment the tour actually shows, so an
  // eligible-but-hidden tour never starves a sibling. Idempotent for the tour.
  useEffect(() => {
    if (active) claimTourPromptBudget();
  }, [active]);

  // Dismiss → play exit, then persist. Idempotent via finalizedRef, with a
  // timer fallback so reduced-motion (no animationend) still finalizes.
  // `completed` distinguishes finishing the last step (Got it) from an early
  // skip/close/backdrop/Esc dismissal, for the tour_complete event.
  const dismiss = useCallback((completed: boolean = false) => {
    if (finalizedRef.current) return;
    setClosing(true);
    const finalize = () => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;
      trackEvent("tour_complete", { completed });
      markTourSeen();
    };
    window.setTimeout(finalize, prefersReducedMotion() ? 0 : EXIT_MS);
  }, []);

  const goNext = useCallback(() => {
    if (step >= LAST_STEP) {
      dismiss(true);
      return;
    }
    setDir(1);
    setStep(step + 1);
  }, [step, dismiss]);

  const goBack = useCallback(() => {
    if (step <= 0) return;
    setDir(-1);
    setStep(step - 1);
  }, [step]);

  // Remember the pre-open focus so we can restore it on dismiss.
  useEffect(() => {
    if (!active) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus the card so the first Tab lands inside and SR announces the dialog.
    const id = window.requestAnimationFrame(() => cardRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [active]);

  // Restore focus once the overlay is gone (seen flips true → unmount).
  useEffect(() => {
    if (seen && restoreFocusRef.current) {
      restoreFocusRef.current.focus?.();
      restoreFocusRef.current = null;
    }
  }, [seen]);

  // Esc closes, the arrow keys move between steps, Tab is trapped in the card.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dismiss(false);
        return;
      }
      if (e.key === "ArrowRight" && step < LAST_STEP) {
        e.preventDefault();
        goNext();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
        return;
      }
      if (e.key !== "Tab") return;
      const card = cardRef.current;
      if (!card) return;
      const focusables = card.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const activeEl = document.activeElement;
      if (e.shiftKey) {
        if (activeEl === first || activeEl === card) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [dismiss, goBack, goNext, step],
  );

  const titleId = useId();
  const bodyId = useId();

  if (!active) return null;

  const current = STEPS[step]!;
  const isLast = step === LAST_STEP;

  return (
    <div
      className={`tourScrim${closing ? " isClosing" : ""}`}
      // Backdrop click (only on the scrim itself, not the card) dismisses.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss(false);
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={cardRef}
        className="tourCard"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
      >
        <button
          type="button"
          className="tourClose pressable"
          onClick={() => dismiss(false)}
          aria-label="Skip the tour"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* The live region stays mounted so a screen reader hears each new
            step; the keyed child remounts to replay the step slide. */}
        <div aria-live="polite">
          <div className="tourStep" key={step} data-dir={dir}>
            <p className="tourEyebrow">{current.eyebrow}</p>
            <h2 id={titleId} className="tourTitle">
              {current.title}
            </h2>
            <p id={bodyId} className="tourBody">
              {current.body}
            </p>
            {current.legend ? (
              <ul className="tourLegend" aria-label="Pint price colours">
                {LEGEND_ROWS.map((row) => (
                  <li key={row.tone} className="tourLegendRow">
                    <i className={`mapPriceDot ${row.tone}`} aria-hidden="true" />
                    <span>{row.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <div
          className="tourDots"
          role="img"
          aria-label={`Step ${step + 1} of ${STEPS.length}`}
        >
          {STEPS.map((s, i) => (
            <span
              key={s.eyebrow}
              className={`tourDot${i === step ? " isActive" : ""}`}
              aria-hidden="true"
            />
          ))}
        </div>

        <div className="tourActions">
          {step === 0 ? (
            <button
              type="button"
              className="tourSkip pressable"
              onClick={() => dismiss(false)}
            >
              Skip
            </button>
          ) : (
            <button type="button" className="tourSkip pressable" onClick={goBack}>
              Back
            </button>
          )}
          <button type="button" className="tourNext pressable" onClick={goNext}>
            {isLast ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
