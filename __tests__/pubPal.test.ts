import { afterEach, describe, expect, it } from "vitest";
import { cleanPalDraft, DEFAULT_PAL_DRAFT, PAL_ANIMATION_STATES, PAL_ONBOARDING_DRAFT_KEY, PAL_SPECIES, PAL_UNLOCKS, PAL_VISUAL_MANIFEST, SIGNAL_FAMILIES, readPalOnboardingDraft, writePalOnboardingDraft } from "@/lib/pubPal";

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
    writePalOnboardingDraft({
      step: 2,
      draft: { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Nova" },
      privacy: { proposeMemories: false, visible: true, muted: false },
    });
    expect(window.localStorage.getItem(PAL_ONBOARDING_DRAFT_KEY)).toContain('"version":1');
    expect(readPalOnboardingDraft()).toMatchObject({ step: 2, draft: { name: "Nova" } });
  });
});
