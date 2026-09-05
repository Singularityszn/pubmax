export type InternalLanguageRule = {
  id: string;
  why: string;
  pattern: RegExp;
};

export type InternalLanguageFinding = {
  ruleId: string;
  why: string;
  match: string;
};

export const INTERNAL_LANGUAGE_RULES: readonly InternalLanguageRule[];

export function internalLanguageFindings(
  text: string | null | undefined,
): InternalLanguageFinding[];
export function internalLanguageFinding(
  text: string | null | undefined,
): InternalLanguageFinding | null;
export function isPublishableDescription(text: string | null | undefined): boolean;
export function describeInternalLanguage(
  finding: InternalLanguageFinding | null | undefined,
): string;
