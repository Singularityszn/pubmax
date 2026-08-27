import { describe, expect, it } from "vitest";

import {
  PAL_GUEST_PROMPT_LIMIT,
  PAL_GUEST_TRIAL_KEY,
  palGuestChatHref,
  palGuestSignupHref,
  readPalGuestTrial,
  recordPalGuestAnswer,
  writePalGuestChoice,
} from "@/lib/palGuestTrial";

function memoryStorage(seed?: string): Storage {
  const values = new Map<string, string>();
  if (seed !== undefined) values.set(PAL_GUEST_TRIAL_KEY, seed);
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("Pub Pal guest trial", () => {
  it("starts with Circuit Robin, text mode, and five answers remaining", () => {
    const state = readPalGuestTrial(memoryStorage());

    expect(state).toEqual({
      answeredPrompts: 0,
      species: "robin",
      mode: "text",
    });
    expect(PAL_GUEST_PROMPT_LIMIT - state.answeredPrompts).toBe(5);
  });

  it("keeps only bounded trial metadata", () => {
    const storage = memoryStorage();

    writePalGuestChoice(storage, "fox", "talk");
    recordPalGuestAnswer(storage);

    expect(readPalGuestTrial(storage)).toEqual({
      answeredPrompts: 1,
      species: "fox",
      mode: "talk",
    });
    const stored = JSON.parse(storage.getItem(PAL_GUEST_TRIAL_KEY) ?? "null") as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual([
      "answeredPrompts",
      "mode",
      "species",
      "version",
    ]);
  });

  it("clamps the answered count and rejects unknown choices", () => {
    const storage = memoryStorage(JSON.stringify({
      version: 1,
      answeredPrompts: 99,
      species: "dragon",
      mode: "always-listening",
    }));

    expect(readPalGuestTrial(storage)).toEqual({
      answeredPrompts: PAL_GUEST_PROMPT_LIMIT,
      species: "robin",
      mode: "text",
    });
    expect(recordPalGuestAnswer(storage).answeredPrompts).toBe(PAL_GUEST_PROMPT_LIMIT);
  });

  it("fails soft when storage is corrupt or unavailable", () => {
    expect(readPalGuestTrial(memoryStorage("not-json"))).toEqual({
      answeredPrompts: 0,
      species: "robin",
      mode: "text",
    });
    const unavailable = memoryStorage();
    unavailable.getItem = () => { throw new Error("blocked"); };
    unavailable.setItem = () => { throw new Error("blocked"); };
    expect(readPalGuestTrial(unavailable).answeredPrompts).toBe(0);
    expect(recordPalGuestAnswer(unavailable).answeredPrompts).toBe(1);
  });

  it("builds closed chat and signup destinations", () => {
    expect(palGuestChatHref("fox", "talk")).toBe("/pal/chat?mode=talk&pal=fox");
    expect(palGuestChatHref("cat", "text")).toBe("/pal/chat?mode=text&pal=cat");
    expect(palGuestSignupHref()).toBe("/login?mode=signup&from=%2Fpal");
  });
});
