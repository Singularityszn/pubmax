import { inferNightContext, type NightContext } from "@/lib/nightPlanning";
import type { NightAreaSlug } from "@/lib/nightAreas";
import { applyTemplate } from "@/lib/planComposerHandoff";
import { nightAreaForPlanIntakePatch, type PlanIntakeDraft } from "@/lib/planIntake";
import { NIGHT_PATCHES, type NightPatchId } from "@/lib/nightPatches";
import { normalizePlanStopCount, type PlanStopCount } from "@/lib/planStopCount";
import type { PlanTemplate } from "@/lib/planTemplates";

/** Keep non-empty user text; only empty fields accept a chip or template suggestion. */
export function fillEmptyText(current: string, suggestion: string): string {
  return current.trim() ? current : suggestion;
}

export function resolveDescribeChipSubmit(input: {
  touched: boolean;
  query: string;
  stopCountTouched: boolean;
  stopCount: PlanStopCount;
  chipText: string;
  chipInferredStopCount: PlanStopCount;
}): { query: string; stopCount: PlanStopCount } {
  const userQuery = input.query.trim();
  const query = input.touched && userQuery ? userQuery : input.chipText;
  const stopCount = input.stopCountTouched ? input.stopCount : input.chipInferredStopCount;
  return { query, stopCount };
}

export function nightPatchIdForNightArea(slug: NightAreaSlug): NightPatchId | null {
  for (const patch of NIGHT_PATCHES) {
    if (nightAreaForPlanIntakePatch(patch.id) === slug) return patch.id;
  }
  return null;
}

/** A submitted describe-first query owns intake area over a geo or remembered seed. */
export function syncPlanIntakeAreaFromQuery(draft: PlanIntakeDraft, query: string): PlanIntakeDraft {
  const slug = inferNightContext(query).context.nightArea;
  if (!slug) return draft;
  const patchId = nightPatchIdForNightArea(slug);
  if (!patchId) return draft;
  if (draft.answers.area === patchId) return draft;
  const settledSteps = draft.settledSteps.includes("area")
    ? draft.settledSteps
    : [...draft.settledSteps, "area"];
  return {
    ...draft,
    answers: { ...draft.answers, area: patchId },
    currentStep: draft.currentStep === "area" ? "time-window" : draft.currentStep,
    settledSteps,
  };
}

export function composerGeolocationMaySeedIntake(input: {
  showsDescribeFirst: boolean;
  hasQueryText: boolean;
}): boolean {
  return !input.showsDescribeFirst && !input.hasQueryText;
}

export function mergeInferredNightContext(
  inferred: NightContext,
  explicit: Partial<NightContext>,
): NightContext {
  return { ...inferred, ...explicit };
}

/** Align stop count with the generated route so Lock it in can enable. */
export function reconcileGeneratedNightContext(
  inferred: NightContext,
  explicit: Partial<NightContext>,
  generatedStopCount: number,
): NightContext {
  const merged = mergeInferredNightContext(inferred, explicit);
  return {
    ...merged,
    stopCount: normalizePlanStopCount(generatedStopCount),
  };
}

export function mergePlanTemplateFields(input: {
  title: string;
  conciergeQuery: string;
  conciergeNote: string;
  template: PlanTemplate;
  hasAcceptedGeography: boolean;
}): { title: string; conciergeQuery: string; conciergeNote: string } {
  const applied = applyTemplate(input.template, input.hasAcceptedGeography);
  return {
    title: fillEmptyText(input.title, applied.title),
    conciergeQuery: applied.geographyLocked
      ? input.conciergeQuery
      : fillEmptyText(input.conciergeQuery, applied.conciergeQuery),
    conciergeNote: fillEmptyText(input.conciergeNote, input.template.blurb),
  };
}
