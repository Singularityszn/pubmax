export type HeritageDateType =
  | "founding"
  | "first_mention"
  | "construction"
  | "reopening"
  | "associated_event"
  | "unknown";

export type HeritageDatePrecision = "year" | "century";

export type HeritageDateRule = {
  id: string;
  type: HeritageDateType;
  label: string;
  pattern: RegExp;
};

export type HeritageDateCandidate = {
  value: string;
  precision: HeritageDatePrecision;
  sortYear: number;
  index: number;
};

export type HeritageDate = {
  value: string;
  precision: HeritageDatePrecision;
  type: HeritageDateType;
  label: string | null;
  ageSortYear: number | null;
};

export const HERITAGE_DATE_TYPES: readonly HeritageDateType[];
export const AGE_EVIDENCE_DATE_TYPES: readonly HeritageDateType[];
export const HERITAGE_DATE_CUE_WINDOW: number;
export const HERITAGE_DATE_RULES: readonly HeritageDateRule[];

export function heritageDateIsAgeEvidence(type: string | null | undefined): boolean;
export function heritageDateClauseAround(
  text: string | null | undefined,
  index: number,
): { clause: string; index: number };
export function heritageDateCandidates(
  text: string | null | undefined,
): HeritageDateCandidate[];
export function heritageDateRuleFor(
  clause: string,
  dateIndex?: number,
): HeritageDateRule | null;
export function heritageDateLabel(
  date: { value?: string | null; labelVerb?: string | null } | null | undefined,
): string | null;
export function classifyHeritageDate(
  text: string | null | undefined,
): HeritageDate | null;
