"use client";

// The question and answer panels of the first-run journey (lib/onboardingFlow.ts
// names the steps and the copy). Each panel is one question with its reason.
// The one painted primary, the shape docs/design/LAUNCH_SCREENS.md asks of a
// screen, sits in FirstRunOnboarding's pinned action bar. State lives there too;
// these only paint and report taps.

import { Check, ShieldCheck } from "lucide-react";

import { NEAR_PRICE_TRUST_CAPTION } from "@/lib/nearPriceTrust";
import {
  BUDGET_CHOICES,
  BUDGET_QUESTION,
  LOCATION_PRIMER,
  type BudgetChoiceId,
  type OnboardingResult,
} from "@/lib/onboardingFlow";
import { NIGHT_PATCHES } from "@/lib/nightPatches";
import { formatGbp } from "@/lib/formatGbp";
import type { NearMeCard } from "@/lib/nearMeAnswer";

function PrivacyLine({ children }: { children: string }) {
  return (
    <p className="firstRunPrivacy">
      <ShieldCheck size={16} aria-hidden="true" />
      {children}
    </p>
  );
}

export function BudgetPanel({
  budget,
  onChoose,
}: {
  budget: BudgetChoiceId | null;
  onChoose: (id: BudgetChoiceId) => void;
}) {
  return (
    <>
      <p className="firstRunEyebrow">Your pint</p>
      <h1 className="firstRunQuestion">{BUDGET_QUESTION.title}</h1>
      <p className="firstRunLead">{BUDGET_QUESTION.why}</p>

      <div className="firstRunChoiceGrid" role="group" aria-label="What a fair pint costs">
        {BUDGET_CHOICES.map((choice) => {
          const selected = budget === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              className={`firstRunChoice pressable${selected ? " isSelected" : ""}`}
              aria-pressed={selected}
              onClick={() => onChoose(choice.id)}
            >
              <span>{choice.label}</span>
              {selected ? <Check size={18} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      <PrivacyLine>{BUDGET_QUESTION.privacy}</PrivacyLine>
    </>
  );
}

export type LocateState = "idle" | "requesting" | "denied" | "unavailable" | "outside";

const LOCATE_NOTE: Record<Exclude<LocateState, "idle" | "requesting">, string> = {
  denied: "No location, no problem. Pick where you're drinking.",
  unavailable: "We couldn't find you just now. Pick where you're drinking.",
  outside: "We don't list prices where you are yet. Pick a London patch.",
};

export function LocationPanel({
  state,
  showPatches,
  onShowPatches,
  onPickPatch,
}: {
  state: LocateState;
  showPatches: boolean;
  onShowPatches: () => void;
  onPickPatch: (id: string) => void;
}) {
  return (
    <>
      <p className="firstRunEyebrow">Near you</p>
      <h1 className="firstRunQuestion">{LOCATION_PRIMER.title}</h1>
      <p className="firstRunLead">{LOCATION_PRIMER.why}</p>
      <PrivacyLine>{LOCATION_PRIMER.privacy}</PrivacyLine>

      {state !== "idle" && state !== "requesting" ? (
        <p className="firstRunNote" role="status">
          {LOCATE_NOTE[state]}
        </p>
      ) : null}

      {showPatches ? (
        <div className="firstRunPatchPicker">
          <p className="firstRunPatchLabel" id="firstRunPatchLabel">
            Or pick where you&rsquo;re drinking
          </p>
          <div
            className="firstRunChoiceGrid firstRunPatchGrid"
            role="group"
            aria-labelledby="firstRunPatchLabel"
          >
            {NIGHT_PATCHES.map((patch) => (
              <button
                key={patch.id}
                type="button"
                className="firstRunChoice pressable"
                onClick={() => onPickPatch(patch.id)}
              >
                <span>{patch.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button type="button" className="firstRunQuiet pressable" onClick={onShowPatches}>
          Pick a London patch instead
        </button>
      )}
    </>
  );
}

function walkLabel(card: NearMeCard): string | null {
  return typeof card.walkMinutes === "number" ? `${card.walkMinutes} min walk` : null;
}

function budgetLine(result: OnboardingResult, budgetLabel: string | null): string | null {
  if (result.withinBudget === null || !budgetLabel) return null;
  const walk = `within a ${result.walkMinutes} minute walk`;
  const limit = budgetLabel.toLowerCase();
  if (result.withinBudget === 0) return `No pubs ${walk} come in at ${limit}.`;
  return result.withinBudget === 1
    ? `1 pub ${walk} comes in at ${limit}.`
    : `${result.withinBudget} pubs ${walk} come in at ${limit}.`;
}

export function ResultPanel({
  status,
  result,
  areaLabel,
  budgetLabel,
  onChangeBudget,
  onChangeArea,
}: {
  status: "loading" | "ready" | "empty" | "unavailable";
  result: OnboardingResult | null;
  /** "near you" for a located read, or the patch the reader picked. */
  areaLabel: string;
  budgetLabel: string | null;
  onChangeBudget: () => void;
  onChangeArea: () => void;
}) {
  if (status === "loading") {
    return (
      <div aria-busy="true">
        <p className="firstRunEyebrow">Your answer</p>
        <h1 className="firstRunQuestion">Working out your nearest pints.</h1>
        <p className="firstRunLead">Checking listed prices {areaLabel}.</p>
      </div>
    );
  }

  // A read we could not run says so. It never claims the area has no prices.
  if (status === "unavailable") {
    return (
      <>
        <p className="firstRunEyebrow">Your answer</p>
        <h1 className="firstRunQuestion">We couldn&rsquo;t load prices just now.</h1>
        <p className="firstRunLead">Check your connection and try again.</p>
        <div className="firstRunQuietRow">
          <button type="button" className="firstRunQuiet pressable" onClick={onChangeArea}>
            Change area
          </button>
        </div>
      </>
    );
  }

  const best = result?.best ?? null;
  if (status === "empty" || !best) {
    return (
      <>
        <p className="firstRunEyebrow">Your answer</p>
        <h1 className="firstRunQuestion">No listed prices {areaLabel} yet.</h1>
        <p className="firstRunLead">Pick another London patch and we&rsquo;ll look there.</p>
      </>
    );
  }

  const walk = walkLabel(best);
  const budgetNote = budgetLine(result!, budgetLabel);
  return (
    <>
      <p className="firstRunEyebrow">
        {result!.widened ? "Nearest priced pubs" : "Cheapest listed"} {areaLabel}
      </p>
      <h1 className="firstRunQuestion">
        {formatGbp(best.cheapestPrice)} at {best.name}.
      </h1>
      <p className="firstRunLead">
        {[best.borough, walk].filter(Boolean).join(", ")}.
        {budgetNote ? ` ${budgetNote}` : ""}
      </p>

      {result!.others.length > 0 ? (
        <ul className="firstRunPintList" aria-label="Next cheapest nearby">
          {result!.others.map((card) => (
            <li key={card.id}>
              <strong>{card.name}</strong>
              <span>{[card.borough, walkLabel(card)].filter(Boolean).join(", ")}</span>
              <b>{formatGbp(card.cheapestPrice)}</b>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="firstRunPermissionNote firstRunTrustNote">{NEAR_PRICE_TRUST_CAPTION}</p>

      <div className="firstRunQuietRow">
        <button type="button" className="firstRunQuiet pressable" onClick={onChangeBudget}>
          Change budget
        </button>
        <button type="button" className="firstRunQuiet pressable" onClick={onChangeArea}>
          Change area
        </button>
      </div>
    </>
  );
}
