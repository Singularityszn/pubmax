export const LEGAL_REVISION_DATES = {
  terms: "2026-11-04",
  privacy: "2026-11-22",
  accountDelete: "2026-11-22",
} as const;

export function legalRevisionLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
