import { describe, expect, it } from "vitest";

import {
  DEFAULT_NIGHT_PROFILE_INPUT,
  type NightProfileInput,
} from "@/lib/nightProfile";
import { createPlanIntakeDraft, type PlanIntakeDraft } from "@/lib/planIntake";
import {
  applyTodayPersonalization,
  resolveTodayPersonalization,
} from "@/lib/todayPersonalization";
import type { TonightPickDto, WeatherBrief } from "@/lib/todayBrief";

function profile(
  overrides: Partial<NightProfileInput> = {},
): NightProfileInput {
  return {
    ...DEFAULT_NIGHT_PROFILE_INPUT,
    ...overrides,
    context: {
      ...DEFAULT_NIGHT_PROFILE_INPUT.context,
      ...overrides.context,
    },
    briefingPreferences: {
      ...DEFAULT_NIGHT_PROFILE_INPUT.briefingPreferences,
      ...overrides.briefingPreferences,
    },
  };
}

function intake(
  answers: Partial<PlanIntakeDraft["answers"]>,
): PlanIntakeDraft {
  const draft = createPlanIntakeDraft();
  return { ...draft, answers: { ...draft.answers, ...answers } };
}

function weather(tempLabel: string): WeatherBrief {
  return {
    dateLabel: "Wednesday 22 Jul",
    tempLabel,
    conditionLabel: "clear",
    verdictLine: "Beer garden weather. Lager or cider.",
    drinkSuggestion: "a cold lager or cider",
    stale: false,
    checkedLabel: "Checked 1 hour ago",
    source: { publisher: "Open-Meteo", url: "https://open-meteo.com/" },
  };
}

function pick(
  id: string,
  overrides: Partial<TonightPickDto> = {},
): TonightPickDto {
  return {
    id,
    title: "Pub quiz",
    placeName: "The Test Arms",
    kind: "quiz",
    kindLabel: "Quiz",
    sourceLabel: "Question One",
    href: null,
    external: false,
    priceGbp: null,
    lat: null,
    lng: null,
    ...overrides,
  };
}

describe("resolveTodayPersonalization", () => {
  it("resolves each field in explicit > intake > account > reviewed device > defaults order", () => {
    const result = resolveTodayPersonalization({
      explicitCurrentIntent: { context: { atmosphere: ["quiet"] } },
      progressiveIntake: intake({
        area: "camden",
        budget: "value",
        groupSize: 4,
      }),
      account: profile({
        context: {
          ...DEFAULT_NIGHT_PROFILE_INPUT.context,
          daypart: "late_night",
          budget: "standard",
          partyType: "work",
        },
      }),
      reviewedDevice: {
        reviewed: true,
        profile: profile({
          context: {
            ...DEFAULT_NIGHT_PROFILE_INPUT.context,
            daypart: "after_work",
            budget: "treat",
          },
        }),
      },
      defaults: { context: { budget: "treat", groupSize: 2 } },
    });

    expect(result.context.atmosphere).toEqual(["quiet"]);
    expect(result.provenance.atmosphere).toBe("explicit-current-intent");
    expect(result.context.budget).toBe("value");
    expect(result.provenance.budget).toBe("progressive-intake");
    expect(result.context.daypart).toBe("late_night");
    expect(result.provenance.daypart).toBe("account");
    expect(result.context.transportConstraints).toEqual([]);
    expect(result.provenance.transportConstraints).toBe("account");
    expect(result.preferredPatch).toEqual({ value: "camden", source: "progressive-intake" });
  });

  it("uses a reviewed device only after explicit caller attestation", () => {
    const device = profile({
      context: { ...DEFAULT_NIGHT_PROFILE_INPUT.context, budget: "treat" },
    });
    const unreviewed = resolveTodayPersonalization({
      reviewedDevice: { reviewed: false, profile: device },
    });
    const reviewed = resolveTodayPersonalization({
      reviewedDevice: { reviewed: true, profile: device },
    });

    expect(unreviewed.context.budget).toBe("standard");
    expect(unreviewed.provenance.budget).toBe("defaults");
    expect(unreviewed.personalized).toBe(false);
    expect(reviewed.context.budget).toBe("treat");
    expect(reviewed.provenance.budget).toBe("reviewed-device");
    expect(reviewed.personalized).toBe(true);
  });

  it("does not treat an untouched progressive draft as current intent", () => {
    const result = resolveTodayPersonalization({
      progressiveIntake: createPlanIntakeDraft(),
      defaults: { preferredPatch: "clapham" },
    });

    expect(result.personalized).toBe(false);
    expect(result.preferredPatch).toEqual({ value: "clapham", source: "defaults" });
  });

  it("keeps field provenance for preferred patch, weather, content mutes, and planning context", () => {
    const result = resolveTodayPersonalization({
      progressiveIntake: intake({ area: "hackney", accessibilityNeeds: ["step-free"] }),
      account: profile({
        briefingPreferences: {
          muteAll: false,
          mutedAreas: ["camden"],
          mutedTopics: ["Quiz"],
        },
        context: {
          ...DEFAULT_NIGHT_PROFILE_INPUT.context,
          zeroProof: true,
          budgetLimitPence: 2_000,
        },
      }),
    });

    expect(result.preferredPatch).toEqual({ value: "hackney", source: "progressive-intake" });
    expect(result.weatherArea).toEqual({ value: "dalston", source: "progressive-intake" });
    expect(result.hardExclusions.areas).toEqual({ value: ["camden"], source: "account" });
    expect(result.hardExclusions.topics).toEqual({ value: ["quiz"], source: "account" });
    expect(result.context.accessibility).toEqual(["step-free"]);
    expect(result.provenance.accessibility).toBe("progressive-intake");
    expect(result.context.zeroProof).toBe(true);
    expect(result.provenance.zeroProof).toBe("account");
    expect(result.context.budgetLimitPence).toBe(2_000);
    expect(result.provenance.budgetLimitPence).toBe("account");
  });

  it("lets a remembered patch survive an account profile with the default null area", () => {
    const result = resolveTodayPersonalization({
      account: profile(),
      defaults: { preferredPatch: "clapham" },
    });

    expect(result.preferredPatch).toEqual({ value: "clapham", source: "defaults" });
    expect(result.weatherArea).toEqual({ value: "clapham", source: "defaults" });
  });

  it("lets a higher source deliberately clear lower values", () => {
    const result = resolveTodayPersonalization({
      explicitCurrentIntent: {
        context: { nightArea: null },
        preferredPatch: null,
        hardExclusions: { areas: [], topics: [], muteAll: false },
      },
      account: profile({
        context: { ...DEFAULT_NIGHT_PROFILE_INPUT.context, nightArea: "camden" },
        briefingPreferences: {
          muteAll: true,
          mutedAreas: ["camden"],
          mutedTopics: ["quiz"],
        },
      }),
    });

    expect(result.preferredPatch).toEqual({ value: null, source: "explicit-current-intent" });
    expect(result.weatherArea).toEqual({ value: "piccadilly-soho", source: "explicit-current-intent" });
    expect(result.hardExclusions.areas.value).toEqual([]);
    expect(result.hardExclusions.topics.value).toEqual([]);
    expect(result.ignored).toBe(false);
  });

  it("treats ignore today as ephemeral suppression without changing resolved facts", () => {
    const baseInput = {
      account: profile({
        context: { ...DEFAULT_NIGHT_PROFILE_INPUT.context, nightArea: "camden" as const },
      }),
    };
    const active = resolveTodayPersonalization(baseInput);
    const ignored = resolveTodayPersonalization({ ...baseInput, ignoreToday: true });

    expect(ignored.ignored).toBe(true);
    expect(ignored.personalized).toBe(false);
    expect(ignored.context).toEqual(active.context);
    expect(ignored.provenance).toEqual(active.provenance);
  });
});

describe("applyTodayPersonalization", () => {
  const centralWeather = weather("18C");
  const camdenWeather = weather("15C");
  const dalstonWeather = weather("16C");
  const camdenQuiz = pick("camden-quiz", { lat: 51.539, lng: -0.143 });
  const claphamMusic = pick("clapham-music", {
    title: "Live music",
    kind: "music",
    kindLabel: "Live music",
    lat: 51.462,
    lng: -0.138,
  });

  it("keeps the no-profile output unchanged", () => {
    const base = { weather: centralWeather, picks: [camdenQuiz, claphamMusic] };
    const result = applyTodayPersonalization(base, { camden: camdenWeather }, resolveTodayPersonalization());

    expect(result).toEqual({ ...base, filteredPickCount: 0 });
  });

  it("uses the preferred weather and enforces only evidenced area/topic mutes", () => {
    const base = { weather: centralWeather, picks: [camdenQuiz, claphamMusic] };
    const resolved = resolveTodayPersonalization({
      explicitCurrentIntent: {
        preferredPatch: "camden",
        hardExclusions: { topics: ["quiz"], areas: [], muteAll: false },
      },
    });
    const result = applyTodayPersonalization(base, { camden: camdenWeather }, resolved);

    expect(result.weather).toBe(camdenWeather);
    expect(result.picks.map((item) => item.id)).toEqual(["clapham-music"]);
    expect(result.filteredPickCount).toBe(1);
  });

  it("uses remembered-patch weather without changing the no-memory baseline", () => {
    const base = { weather: centralWeather, picks: [camdenQuiz] };
    const resolved = resolveTodayPersonalization({ defaults: { preferredPatch: "camden" } });

    expect(applyTodayPersonalization(base, { camden: camdenWeather }, resolved).weather).toBe(camdenWeather);
  });

  it("uses a modelled Night Area even when it has no exact patch mapping", () => {
    const base = { weather: centralWeather, picks: [camdenQuiz] };
    const resolved = resolveTodayPersonalization({
      explicitCurrentIntent: { context: { nightArea: "dalston" } },
    });

    expect(resolved.preferredPatch.value).toBeNull();
    expect(applyTodayPersonalization(base, { dalston: dalstonWeather }, resolved).weather).toBe(dalstonWeather);
  });

  it("matches muted topics as normalized phrases, not arbitrary substrings", () => {
    const party = pick("party", { title: "Party tonight", kind: "music", kindLabel: "Live music" });
    const base = { weather: centralWeather, picks: [party] };
    const resolved = resolveTodayPersonalization({
      explicitCurrentIntent: { hardExclusions: { topics: ["art"] } },
    });

    expect(applyTodayPersonalization(base, {}, resolved).picks).toEqual([party]);
  });

  it("returns the baseline by reference when today is ignored", () => {
    const base = { weather: centralWeather, picks: [camdenQuiz] };
    const resolved = resolveTodayPersonalization({
      explicitCurrentIntent: { preferredPatch: "camden" },
      ignoreToday: true,
    });

    expect(applyTodayPersonalization(base, { camden: camdenWeather }, resolved)).toEqual({
      ...base,
      filteredPickCount: 0,
    });
  });
});
