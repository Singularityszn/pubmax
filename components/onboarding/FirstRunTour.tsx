"use client";

// First-run onboarding tour — a one-time, dismissible welcome that orients a
// first-timer to the three core moves: the map (find pints near you), DROP
// (log/share a pint — the signature verb), and Discover (drinks, prices,
// crawls). Complementary to the city picker and the map band-onboarding chip;
// it does NOT duplicate the city flow.
//
// Gating: useSyncExternalStore reads hasSeenTour() reactively; a mount guard
// keeps the first client render null (matches the SSR "seen" snapshot, so no
// hydration mismatch). Once dismissed we play an exit animation, then
// markTourSeen() — which flips the store and unmounts. Renders nothing on the
// server, for returning users, or off the /map surfaces (see
// shouldShowFirstRunTour in lib/firstRunTour.ts) — the tour spotlights the
// map + mobile tab bar, so landing/tonight/feed/pint-index/etc. render clean.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { usePathname } from "next/navigation";

import { tourSpotlightColumn } from "@/components/nav/MobileTabBar";

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
import { readMobileMapSession } from "@/lib/mobileShell";
import { trackEvent } from "@/lib/analytics";
import "./firstRunTour.css";

type TabTarget = "map" | "drop" | "discover" | null;

type TourStep = {
  /** Short overline tag, e.g. THE MAP. */
  eyebrow: string;
  title: string;
  body: string;
  /** Which mobile tab to softly spotlight, if any. */
  target: TabTarget;
};

// Keep it SHORT — four beats, one line each. Sentence case, warm and decisive.
const STEPS: readonly TourStep[] = [
  {
    eyebrow: "Welcome",
    title: "PUBMAXXING",
    body: "Real pint prices on a live map, and the stories behind every round.",
    target: null,
  },
  {
    eyebrow: "The map",
    title: "Find pints near you",
    body: "See who pours cheap tonight, then plan a crawl worth the walk.",
    target: "map",
  },
  {
    eyebrow: "Moment",
    title: "Keep the night",
    body: "Log what you're drinking and pass down the story. It's the signature move.",
    target: "drop",
  },
  {
    eyebrow: "Stories",
    title: "Cheapest tonight",
    body: "Browse drinks, compare prices, and steal a crawl someone already ran.",
    target: "discover",
  },
];

const LAST = STEPS.length - 1;
/** Fallback finalize delay so we unmount even if animationend never fires. */
const EXIT_MS = 260;

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
  const [step, setStep] = useState(0);
  // 1 = advancing (slide from right), -1 = going back (slide from left).
  const [dir, setDir] = useState<1 | -1>(1);
  const [closing, setClosing] = useState(false);

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
    shouldShowFirstRunTour({ mounted, seen, pathname, explicitIntent }) && tourHasPromptBudget();

  // Claim the shared budget at the moment the tour actually shows, so an
  // eligible-but-hidden tour never starves a sibling. Idempotent for the tour.
  useEffect(() => {
    if (active) claimTourPromptBudget();
  }, [active]);

  // Dismiss → play exit, then persist. Idempotent via finalizedRef, with a
  // timer fallback so reduced-motion (no animationend) still finalizes.
  // `completed` distinguishes finishing all steps (Start exploring) from an
  // early skip/close/backdrop/Esc dismissal, for the tour_complete event.
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
    if (step >= LAST) {
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
    // Only re-run when the overlay opens, not on every step.
  }, [active]);

  // Restore focus once the overlay is gone (seen flips true → unmount).
  useEffect(() => {
    if (seen && restoreFocusRef.current) {
      restoreFocusRef.current.focus?.();
      restoreFocusRef.current = null;
    }
  }, [seen]);

  // Esc closes; Tab is trapped within the card.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dismiss(false);
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
    [dismiss],
  );

  const titleId = useId();
  const bodyId = useId();

  if (!active) return null;

  const current = STEPS[step]!;
  const isLast = step === LAST;

  return (
    <div
      className={`tourScrim${closing ? " isClosing" : ""}`}
      // Backdrop click (only on the scrim itself, not the card) dismisses.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss(false);
      }}
      onKeyDown={onKeyDown}
    >
      {/* Approximate spotlight toward the real bottom tab bar (mobile only;
          CSS hides it on desktop where the tab bar is display:none). We own
          this overlay entirely — the nav components are untouched. */}
      {current.target ? (
        <div
          className="tourSpotlight"
          data-target={current.target}
          aria-hidden="true"
          // Position from the LIVE tab geometry (column index + total), not a
          // hardcoded viewport %, so the ring always sits under its real tab.
          style={
            {
              "--tour-col": tourSpotlightColumn(current.target).index,
              "--tour-cols": tourSpotlightColumn(current.target).total,
            } as CSSProperties
          }
        >
          <span className="tourSpotlightArrow" />
        </div>
      ) : null}

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

        <div className="tourStep" key={step} data-dir={dir}>
          <p className="tourEyebrow">{current.eyebrow}</p>
          <h2 id={titleId} className="tourTitle">
            {current.title}
          </h2>
          <p id={bodyId} className="tourBody">
            {current.body}
          </p>
        </div>

        <div
          className="tourDots"
          role="group"
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
          <button
            type="button"
            className="tourSkip pressable"
            onClick={step > 0 ? goBack : () => dismiss(false)}
          >
            {step > 0 ? "Back" : "Skip"}
          </button>
          <button type="button" className="tourNext pressable" onClick={goNext}>
            {isLast ? "Start exploring" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
