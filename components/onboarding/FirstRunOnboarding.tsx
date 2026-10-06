"use client";

import type { Route } from "next";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, MapPinned, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BudgetPanel,
  LocationPanel,
  ResultPanel,
  type LocateState,
} from "@/components/onboarding/OnboardingPanels";
import PalPortrait from "@/components/pal/PalPortrait";
import { trackEvent } from "@/lib/analytics";
import { writePreferredCity } from "@/lib/cityPreference";
import {
  FIRST_RUN_COMPANIONS,
  claimTourPromptBudget,
  markTourSeen,
  readFirstRunCompanion,
  releaseTourPromptBudget,
  writeFirstRunCompanion,
  type FirstRunCompanion,
} from "@/lib/firstRunTour";
import { formatGbp } from "@/lib/formatGbp";
import {
  WIDENED_RADIUS_KM,
  pricedWithinWalk,
  rankNearMe,
  type NearMeCard,
} from "@/lib/nearMeAnswer";
import { NIGHT_PATCHES } from "@/lib/nightPatches";
import {
  BUDGET_CHOICES,
  ONBOARDING_STEPS,
  nextOnboardingStep,
  onboardingResult,
  onboardingStepNumber,
  previousOnboardingStep,
  readBudgetChoice,
  readOnboardingPatch,
  writeBudgetChoice,
  writeOnboardingPatch,
  writePlannerHandoff,
  type BudgetChoiceId,
  type OnboardingOrigin,
  type OnboardingStep,
} from "@/lib/onboardingFlow";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import { readHistoryStep, useStepHistory } from "@/lib/useStepHistory";
import { loadSlimVenuesForCityResult, type SlimVenueLoadResult } from "@/lib/venuesSlim";

type ReviewedArea = {
  name: string;
  transportAnchor: string;
};

type Answer =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "unavailable" }
  | { status: "ready"; cards: NearMeCard[]; widened: boolean; walkPrices: number[] };

// The same read /near makes: a coarse fix, a short wait, a recent one is fine.
const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 7000,
  maximumAge: 60_000,
};

/**
 * The map reads its arrival query once, when it mounts. A client navigation
 * can mount it before the address bar holds `?plan=1`, so the planner stayed
 * shut and the handoff below was never read. A document load always carries
 * the query, so this one step leaves the app router.
 */
function openPlannerDocument(): void {
  window.location.assign(new URL("/map?plan=1", window.location.origin).href);
}

function patchOrigin(id: string | null): OnboardingOrigin | null {
  const patch = NIGHT_PATCHES.find((candidate) => candidate.id === id);
  return patch ? { kind: "patch", ...patch } : null;
}

export default function FirstRunOnboarding({
  reviewedAreas,
  skipHref,
  openPlanner = openPlannerDocument,
}: {
  reviewedAreas: ReviewedArea[];
  /** Where Skip lands: where the reader was going before the journey. */
  skipHref: Route;
  /** How "Plan my night" reaches the planner. Tests replace the page load. */
  openPlanner?: () => void;
}) {
  const router = useRouter();
  // A reload lands on the step the reader was on. The answer screen is rebuilt
  // from a read that is gone, so a reload there goes back to the question.
  const [step, setStep] = useState<OnboardingStep>(() => {
    const recorded = readHistoryStep(ONBOARDING_STEPS);
    return recorded === "result" ? "location" : (recorded ?? "london");
  });
  const [companion, setCompanion] = useState<FirstRunCompanion>("robin");
  const [budget, setBudget] = useState<BudgetChoiceId | null>(null);
  const [locateState, setLocateState] = useState<LocateState>("idle");
  const [showPatches, setShowPatches] = useState(false);
  // A reload keeps the patch the reader chose, so the planner still opens on it.
  const [origin, setOrigin] = useState<OnboardingOrigin | null>(() =>
    readHistoryStep(ONBOARDING_STEPS) ? patchOrigin(readOnboardingPatch()) : null,
  );
  const [answer, setAnswer] = useState<Answer>({ status: "loading" });
  // A reader who taps a patch twice, picks a patch while the location prompt is
  // open, or backs out mid-read, must not see the older answer land over the
  // newer one.
  const answerGeneration = useRef(0);

  useEffect(() => {
    claimTourPromptBudget();
    const remembered = readFirstRunCompanion();
    if (remembered) void Promise.resolve().then(() => setCompanion(remembered));
    const rememberedBudget = readBudgetChoice();
    if (rememberedBudget) void Promise.resolve().then(() => setBudget(rememberedBudget));
    const releaseBudget = () => releaseTourPromptBudget();
    window.addEventListener("pagehide", releaseBudget);
    return () => {
      window.removeEventListener("pagehide", releaseBudget);
      releaseBudget();
    };
  }, []);

  // Each step is a new screen, so it opens at the top. Otherwise a short phone
  // carries the last step's scroll and the progress bar and Skip start hidden.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  const selectedCompanion = useMemo(
    () => FIRST_RUN_COMPANIONS.find((choice) => choice.id === companion) ?? null,
    [companion],
  );
  const appearance = useMemo(
    () => ({
      ...DEFAULT_PAL_DRAFT.appearance,
      species: companion ?? DEFAULT_PAL_DRAFT.appearance.species,
    }),
    [companion],
  );
  const budgetChoice = BUDGET_CHOICES.find((choice) => choice.id === budget) ?? null;
  const result = useMemo(
    () =>
      answer.status === "ready"
        ? onboardingResult(answer.cards, budget, answer.widened, answer.walkPrices)
        : null,
    [answer, budget],
  );

  const goTo = useCallback((next: OnboardingStep | null) => {
    if (next) setStep(next);
  }, []);

  function confirmLondon() {
    writePreferredCity("london");
    goTo(nextOnboardingStep("london"));
  }

  function chooseBudget(choice: BudgetChoiceId) {
    setBudget(choice);
    writeBudgetChoice(choice);
  }

  function chooseCompanion(choice: FirstRunCompanion) {
    setCompanion(choice);
    writeFirstRunCompanion(choice);
  }

  // Any newer answer, or a step away from the location screen, makes a pending
  // fix or venue read stale, and a prompt left open no longer holds the button.
  const beginAnswer = useCallback(() => {
    setLocateState((state) => (state === "requesting" ? "idle" : state));
    return ++answerGeneration.current;
  }, []);

  // Rank the priced pubs around `from` and move to the result. A read we could
  // not run is not an empty area: it is its own answer, with a retry.
  const readAnswer = useCallback(async (from: OnboardingOrigin) => {
    const generation = beginAnswer();
    setOrigin(from);
    writeOnboardingPatch(from.kind === "patch" ? from.id : null);
    setAnswer({ status: "loading" });
    setStep("result");
    let read: SlimVenueLoadResult;
    try {
      read = await loadSlimVenuesForCityResult("london");
    } catch {
      read = { rows: [], status: "unavailable" };
    }
    if (generation !== answerGeneration.current) return;
    if (read.status === "unavailable") {
      setAnswer({ status: "unavailable" });
      return;
    }
    const { rows } = read;
    const ranked = rankNearMe(from.lat, from.lng, rows);
    // The ranker falls back to the nearest priced pubs however far they are,
    // so a fix in Manchester would be answered with London. Past the widened
    // ring nothing is near the reader.
    const inReach = ranked.cards.some(
      (card) => card.distanceKm !== undefined && card.distanceKm <= WIDENED_RADIUS_KM,
    );
    if (!inReach) {
      if (from.kind === "location") {
        // Located fine, nothing priced in range: say so and offer the patches.
        setLocateState("outside");
        setShowPatches(true);
        setStep("location");
        return;
      }
      setAnswer({ status: "empty" });
      return;
    }
    setAnswer({
      status: "ready",
      cards: ranked.cards,
      widened: ranked.scope === "widened",
      walkPrices: pricedWithinWalk(from.lat, from.lng, rows),
    });
  }, [beginAnswer]);

  // Browser Back and Forward walk the steps the reader has seen. A step the
  // reader reaches that way can name no answer that is not here: the result
  // needs a place to read from, and leaving it drops any read still in flight,
  // so coming back to an answer that never landed reads it again.
  const stepHistory = useStepHistory(
    step,
    (next) => {
      if (next === "result" && origin) {
        if (answer.status === "loading") void readAnswer(origin);
        else setStep("result");
        return;
      }
      beginAnswer();
      setStep(next === "result" ? "location" : next);
    },
    { steps: ONBOARDING_STEPS, first: "london" },
  );

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocateState("unavailable");
      setShowPatches(true);
      return;
    }
    const generation = beginAnswer();
    setLocateState("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (generation !== answerGeneration.current) return;
        setLocateState("idle");
        void readAnswer({
          kind: "location",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        if (generation !== answerGeneration.current) return;
        setLocateState(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
        setShowPatches(true);
      },
      GEO_OPTIONS,
    );
  }

  function pickPatch(id: string) {
    const patch = patchOrigin(id);
    if (patch) void readAnswer(patch);
  }

  function skipOnboarding() {
    markTourSeen();
    trackEvent("tour_complete", { completed: false });
    releaseTourPromptBudget();
    stepHistory.leave(() => router.replace(skipHref));
  }

  function startPlan() {
    if (!companion) return;
    writePreferredCity("london");
    writeFirstRunCompanion(companion);
    markTourSeen();
    trackEvent("tour_complete", { completed: true });
    // Onboarding and push never overlap. The route generator is the first
    // action allowed to arm the native permission explainer.
    releaseTourPromptBudget();
    // The planner opens on the patch and budget the reader just gave.
    writePlannerHandoff({
      patch: origin?.kind === "patch" ? { lat: origin.lat, lng: origin.lng } : null,
      budget,
    });
    stepHistory.leave(openPlanner);
  }

  const stepNumber = onboardingStepNumber(step);
  const previous = previousOnboardingStep(step);
  const areaLabel =
    origin?.kind === "patch" ? `around ${origin.label}` : "near you";

  return (
    <main
      id="main"
      // The one screen with no price to add: compose stands down here rather
      // than parking a round + over the reviewed-area list
      // (components/nav/createFab.css).
      className="firstRunOnboarding pageHidesCreateFab"
      data-stage={step}
    >
      <header className="firstRunTopbar">
        <div className="firstRunBrand" aria-label="PUBMAXXING">
          <Image src="/brand/icon.svg" alt="" width={30} height={30} priority />
          <span>PUBMAXXING</span>
        </div>
        <div
          className="firstRunProgress"
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuemin={1}
          aria-valuemax={ONBOARDING_STEPS.length}
          aria-valuenow={stepNumber}
          style={{ "--first-run-steps": ONBOARDING_STEPS.length } as React.CSSProperties}
        >
          {ONBOARDING_STEPS.map((id, index) => (
            <span
              key={id}
              className={
                index + 1 < stepNumber ? "isComplete" : index + 1 === stepNumber ? "isCurrent" : ""
              }
            />
          ))}
        </div>
        <button type="button" className="firstRunSkip pressable" onClick={skipOnboarding}>
          Skip
        </button>
      </header>

      <div className="firstRunStage" key={step}>
        <section className="firstRunVisual" aria-label={visualLabel(step)}>
          {step === "companion" ? (
            <div className="firstRunCompanionHero">
              <PalPortrait
                appearance={appearance}
                name={selectedCompanion?.label ?? "Companion preview"}
                state="noticing"
              />
              <p aria-live="polite">
                {selectedCompanion
                  ? `${selectedCompanion.label} will be in your corner for the first night.`
                  : "Pick the Pal you want in your corner for the first night."}
              </p>
            </div>
          ) : step === "budget" ? (
            <div className="firstRunFigureHero">
              <p className="firstRunFigure" aria-hidden="true">
                {budgetChoice ? (budgetChoice.ceiling ? `£${budgetChoice.ceiling}` : "Any") : "£?"}
              </p>
              <p>{budgetChoice ? `A pint at ${budgetChoice.label.toLowerCase()}.` : "Your pint, your number."}</p>
            </div>
          ) : step === "result" && result?.best ? (
            <div className="firstRunFigureHero">
              <p className="firstRunFigure" aria-hidden="true">
                {formatGbp(result.best.cheapestPrice)}
              </p>
              <p>{result.best.name}</p>
            </div>
          ) : (
            <figure className="firstRunLondonPhoto">
              <Image
                src="/landing/hero-thames.jpg"
                alt="London and the Thames viewed from above"
                fill
                priority
                sizes="(max-width: 760px) 100vw, 52vw"
              />
              <figcaption>
                {step === "location"
                  ? "Every pint near you, cheapest first."
                  : "London, with the route home kept in view."}
              </figcaption>
            </figure>
          )}
        </section>

        <section className="firstRunPanel" aria-live="polite">
          <div className="firstRunPanelInner">
            {step === "london" ? (
              <>
                <p className="firstRunEyebrow">Your city</p>
                <h1>London is ready.</h1>
                <p className="firstRunLead">
                  Start with checked routes, listed pint prices, and a clear way home.
                </p>

                <div className="firstRunAreaList" aria-label="Reviewed London route areas">
                  {reviewedAreas.map((area) => (
                    <article key={area.name}>
                      <MapPinned size={19} aria-hidden="true" />
                      {/* The stamp rides INSIDE the text block, so a short
                          phone can fold it onto the way-home line
                          (app/onboarding/onboarding.css, the short phone). */}
                      <div>
                        <strong>{area.name}</strong>
                        <span>Home via {area.transportAnchor}</span>
                        <small>PUBMAXX reviewed</small>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="firstRunActions firstRunActionsSingle">
                  <button type="button" className="firstRunPrimary pressable" onClick={confirmLondon}>
                    Use London <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
              </>
            ) : null}

            {step === "budget" ? (
              <BudgetPanel
                budget={budget}
                onChoose={chooseBudget}
                onBack={() => goTo(previous)}
                onContinue={() => goTo(nextOnboardingStep("budget"))}
              />
            ) : null}

            {step === "location" ? (
              <LocationPanel
                state={locateState}
                showPatches={showPatches}
                onLocate={locate}
                onShowPatches={() => setShowPatches(true)}
                onPickPatch={pickPatch}
                onBack={() => {
                  beginAnswer();
                  goTo(previous);
                }}
              />
            ) : null}

            {step === "result" ? (
              <ResultPanel
                status={answer.status}
                result={result}
                areaLabel={areaLabel}
                budgetLabel={budgetChoice?.ceiling ? budgetChoice.label : null}
                onConfirm={() => goTo(nextOnboardingStep("result"))}
                onRetry={() => {
                  if (origin) void readAnswer(origin);
                }}
                onChangeBudget={() => setStep("budget")}
                onChangeArea={() => {
                  setShowPatches(true);
                  setStep("location");
                }}
              />
            ) : null}

            {step === "companion" ? (
              <>
                <p className="firstRunEyebrow">Your companion</p>
                <h1>Pick your Pub Pal.</h1>
                <p className="firstRunLead">
                  Every Pal reads the same real prices and routes. Pick the one you want in your corner tonight.
                </p>

                <div className="firstRunCompanionGrid" role="group" aria-label="Choose your Pub Pal">
                  {FIRST_RUN_COMPANIONS.map((choice) => {
                    const selected = companion === choice.id;
                    return (
                      <button
                        key={choice.id}
                        type="button"
                        className={`firstRunCompanionChoice pressable${selected ? " isSelected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => chooseCompanion(choice.id)}
                      >
                        <span>{choice.label}</span>
                        <small>{choice.note}</small>
                        {selected ? <Check size={18} aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>

                <p className="firstRunPrivacy">
                  <ShieldCheck size={16} aria-hidden="true" />
                  You can name, tweak, or skip your Pal later.
                </p>

                <div className="firstRunActions">
                  <button type="button" className="firstRunBack pressable" onClick={() => goTo(previous)}>
                    <ArrowLeft size={18} aria-hidden="true" /> Back
                  </button>
                  <button
                    type="button"
                    className="firstRunPrimary pressable"
                    disabled={!companion}
                    onClick={startPlan}
                  >
                    Plan my night <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
                <p className="firstRunPermissionNote">
                  We won&rsquo;t ask about notifications until your first night&rsquo;s sorted.
                </p>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function visualLabel(step: OnboardingStep): string {
  switch (step) {
    case "companion":
      return "Companion preview";
    case "budget":
      return "Your pint budget";
    case "result":
      return "Your cheapest pint";
    case "location":
      return "London preview";
    default:
      return "London preview";
  }
}
