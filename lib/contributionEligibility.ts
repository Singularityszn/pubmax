const DATE_OF_BIRTH_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MINIMUM_CONTRIBUTION_AGE = 18;
const MAXIMUM_PLAUSIBLE_AGE = 120;
const CONTRIBUTION_TIME_ZONE = "Europe/London";
const contributionDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: CONTRIBUTION_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type ContributionAgeAssessment =
  | { ok: true; status: "adult" }
  | { ok: true; status: "underage"; eligibleOn: string }
  | { ok: false; error: string };

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function contributionCalendarDate(now = Date.now()): string {
  const parts = contributionDateFormatter.formatToParts(new Date(now));
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function validCalendarDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = DATE_OF_BIRTH_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function contributionEligibilityDate(
  birth: { year: number; month: number; day: number },
): string {
  const year = birth.year + MINIMUM_CONTRIBUTION_AGE;
  const candidate = new Date(Date.UTC(year, birth.month - 1, birth.day));
  return isoDate(
    candidate.getUTCFullYear(),
    candidate.getUTCMonth() + 1,
    candidate.getUTCDate(),
  );
}

export function assessContributionAge(
  dateOfBirth: unknown,
  now = Date.now(),
): ContributionAgeAssessment {
  if (typeof dateOfBirth !== "string" || !Number.isFinite(now)) {
    return { ok: false, error: "Enter a valid date of birth." };
  }
  const birth = validCalendarDate(dateOfBirth.trim());
  if (!birth) return { ok: false, error: "Enter a valid date of birth." };

  const todayIso = contributionCalendarDate(now);
  const today = validCalendarDate(todayIso);
  if (!today) return { ok: false, error: "Enter a valid date of birth." };
  const birthIso = isoDate(birth.year, birth.month, birth.day);
  const oldestAllowed = isoDate(
    today.year - MAXIMUM_PLAUSIBLE_AGE,
    today.month,
    today.day,
  );
  if (birthIso > todayIso || birthIso < oldestAllowed) {
    return { ok: false, error: "Enter a valid date of birth." };
  }

  const eligibleOn = contributionEligibilityDate(birth);
  return eligibleOn <= todayIso
    ? { ok: true, status: "adult" }
    : { ok: true, status: "underage", eligibleOn };
}
