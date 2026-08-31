import { describe, expect, it } from "vitest";

import {
  PAL_GUEST_ANSWER_LIMIT,
  PAL_GUEST_TURN_LOCK_NAME,
  PAL_GUEST_TRIAL_STORAGE_KEY,
  isPalGuestTrialComplete,
  palGuestChatHref,
  palGuestResultConsumesAnswer,
  palGuestSignupHref,
  readPalGuestTrial,
  recordPalGuestAnswer,
  writePalGuestChoice,
  withPalGuestTurnLock,
  type PalGuestLockManager,
  type PalGuestStorage,
} from "@/lib/palGuestTrial";

function memoryStorage(initial: string | null = null): {
  storage: PalGuestStorage;
  stored: () => string | null;
} {
  let value = initial;
  return {
    storage: {
      getItem: (key) => key === PAL_GUEST_TRIAL_STORAGE_KEY ? value : null,
      setItem: (key, next) => {
        if (key === PAL_GUEST_TRIAL_STORAGE_KEY) value = next;
      },
    },
    stored: () => value,
  };
}

describe("Pub Pal guest trial", () => {
  it("stores only version, answer count, species, and mode", () => {
    const target = memoryStorage();

    const state = writePalGuestChoice("fox", "talk", target.storage);

    expect(state).toEqual({
      version: 1,
      answeredPrompts: 0,
      species: "fox",
      mode: "talk",
    });
    expect(JSON.parse(target.stored() ?? "null")).toEqual(state);
    expect(Object.keys(state).sort()).toEqual([
      "answeredPrompts",
      "mode",
      "species",
      "version",
    ]);
  });

  it("records at most five completed answers while preserving the guest choice", () => {
    const target = memoryStorage();
    writePalGuestChoice("badger", "text", target.storage);

    let state = readPalGuestTrial(target.storage);
    for (let index = 0; index < PAL_GUEST_ANSWER_LIMIT + 3; index += 1) {
      state = recordPalGuestAnswer(target.storage);
    }

    expect(state).toEqual({
      version: 1,
      answeredPrompts: 5,
      species: "badger",
      mode: "text",
    });
    expect(isPalGuestTrialComplete(state)).toBe(true);
    expect(isPalGuestTrialComplete(4)).toBe(false);
  });

  it("counts answered and honest-empty results but not errors or superseded work", () => {
    expect(palGuestResultConsumesAnswer({ status: "answered" })).toBe(true);
    expect(palGuestResultConsumesAnswer({ status: "empty" })).toBe(true);
    expect(palGuestResultConsumesAnswer({ status: "error" })).toBe(false);
    expect(palGuestResultConsumesAnswer(null)).toBe(false);
    expect(palGuestResultConsumesAnswer({ status: "pending" })).toBe(false);
  });

  it("fails closed to safe defaults for malformed local metadata", () => {
    const target = memoryStorage(JSON.stringify({
      version: 1,
      answeredPrompts: 99,
      species: "dragon",
      mode: "listen-forever",
      transcript: "must not survive",
      coordinates: [51.5, -0.1],
    }));

    expect(readPalGuestTrial(target.storage)).toEqual({
      version: 1,
      answeredPrompts: 5,
      species: "robin",
      mode: "text",
    });
  });

  it("survives unavailable browser storage without exposing input", () => {
    const hostile: PalGuestStorage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };

    expect(() => writePalGuestChoice("cat", "talk", hostile)).not.toThrow();
    let state = writePalGuestChoice("cat", "talk", hostile);
    for (let index = 0; index < PAL_GUEST_ANSWER_LIMIT; index += 1) {
      state = recordPalGuestAnswer(hostile, state);
    }
    expect(state.answeredPrompts).toBe(5);
    expect(state.mode).toBe("talk");
  });

  it("never overwrites a newer answer count from another tab", () => {
    const target = memoryStorage(JSON.stringify({
      version: 1,
      answeredPrompts: 5,
      species: "robin",
      mode: "text",
    }));
    const stale = {
      version: 1 as const,
      answeredPrompts: 2,
      species: "fox" as const,
      mode: "talk" as const,
    };

    expect(writePalGuestChoice("fox", "talk", target.storage, stale))
      .toMatchObject({ answeredPrompts: 5, species: "fox", mode: "talk" });
    expect(recordPalGuestAnswer(target.storage, stale).answeredPrompts).toBe(5);
  });

  it("requests an exclusive browser lock for a guest answer", async () => {
    const calls: Array<{ name: string; mode: string }> = [];
    const manager: PalGuestLockManager = {
      request: async (name, options, callback) => {
        calls.push({ name, mode: options.mode });
        return callback();
      },
    };

    await expect(withPalGuestTurnLock(async () => "answered", manager))
      .resolves.toBe("answered");
    expect(calls).toEqual([
      { name: PAL_GUEST_TURN_LOCK_NAME, mode: "exclusive" },
    ]);
  });

  it("builds bounded chat and account destinations", () => {
    expect(palGuestChatHref("pigeon", "talk")).toBe(
      "/pal/chat?trial=1&mode=talk&pal=pigeon",
    );
    expect(palGuestChatHref("fox", "text")).toBe(
      "/pal/chat?trial=1&mode=text&pal=fox",
    );
    expect(palGuestSignupHref()).toBe("/login?mode=signup&from=%2Fpal");
  });
});
