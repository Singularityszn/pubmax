import { describe, expect, it } from "vitest";

import {
  isEmptyPintDropDraft,
  normalisePintDropDraft,
  pintDropDraftForPersistence,
  pintDropDraftStorageKey,
  readPintDropDraft,
  seededPintDropDraftForm,
  writePintDropDraft,
  type PintDropDraft,
} from "@/lib/pintDropDraft";

function makeStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

const DRAFT: PintDropDraft = {
  form: {
    price: "5.8",
    drink: "Guinness",
    measure: "pint",
    measureLabel: "",
    note: "Quiet corner table",
    era: "Tonight",
    withWho: "@sam",
  },
  visibility: "friends",
  vibeTags: ["quiet pint", "old local"],
  updatedAt: "2026-07-08T12:00:00.000Z",
};

describe("pint drop drafts", () => {
  it("uses a venue-scoped storage key", () => {
    expect(pintDropDraftStorageKey("the lamb")).toBe("pubmax_pint_drop_draft:the%20lamb");
    expect(pintDropDraftStorageKey("pub/123")).toBe("pubmax_pint_drop_draft:pub%2F123");
  });

  it("writes and reads a draft for one venue without leaking to another", () => {
    const storage = makeStorage();
    writePintDropDraft(storage, "venue-a", DRAFT);

    expect(readPintDropDraft(storage, "venue-a")).toMatchObject(DRAFT);
    expect(readPintDropDraft(storage, "venue-b")).toBeNull();
  });

  it("normalises invalid stored fields back to safe composer values", () => {
    const draft = normalisePintDropDraft({
      version: 2,
      form: {
        price: 7,
        drink: "Ale",
        note: "x".repeat(600),
        era: null,
        withWho: "@sam",
      },
      visibility: "private",
      vibeTags: ["cheap", "not-real", "cheap", "last train", "hidden gem", "date night", "old local"],
      updatedAt: "not-a-date",
    });

    expect(draft).toEqual({
      form: {
        price: "",
        drink: "Ale",
        measure: "pint",
        measureLabel: "",
        note: "x".repeat(500),
        era: "",
        withWho: "@sam",
      },
      visibility: "public",
      vibeTags: ["cheap", "last train", "hidden gem", "date night"],
      updatedAt: "1970-01-01T00:00:00.000Z",
    });
  });

  it("removes empty drafts instead of storing noise", () => {
    const storage = makeStorage();
    writePintDropDraft(storage, "venue-a", DRAFT);

    const emptyDraft: PintDropDraft = {
      form: {
        price: "",
        drink: "",
        measure: "pint",
        measureLabel: "",
        note: "",
        era: "",
        withWho: "",
      },
      visibility: "public",
      vibeTags: [],
      updatedAt: "2026-07-08T12:00:00.000Z",
    };
    expect(isEmptyPintDropDraft(emptyDraft)).toBe(true);

    writePintDropDraft(storage, "venue-a", emptyDraft);
    expect(readPintDropDraft(storage, "venue-a")).toBeNull();
  });

  it("never serialises voice-derived text, including after a manual edit", () => {
    const storage = makeStorage();
    writePintDropDraft(storage, "venue-a", pintDropDraftForPersistence(DRAFT, "Typed before dictation"));
    expect(readPintDropDraft(storage, "venue-a")?.form).toMatchObject({ note: "Typed before dictation", drink: "Guinness" });
    const manuallyEditedTranscript = { ...DRAFT, form: { ...DRAFT.form, note: "Dictated transcript, then edited" } };
    writePintDropDraft(storage, "venue-a", pintDropDraftForPersistence(manuallyEditedTranscript, "Typed before dictation"));
    expect(readPintDropDraft(storage, "venue-a")?.form.note).toBe("Typed before dictation");
  });

  it("fails closed by scrubbing notes from legacy unversioned drafts", () => {
    expect(normalisePintDropDraft(DRAFT)?.form.note).toBe("");
  });

  it("fails soft when storage is unavailable", () => {
    const brokenStorage = {
      getItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };

    expect(readPintDropDraft(brokenStorage, "venue-a")).toBeNull();
    expect(() => writePintDropDraft(brokenStorage, "venue-a", DRAFT)).not.toThrow();
  });
});

describe("seededPintDropDraftForm", () => {
  // #1462 — the landing's "Still £6.50?" promises the composer already holds
  // £6.50. The composer's own hydration is the only place that can keep that
  // promise, because it blanks the fields on every venue mount.
  it("seeds the price when the venue has no saved draft", () => {
    expect(seededPintDropDraftForm(null, { kind: "price", price: "6.50" })).toEqual({
      price: "6.50",
      drink: "",
      measure: "pint",
      measureLabel: "",
      note: "",
      era: "",
      withWho: "",
    });
  });

  it("leaves a venue with no draft and no seed exactly as it was", () => {
    expect(seededPintDropDraftForm(null, null)).toBe(null);
  });

  it("never overwrites a price the drinker already put in their own draft", () => {
    const own = {
      price: "5.80",
      drink: "Guinness",
      measure: "pint" as const,
      measureLabel: "",
      note: "",
      era: "",
      withWho: "",
    };
    expect(seededPintDropDraftForm(own, { kind: "price", price: "6.50" })).toBe(own);
  });

  it("still seeds a draft that holds a note but no figure", () => {
    const noPrice = {
      price: "",
      drink: "",
      measure: "pint" as const,
      measureLabel: "",
      note: "Quiet corner",
      era: "",
      withWho: "",
    };
    expect(seededPintDropDraftForm(noPrice, { kind: "price", price: "6.50" })).toEqual({ ...noPrice, price: "6.50" });
  });

  it("seeds a split's actual product and measure over an unfinished draft", () => {
    const draft = {
      price: "5.80",
      drink: "Guinness",
      measure: "half" as const,
      measureLabel: "",
      note: "Quiet corner",
      era: "",
      withWho: "",
    };
    expect(seededPintDropDraftForm(draft, {
      kind: "claim",
      price: "4.50",
      drink: "Lager",
      measure: "pint",
      measureLabel: "",
    })).toEqual({ ...draft, price: "4.50", drink: "Lager", measure: "pint", measureLabel: "" });
  });

  it("hands a draft straight back when the intent carried no seed", () => {
    const draft = {
      price: "",
      drink: "",
      measure: "pint" as const,
      measureLabel: "",
      note: "Quiet corner",
      era: "",
      withWho: "",
    };
    expect(seededPintDropDraftForm(draft, null)).toBe(draft);
  });
});
