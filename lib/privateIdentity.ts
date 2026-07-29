export const PRIVATE_IDENTITY_SEX_VALUES = [
  "female",
  "male",
  "intersex",
  "prefer_not_to_say",
] as const;

export type PrivateIdentitySex =
  (typeof PRIVATE_IDENTITY_SEX_VALUES)[number];

export function londonCalendarDate(now: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export type ContributionAgeAssessment =
  | { status: "adult" }
  | { status: "underage"; eligibleFrom: string }
  | { status: "invalid" };

export function assessContributionAge(
  value: unknown,
  now: number = Date.now(),
): ContributionAgeAssessment {
  const dateOfBirth = cleanDateOfBirth(value, now);
  if (!dateOfBirth) return { status: "invalid" };
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  const eighteenthBirthday = new Date(Date.UTC(year + 18, month - 1, day));
  const eligibleFrom = eighteenthBirthday.toISOString().slice(0, 10);
  return eligibleFrom <= londonCalendarDate(now)
    ? { status: "adult" }
    : { status: "underage", eligibleFrom };
}

export function cleanDateOfBirth(
  value: unknown,
  now: number = Date.now(),
): string | null {
  if (typeof value !== "string") return null;
  const dateOfBirth = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    dateOfBirth > londonCalendarDate(now)
  ) {
    return null;
  }
  return dateOfBirth;
}
