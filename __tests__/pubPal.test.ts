import { afterEach, describe, expect, it } from "vitest";
import { cleanPalDraft, DEFAULT_PAL_DRAFT, migrateLegacyPalOnboardingDraft, PAL_ANIMATION_STATES, PAL_ONBOARDING_DRAFT_KEY, PAL_SPECIES, PAL_UNLOCKS, PAL_VISUAL_MANIFEST, SIGNAL_FAMILIES, palOnboardingDraftKey, readPalOnboardingDraft, writePalOnboardingDraft } from "@/lib/pubPal";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, clear: () => values.clear(), getItem: (key) => values.get(key) ?? null, key: (index) => [...values.keys()][index] ?? null, removeItem: (key) => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); } };
}

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

describe("Pub Pal domain", () => {
  it("requires an adult attestation and a name", () => {
    expect(cleanPalDraft(DEFAULT_PAL_DRAFT)).toBeNull();
    expect(cleanPalDraft({ ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Morrow" })).toMatchObject({ name: "Morrow", adultConfirmed: true });
  });

  it("rejects arbitrary species and voice identifiers", () => {
    expect(cleanPalDraft({ ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Morrow", appearance: { ...DEFAULT_PAL_DRAFT.appearance, species: "dragon" } })).toBeNull();
    expect(cleanPalDraft({ ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Morrow", voice: { ...DEFAULT_PAL_DRAFT.voice, id: "cloned-person" } })).toBeNull();
  });

  it("defines six Signal families and cosmetic-only unlock categories", () => {
    expect(SIGNAL_FAMILIES).toEqual(["beer", "gin", "rum", "whisky", "brandy", "vodka"]);
    expect(PAL_UNLOCKS.every(unlock => !["ranking", "alcohol", "drink_count"].includes(unlock.category))).toBe(true);
  });

  it("offers a compact eight-form companion collection", () => {
    expect(PAL_SPECIES).toHaveLength(8);
    expect(new Set(PAL_SPECIES).size).toBe(8);
  });

  it("ships three original layered launch rigs with every emotional state", () => {
    expect(Object.keys(PAL_VISUAL_MANIFEST)).toEqual(["hound", "raven", "fox"]);
    expect(PAL_ANIMATION_STATES).toEqual(["idle", "noticing", "listening", "thinking", "speaking", "celebrating", "sleeping", "error"]);
    expect(Object.values(PAL_VISUAL_MANIFEST).every((visual) => visual.format === "layered-svg" && visual.supportedStates.length === 8)).toBe(true);
  });

  it("round-trips an incomplete five-step onboarding draft safely", () => {
    (globalThis as { window?: { localStorage: Storage } }).window = { localStorage: memoryStorage() };
    writePalOnboardingDraft("user-1", {
      step: 2,
      draft: { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Nova" },
      privacy: { proposeMemories: false, visible: true, muted: false },
    });
    expect(window.localStorage.getItem(palOnboardingDraftKey("user-1"))).toContain('"version":1');
    expect(readPalOnboardingDraft("user-1")).toMatchObject({ step: 2, draft: { name: "Nova" } });
    expect(readPalOnboardingDraft("user-2")).toBeNull();
  });

  it("migrates the old shared draft but requires a fresh adult attestation", () => {
    (globalThis as { window?: { localStorage: Storage } }).window = { localStorage: memoryStorage() };
    window.localStorage.setItem(PAL_ONBOARDING_DRAFT_KEY, JSON.stringify({
      version: 1,
      savedAt: new Date(0).toISOString(),
      step: 4,
      draft: { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Nova" },
      privacy: { proposeMemories: true, visible: true, muted: false },
    }));
    expect(migrateLegacyPalOnboardingDraft("user-1")).toMatchObject({ step: 0, draft: { name: "Nova", adultConfirmed: false }, privacy: { proposeMemories: false } });
    expect(window.localStorage.getItem(PAL_ONBOARDING_DRAFT_KEY)).toBeNull();
    expect(readPalOnboardingDraft("user-1")).toMatchObject({ step: 0, draft: { adultConfirmed: false } });
  });
});
