import { describe, expect, it } from "vitest";

import { GROUP_PREF_MAX_ATMOSPHERE_CHIPS, overlapGroupPrefs, parseMatePreference, type MatePreference } from "@/lib/groupPrefs";

describe("group preferences", () => {
  it("fails soft with an empty crew", () => {
    expect(overlapGroupPrefs([])).toEqual({
      mateCount: 0,
      hardConstraints: {
        budgetBand: null,
        budgetLabel: null,
        zeroProofRequired: false,
        sharedAtmosphereChips: [],
      },
      softScore: 0,
      scoreLabel: "No picks yet",
      summaryLabels: ["waiting on mate picks"],
    });
  });

  it("turns one mate pick into a device-local summary", () => {
    const overlap = overlapGroupPrefs([
      { mateId: "host", budgetBand: "standard", atmosphereChips: ["chatty"], zeroProof: false },
    ]);

    expect(overlap).toMatchObject({
      mateCount: 1,
      hardConstraints: {
        budgetBand: "standard",
        budgetLabel: "standard-price pints",
        zeroProofRequired: false,
        sharedAtmosphereChips: ["chatty"],
      },
      softScore: 100,
      scoreLabel: "First pick saved",
    });
    expect(overlap.summaryLabels).toEqual(["Budget: standard-price pints", "Shared vibe: Chatty tables"]);
  });

  it("promotes the strictest budget and any zero-proof ask to hard constraints", () => {
    const overlap = overlapGroupPrefs([
      { mateId: "host", budgetBand: "under6", atmosphereChips: ["cosy"], zeroProof: true },
      { mateId: "guest", budgetBand: "standard", atmosphereChips: ["cosy"], zeroProof: false },
    ]);

    expect(overlap.hardConstraints).toEqual({
      budgetBand: "under6",
      budgetLabel: "under GBP 6 pints",
      zeroProofRequired: true,
      sharedAtmosphereChips: ["cosy"],
    });
    expect(overlap.softScore).toBe(81);
    expect(overlap.scoreLabel).toBe("Strong overlap");
    expect(overlap.summaryLabels).toEqual(["Budget: under GBP 6 pints", "Shared vibe: Cosy corners", "Zero-proof options needed"]);
  });

  it("uses the leading atmosphere chip when the whole crew does not match", () => {
    const overlap = overlapGroupPrefs([
      { mateId: "a", budgetBand: "standard", atmosphereChips: ["cosy"], zeroProof: false },
      { mateId: "b", budgetBand: "standard", atmosphereChips: ["lively"], zeroProof: false },
      { mateId: "c", budgetBand: "standard", atmosphereChips: ["cosy"], zeroProof: false },
    ]);

    expect(overlap.hardConstraints.sharedAtmosphereChips).toEqual([]);
    expect(overlap.softScore).toBe(89);
    expect(overlap.summaryLabels).toEqual(["Budget: standard-price pints", "Top vibe: Cosy corners (2/3)"]);
  });

  it("keeps the newest valid preference per mate and clamps chips to the tap budget", () => {
    const parsed = parseMatePreference({
      mateId: "guest",
      budgetBand: "flexible",
      atmosphereChips: ["music", "food", "cosy"],
      zeroProof: true,
      updatedAt: "2026-07-22T07:00:00.000Z",
    });
    expect(parsed?.atmosphereChips).toHaveLength(GROUP_PREF_MAX_ATMOSPHERE_CHIPS);
    expect(parsed?.atmosphereChips).toEqual(["music"]);

    const overlap = overlapGroupPrefs([
      { mateId: "guest", budgetBand: "under6", atmosphereChips: ["cosy"], zeroProof: false, updatedAt: "2026-07-22T06:00:00.000Z" },
      parsed,
      { mateId: "", budgetBand: "standard", atmosphereChips: ["chatty"], zeroProof: false },
    ].filter(Boolean) as MatePreference[]);

    expect(overlap.mateCount).toBe(1);
    expect(overlap.hardConstraints.budgetBand).toBe("flexible");
    expect(overlap.summaryLabels).toEqual(["Budget: flexible budget", "Shared vibe: Music-led", "Zero-proof options needed"]);
  });
});
