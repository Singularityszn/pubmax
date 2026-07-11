import { firstHttp } from "@/lib/httpUrl";

export type BusynessLevel = "quiet" | "moderate" | "busy" | "rammed";
export type BusynessSource = "typical-pattern" | "community-report";

export type BusynessReport = {
  level: Extract<BusynessLevel, "quiet" | "rammed">;
  reportedAt: string;
  reporterName?: string;
};

export type OpeningWindow = { opens: string; closes: string };
export type WeeklyOpeningHours = Partial<Record<number, OpeningWindow[]>>;

export type BusynessEstimate = {
  level: BusynessLevel;
  label: string;
  source: BusynessSource;
  isEstimate: true;
  isOpen: boolean | "unknown";
  reportCount: number;
  generatedAt: string;
  explanation: string;
};

type LocalClock = { weekday: number; minutes: number };

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const REPORT_FRESHNESS_MS = 90 * 60 * 1_000;

function localClock(now: Date, timeZone: string): LocalClock {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(now);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value.toLowerCase() ?? "mon";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const weekday = WEEKDAYS.findIndex((day) => weekdayName.startsWith(day));
  return { weekday: weekday < 0 ? 1 : weekday, minutes: hour * 60 + minute };
}

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 29 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function openingState(clock: LocalClock, hours?: WeeklyOpeningHours): boolean | "unknown" {
  if (!hours) return "unknown";
  const windows = hours[clock.weekday];
  if (!windows) return "unknown";
  return windows.some((window) => {
    const opens = parseClock(window.opens);
    const closes = parseClock(window.closes);
    if (opens === null || closes === null) return false;
    const adjustedClose = closes <= opens ? closes + 24 * 60 : closes;
    const adjustedNow = clock.minutes < opens && adjustedClose >= 24 * 60
      ? clock.minutes + 24 * 60
      : clock.minutes;
    return adjustedNow >= opens && adjustedNow < adjustedClose;
  });
}

function typicalLevel(weekday: number, minutes: number): BusynessLevel {
  const hour = minutes / 60;
  const fridayOrSaturday = weekday === 5 || weekday === 6;
  const weekdayAfterWork = weekday >= 1 && weekday <= 5 && hour >= 17 && hour < 20;

  if (fridayOrSaturday && hour >= 20 && hour < 23.5) return "busy";
  if (weekdayAfterWork) return weekday === 5 ? "busy" : "moderate";
  if (hour >= 12 && hour < 14) return "moderate";
  if (hour >= 20 && hour < 22.5) return "moderate";
  return "quiet";
}

function typicalLabel(level: BusynessLevel): string {
  if (level === "quiet") return "Usually quiet";
  if (level === "moderate") return "Usually steady";
  return "Usually busy";
}

export function estimateBusyness(input: {
  now?: Date;
  timeZone?: string;
  openingHours?: WeeklyOpeningHours;
  reports?: BusynessReport[];
}): BusynessEstimate {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? "Europe/London";
  const clock = localClock(now, timeZone);
  const freshReports = (input.reports ?? []).filter((report) => {
    const reportedAt = Date.parse(report.reportedAt);
    return Number.isFinite(reportedAt) && reportedAt <= now.getTime()
      && now.getTime() - reportedAt <= REPORT_FRESHNESS_MS;
  });
  const latest = freshReports.sort(
    (a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt),
  )[0];
  const isOpen = openingState(clock, input.openingHours);

  if (latest) {
    return {
      level: latest.level,
      label: latest.level === "rammed" ? "Reported rammed" : "Reported quiet",
      source: "community-report",
      isEstimate: true,
      isOpen,
      reportCount: freshReports.length,
      generatedAt: now.toISOString(),
      explanation: "A recent community signal, not measured footfall or guaranteed entry.",
    };
  }

  const level = typicalLevel(clock.weekday, clock.minutes);
  return {
    level,
    label: typicalLabel(level),
    source: "typical-pattern",
    isEstimate: true,
    isOpen,
    reportCount: 0,
    generatedAt: now.toISOString(),
    explanation: "Estimated from the day and time; live crowd data is unavailable.",
  };
}

export type GroupFit = "likely" | "uncertain" | "unlikely" | "book-ahead";

export function canGroupGetIn(input: {
  groupSize: number;
  level: BusynessLevel;
  hasBookingLink: boolean;
}): { fit: GroupFit; label: string; reason: string } {
  const groupSize = Math.max(1, Math.min(30, Math.round(input.groupSize) || 1));
  if (input.hasBookingLink && groupSize >= 6 && ["busy", "rammed"].includes(input.level)) {
    return {
      fit: "book-ahead",
      label: "Book ahead",
      reason: `A group of ${groupSize} should book rather than rely on this estimate.`,
    };
  }
  if (groupSize >= 8 && ["busy", "rammed"].includes(input.level)) {
    return {
      fit: "unlikely",
      label: "Call ahead",
      reason: `A group of ${groupSize} may struggle at a usually busy time.`,
    };
  }
  if (groupSize >= 6 || input.level === "rammed") {
    return {
      fit: "uncertain",
      label: "Check before you go",
      reason: "Entry is uncertain; the venue has not confirmed space.",
    };
  }
  return {
    fit: "likely",
    label: "Likely workable",
    reason: "The estimate looks workable, but entry is never guaranteed.",
  };
}

export function resolveBookingOption(bookingLink: string | null | undefined): {
  available: boolean;
  label: string;
  href: string | null;
  partner: null;
} {
  const href = firstHttp(bookingLink ?? "");
  return href
    ? { available: true, label: "Book a table", href, partner: null }
    : { available: false, label: "Booking link unavailable", href: null, partner: null };
}
