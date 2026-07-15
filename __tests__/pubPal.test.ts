import { describe, expect, it } from "vitest";
import { cleanPalDraft, DEFAULT_PAL_DRAFT, PAL_UNLOCKS, SIGNAL_FAMILIES } from "@/lib/pubPal";

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
});
