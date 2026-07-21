import { describe, expect, it } from "vitest";

import {
  cleanAtmosphere,
  cleanBusyness,
  cleanPriceSanity,
  cleanWouldReturn,
  hasSignal,
  londonEveningKey,
  normalizeHandle,
  resolveVisitedAt,
  toVisitReportDTO,
  validateVisitReport,
  VISIT_REPORT_PROMPT_SURFACE,
  type VisitReport,
} from "@/lib/visitReports";
import { claimPromptBudget, hasPromptBudgetFor } from "@/lib/promptBudget";

const NOW = new Date("2026-07-21T20:00:00Z");

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

describe("visit report vocab coercion", () => {
  it("accepts allowlist values case-insensitively, rejects the rest", () => {
    expect(cleanBusyness("RAMMED")).toBe("rammed");
    expect(cleanBusyness("packed")).toBeNull();
    expect(cleanAtmosphere("Cosy")).toBe("cosy");
    expect(cleanAtmosphere("turnt")).toBeNull(); // killed register never sneaks in
    expect(cleanWouldReturn("yes")).toBe("yes");
    expect(cleanWouldReturn("maybe")).toBeNull();
    expect(cleanPriceSanity("steep")).toBe("steep");
    expect(cleanPriceSanity("cheap")).toBeNull();
  });

  it("normalizes a handle like the rest of the app", () => {
    expect(normalizeHandle("@Karan_99!")).toBe("karan_99");
    expect(normalizeHandle(42)).toBe("");
  });
});

describe("londonEveningKey / resolveVisitedAt", () => {
  it("folds pre-dawn hours onto the previous evening", () => {
    // 02:00 UTC on the 21st is the small hours of the night that began the 20th.
    expect(londonEveningKey(new Date("2026-07-21T02:00:00Z"))).toBe("2026-07-20");
    // An 8pm visit stays on its own day.
    expect(londonEveningKey(new Date("2026-07-21T19:00:00Z"))).toBe("2026-07-21");
  });

  it("takes a bare date verbatim and defaults to tonight", () => {
    expect(resolveVisitedAt("2026-07-19", NOW)).toBe("2026-07-19");
    expect(resolveVisitedAt(undefined, NOW)).toBe(londonEveningKey(NOW));
  });

  it("rejects a future night and an invalid date", () => {
    expect(resolveVisitedAt("2099-01-01", NOW)).toBeNull();
    expect(resolveVisitedAt("2026-13-40", NOW)).toBeNull();
    expect(resolveVisitedAt("not-a-date", NOW)).toBeNull();
  });
});

describe("hasSignal", () => {
  const base = { busyness: null, atmosphere: null, wouldReturn: null, priceSanity: null, note: "" };
  it("is false with nothing and true with any one field", () => {
    expect(hasSignal(base)).toBe(false);
    expect(hasSignal({ ...base, busyness: "steady" })).toBe(true);
    expect(hasSignal({ ...base, note: "great night" })).toBe(true);
  });
});

describe("validateVisitReport", () => {
  it("requires a venue, a handle, and at least one signal", () => {
    expect(validateVisitReport({ handle: "sam", busyness: "steady" }, NOW).ok).toBe(false);
    expect(validateVisitReport({ venueId: "v1", busyness: "steady" }, NOW).ok).toBe(false);
    // No signal at all — a report of nothing is refused.
    const nothing = validateVisitReport({ venueId: "v1", handle: "sam" }, NOW);
    expect(nothing.ok).toBe(false);
  });

  it("normalises the fields and stamps tonight's evening by default", () => {
    const result = validateVisitReport(
      { venueId: "venue-1", handle: "@Sam", busyness: "Rammed", wouldReturn: "yes", priceSanity: "fine" },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      venueId: "venue-1",
      handle: "sam",
      busyness: "rammed",
      wouldReturn: "yes",
      priceSanity: "fine",
      visitedAt: londonEveningKey(NOW),
    });
  });

  it("drops an off-allowlist field to null rather than storing it raw", () => {
    const result = validateVisitReport(
      { venueId: "v1", handle: "sam", busyness: "steady", atmosphere: "bussin" },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.atmosphere).toBeNull();
  });

  it("slop-filters the note at write time", () => {
    // A marketing-slop note is dropped to "" — if it were the only signal, the
    // whole report is refused.
    const slopOnly = validateVisitReport(
      { venueId: "v1", handle: "sam", note: "Welcome to the vibrant hidden gem, something for everyone!" },
      NOW,
    );
    expect(slopOnly.ok).toBe(false);

    // A genuine, specific note survives.
    const real = validateVisitReport(
      { venueId: "v1", handle: "sam", note: "Quiz on Tuesdays, good corner by the fire." },
      NOW,
    );
    expect(real.ok).toBe(true);
    if (!real.ok) return;
    expect(real.value.note).toContain("Quiz on Tuesdays");
  });

  it("caps the note at 140 chars", () => {
    const long = "a".repeat(300);
    const result = validateVisitReport({ venueId: "v1", handle: "sam", note: long }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.note.length).toBeLessThanOrEqual(140);
  });
});

describe("toVisitReportDTO", () => {
  it("strips the moderation trail from a public read", () => {
    const report: VisitReport = {
      id: "r1",
      venueId: "v1",
      handle: "sam",
      visitedAt: "2026-07-20",
      busyness: "steady",
      atmosphere: null,
      wouldReturn: "yes",
      priceSanity: "fine",
      note: "good one",
      status: "visible",
      createdAt: "2026-07-21T00:00:00.000Z",
      reportCount: 1,
      reportActors: ["hash-a"],
      reportReason: "spam",
      moderatorNote: "kept",
    };
    const dto = toVisitReportDTO(report) as Record<string, unknown>;
    expect(dto.handle).toBe("sam");
    expect(dto.reportCount).toBeUndefined();
    expect(dto.reportActors).toBeUndefined();
    expect(dto.reportReason).toBeUndefined();
    expect(dto.moderatorNote).toBeUndefined();
    expect(dto.status).toBeUndefined();
  });
});

describe("prompt budget respect", () => {
  it("uses a stable surface id that competes for the shared session budget", () => {
    const s = makeMemoryStorage();
    expect(VISIT_REPORT_PROMPT_SURFACE).toBe("visit-report");
    // Free budget → the visit-report ask may show and claims it.
    expect(hasPromptBudgetFor(VISIT_REPORT_PROMPT_SURFACE, s)).toBe(true);
    expect(claimPromptBudget(VISIT_REPORT_PROMPT_SURFACE, s)).toBe(true);
    // Now a sibling surface is blocked this session, and vice versa.
    expect(hasPromptBudgetFor("identity-nudge", s)).toBe(false);
  });

  it("stands down when another surface already spent the budget", () => {
    const s = makeMemoryStorage();
    expect(claimPromptBudget("first-run-tour", s)).toBe(true);
    // The visit-report ask must not stack on top of the first-run tour.
    expect(hasPromptBudgetFor(VISIT_REPORT_PROMPT_SURFACE, s)).toBe(false);
    expect(claimPromptBudget(VISIT_REPORT_PROMPT_SURFACE, s)).toBe(false);
  });
});
