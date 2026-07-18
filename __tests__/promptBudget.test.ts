import { describe, expect, it } from "vitest";

import {
  claimPromptBudget,
  hasPromptBudgetFor,
  promptBudgetHolder,
  releasePromptBudget,
} from "@/lib/promptBudget";

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

describe("promptBudget (one surface per session)", () => {
  it("starts free", () => {
    const s = makeMemoryStorage();
    expect(promptBudgetHolder(s)).toBeNull();
    expect(hasPromptBudgetFor("a2hs", s)).toBe(true);
    expect(hasPromptBudgetFor("first-run-tour", s)).toBe(true);
  });

  it("first claim wins; a second surface is blocked", () => {
    const s = makeMemoryStorage();
    expect(claimPromptBudget("first-run-tour", s)).toBe(true);
    expect(promptBudgetHolder(s)).toBe("first-run-tour");
    // A2HS can no longer show this session.
    expect(hasPromptBudgetFor("a2hs", s)).toBe(false);
    expect(claimPromptBudget("a2hs", s)).toBe(false);
    // Holder unchanged.
    expect(promptBudgetHolder(s)).toBe("first-run-tour");
  });

  it("claim is idempotent for the holder", () => {
    const s = makeMemoryStorage();
    expect(claimPromptBudget("a2hs", s)).toBe(true);
    expect(claimPromptBudget("a2hs", s)).toBe(true);
    expect(hasPromptBudgetFor("a2hs", s)).toBe(true);
  });

  it("only the holder can release; then another surface may claim", () => {
    const s = makeMemoryStorage();
    claimPromptBudget("a2hs", s);
    // A non-holder release is a no-op.
    releasePromptBudget("first-run-tour", s);
    expect(promptBudgetHolder(s)).toBe("a2hs");
    // The holder releases the wasted moment.
    releasePromptBudget("a2hs", s);
    expect(promptBudgetHolder(s)).toBeNull();
    expect(claimPromptBudget("identity-nudge", s)).toBe(true);
    expect(promptBudgetHolder(s)).toBe("identity-nudge");
  });

  it("empty surface never claims", () => {
    const s = makeMemoryStorage();
    expect(claimPromptBudget("", s)).toBe(false);
    expect(promptBudgetHolder(s)).toBeNull();
  });

  it("degrades open when storage is unavailable (best-effort)", () => {
    // No injected storage and no window → resolveStorage returns null.
    expect(hasPromptBudgetFor("a2hs")).toBe(true);
    expect(claimPromptBudget("a2hs")).toBe(true);
  });
});
