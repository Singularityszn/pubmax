import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PASSWORD_PROMPT_DESTINATION,
  markPasswordPromptAnswered,
  passwordPromptAnsweredKey,
  readPasswordPromptAnswered,
  shouldOfferPasswordPrompt,
  type PasswordPromptInputs,
} from "@/lib/passwordPrompt";

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

function installWindow(storage: Storage | null): void {
  (globalThis as { window?: unknown }).window = {
    localStorage: storage,
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

/** An account that IS owed the ask: every gate open, no password, not asked. */
const OWED: PasswordPromptInputs = {
  configured: true,
  accountId: "acct-1",
  identityResolved: true,
  handle: "karan",
  hasPassword: false,
  answered: false,
};

describe("shouldOfferPasswordPrompt", () => {
  it("offers the ask when a password is the actual thing missing", () => {
    expect(shouldOfferPasswordPrompt(OWED)).toBe(true);
  });

  it("never offers when the password read could not answer", () => {
    // The tri-state law: null is "we could not look", not "you have none".
    // Telling an owner who HAS a password to create one is the defect this
    // separation exists to prevent.
    expect(shouldOfferPasswordPrompt({ ...OWED, hasPassword: null })).toBe(false);
  });

  it("never offers to an account that already has a password", () => {
    expect(shouldOfferPasswordPrompt({ ...OWED, hasPassword: true })).toBe(false);
  });

  it("holds until the live session answers", () => {
    expect(shouldOfferPasswordPrompt({ ...OWED, identityResolved: false })).toBe(false);
  });

  it("says nothing to a signed-out browser", () => {
    expect(shouldOfferPasswordPrompt({ ...OWED, accountId: null })).toBe(false);
  });

  it("says nothing on a build with no browser auth", () => {
    expect(shouldOfferPasswordPrompt({ ...OWED, configured: false })).toBe(false);
  });

  it("does not ask an account with no claimed handle", () => {
    // A password signs you in BY HANDLE, so without one the ask could not be
    // acted on, and an ask that leads nowhere reads as broken.
    expect(shouldOfferPasswordPrompt({ ...OWED, handle: null })).toBe(false);
  });

  it("asks once: an answered account is never asked again", () => {
    expect(shouldOfferPasswordPrompt({ ...OWED, answered: true })).toBe(false);
  });
});

describe("password prompt answered marker", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = makeMemoryStorage();
    installWindow(storage);
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("records the answer against the account that gave it", () => {
    markPasswordPromptAnswered("acct-1");
    expect(storage.getItem(passwordPromptAnsweredKey("acct-1"))).toBe("1");
    expect(readPasswordPromptAnswered("acct-1")).toBe(true);
  });

  it("leaves a second account on the same device still owed the ask", () => {
    // A device may hold several accounts, so a bare device flag would let the
    // first account's answer speak for one that has never been asked.
    markPasswordPromptAnswered("acct-1");
    expect(readPasswordPromptAnswered("acct-2")).toBe(false);
    expect(
      shouldOfferPasswordPrompt({
        ...OWED,
        accountId: "acct-2",
        answered: readPasswordPromptAnswered("acct-2"),
      }),
    ).toBe(true);
  });

  it("keys the marker by account id", () => {
    expect(passwordPromptAnsweredKey("acct-1")).not.toBe(
      passwordPromptAnsweredKey("acct-2"),
    );
    expect(passwordPromptAnsweredKey("acct-1")).toContain("acct-1");
  });

  it("writes nothing when there is no account to record it against", () => {
    markPasswordPromptAnswered(null);
    expect(storage.length).toBe(0);
    expect(readPasswordPromptAnswered(null)).toBe(false);
  });

  it("treats an unreadable store as not answered, so the ask stays owed", () => {
    installWindow(null);
    expect(readPasswordPromptAnswered("acct-1")).toBe(false);
  });

  it("does not throw when the store refuses a write", () => {
    const refusing = makeMemoryStorage();
    refusing.setItem = () => {
      throw new Error("private mode");
    };
    installWindow(refusing);
    expect(() => markPasswordPromptAnswered("acct-1")).not.toThrow();
  });
});

describe("password prompt destination", () => {
  it("hands over to the account surface that owns the create form", () => {
    expect(PASSWORD_PROMPT_DESTINATION).toBe("/u/you#account-settings-title");
  });
});
