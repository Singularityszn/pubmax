import { afterEach, describe, expect, it } from "vitest";

import {
  buildLastCrewShareText,
  LAST_CREW_STORAGE_KEY,
  parseLastCrew,
  rememberLastCrew,
} from "@/lib/lastCrew";

afterEach(() => {
  try {
    localStorage.removeItem(LAST_CREW_STORAGE_KEY);
  } catch {
    // jsdom always has localStorage; ignore if a future env strips it.
  }
});

describe("parseLastCrew", () => {
  it("keeps unique trimmed names and drops empties", () => {
    const crew = parseLastCrew({
      names: [" Karan ", "Amy", "karan", "", "   "],
      savedAt: "2026-07-22T12:00:00.000Z",
      sourcePlanId: "plan-1",
    });
    expect(crew?.names).toEqual(["Karan", "Amy"]);
    expect(crew?.sourcePlanId).toBe("plan-1");
  });

  it("returns null for a solo roster", () => {
    expect(parseLastCrew({ names: ["Only"], savedAt: "2026-07-22T12:00:00.000Z" })).toBeNull();
  });
});

describe("rememberLastCrew", () => {
  it("returns a two-person crew and refuses a solo night", () => {
    expect(rememberLastCrew(["Alone"])).toBeNull();
    const crew = rememberLastCrew(["Karan", "Amy"], "plan-9");
    expect(crew?.names).toEqual(["Karan", "Amy"]);
    expect(crew?.sourcePlanId).toBe("plan-9");
  });
});

describe("buildLastCrewShareText", () => {
  it("names the usual lot and includes the plan URL", () => {
    const text = buildLastCrewShareText({
      names: ["Karan", "Amy"],
      planUrl: "https://pubmaxxing.com/plan/abc",
      title: "Thursday lot",
    });
    expect(text).toContain("Thursday lot");
    expect(text).toContain("Karan, Amy");
    expect(text).toContain("https://pubmaxxing.com/plan/abc");
  });
});
