// @vitest-environment jsdom

// The timing rule for the once-ever store review ask (lib/nativeReviewPrompt.ts).
//
// A rating dialog is rationed by the platform rather than by us: iOS silently
// swallows a SKStoreReviewController request past roughly three a year and
// resolves exactly as a shown dialog does, so no runtime signal can tell a
// wasted ask from a spent one. That makes this rule unusually expensive to get
// wrong and unusually cheap to hold, because it is pure. jsdom is here only for
// the localStorage half; the rule itself needs nothing.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  KEPT_ACTION_KINDS,
  REVIEW_PROMPT_KEPT_ACTION_FLOOR,
  hasAskedForStoreReview,
  isKeptActionKind,
  keptActionCount,
  recordKeptAction,
  resetStoreReviewPrompt,
  shouldRequestStoreReview,
  type KeptActionKind,
  type ReviewPromptGateState,
} from "@/lib/nativeReviewPrompt";

const ASKED_KEY = "pubmax:storeReview:asked:v1";
const KEPT_ACTIONS_KEY = "pubmax:storeReview:keptActions:v1";

function gateState(overrides: Partial<ReviewPromptGateState> = {}): ReviewPromptGateState {
  return {
    isNative: true,
    alreadyAsked: false,
    keptActionCount: REVIEW_PROMPT_KEPT_ACTION_FLOOR,
    ...overrides,
  };
}

/**
 * A later boot on the same device: persisted state survives, the in-document
 * latch does not. The persisted marker alone has to hold the once-ever rule.
 */
function simulateFreshDocument(): void {
  const asked = window.localStorage.getItem(ASKED_KEY);
  const kept = window.localStorage.getItem(KEPT_ACTIONS_KEY);
  resetStoreReviewPrompt();
  if (asked !== null) window.localStorage.setItem(ASKED_KEY, asked);
  if (kept !== null) window.localStorage.setItem(KEPT_ACTIONS_KEY, kept);
}

describe("shouldRequestStoreReview", () => {
  it("asks once the kept-action floor is met inside the shell", () => {
    expect(shouldRequestStoreReview(gateState())).toBe(true);
  });

  it("never asks off the native shell, however many actions were kept", () => {
    expect(shouldRequestStoreReview(gateState({ isNative: false, keptActionCount: 99 }))).toBe(false);
  });

  it("never asks twice", () => {
    expect(shouldRequestStoreReview(gateState({ alreadyAsked: true, keptActionCount: 99 }))).toBe(false);
  });

  it("never asks on a launch with nothing kept behind it", () => {
    expect(shouldRequestStoreReview(gateState({ keptActionCount: 0 }))).toBe(false);
  });

  it("never asks on the FIRST kept action, so the quota is not spent on a coin flip", () => {
    expect(REVIEW_PROMPT_KEPT_ACTION_FLOOR).toBeGreaterThan(1);
    expect(shouldRequestStoreReview(gateState({ keptActionCount: 1 }))).toBe(false);
  });

  it("stays true past the floor, so a moment missed is not a moment lost", () => {
    expect(shouldRequestStoreReview(gateState({ keptActionCount: REVIEW_PROMPT_KEPT_ACTION_FLOOR + 5 }))).toBe(true);
  });
});

describe("the kept-action table is closed", () => {
  it("names the two confirmed moments and nothing else", () => {
    expect([...KEPT_ACTION_KINDS].sort()).toEqual(["plan-kept", "price-logged"]);
  });

  it("refuses a value outside the table", () => {
    expect(isKeptActionKind("app-launched")).toBe(false);
    expect(isKeptActionKind(undefined)).toBe(false);
    for (const kind of KEPT_ACTION_KINDS) expect(isKeptActionKind(kind)).toBe(true);
  });
});

describe("recordKeptAction", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetStoreReviewPrompt();
  });

  afterEach(() => {
    window.localStorage.clear();
    resetStoreReviewPrompt();
  });

  const nativeDeps = (requestReview: () => Promise<void>) => ({
    isNative: () => true,
    loadPlugin: async () => ({ requestReview }),
  });

  it("records nothing and loads no plugin on the web", async () => {
    const loadPlugin = vi.fn();
    const outcome = await recordKeptAction("price-logged", { isNative: () => false, loadPlugin });
    expect(outcome).toBe("skipped");
    expect(loadPlugin).not.toHaveBeenCalled();
    expect(keptActionCount()).toBe(0);
    expect(hasAskedForStoreReview()).toBe(false);
  });

  it("counts the first kept action without asking, then asks on the second", async () => {
    const requestReview = vi.fn(async () => {});
    expect(await recordKeptAction("price-logged", nativeDeps(requestReview))).toBe("skipped");
    expect(requestReview).not.toHaveBeenCalled();
    expect(keptActionCount()).toBe(1);

    expect(await recordKeptAction("plan-kept", nativeDeps(requestReview))).toBe("requested");
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(hasAskedForStoreReview()).toBe(true);
  });

  it("asks once ever, however many kept actions follow", async () => {
    const requestReview = vi.fn(async () => {});
    for (let i = 0; i < 8; i += 1) {
      await recordKeptAction("price-logged", nativeDeps(requestReview));
    }
    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  it("holds the once-ever rule across a later boot, off the persisted marker alone", async () => {
    const requestReview = vi.fn(async () => {});
    await recordKeptAction("price-logged", nativeDeps(requestReview));
    await recordKeptAction("plan-kept", nativeDeps(requestReview));
    expect(requestReview).toHaveBeenCalledTimes(1);

    simulateFreshDocument();
    expect(await recordKeptAction("price-logged", nativeDeps(requestReview))).toBe("skipped");
    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  it("spends the ask once even when two kept actions land in one tick", async () => {
    const requestReview = vi.fn(async () => {});
    await recordKeptAction("price-logged", nativeDeps(requestReview));
    await Promise.all([
      recordKeptAction("price-logged", nativeDeps(requestReview)),
      recordKeptAction("plan-kept", nativeDeps(requestReview)),
    ]);
    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  it("counts the ask as spent when the platform rejects the flow, and never retries", async () => {
    const rejecting = vi.fn(async () => {
      throw new Error("Request review failed");
    });
    await recordKeptAction("price-logged", nativeDeps(rejecting));
    expect(await recordKeptAction("plan-kept", nativeDeps(rejecting))).toBe("requested");
    expect(hasAskedForStoreReview()).toBe(true);

    // A rejection says nothing about whether the OS drew the dialog, so a later
    // boot must not read it as an unspent ask.
    simulateFreshDocument();
    const second = vi.fn(async () => {});
    expect(await recordKeptAction("price-logged", nativeDeps(second))).toBe("skipped");
    expect(second).not.toHaveBeenCalled();
  });

  it("spends nothing when an older shell has no plugin", async () => {
    const deps = {
      isNative: () => true,
      loadPlugin: async () => {
        throw new Error("module not found");
      },
    };
    await recordKeptAction("price-logged", deps);
    expect(await recordKeptAction("plan-kept", deps)).toBe("unavailable");
    expect(hasAskedForStoreReview()).toBe(false);

    // Nothing was shown, so the next kept action may still ask.
    const requestReview = vi.fn(async () => {});
    expect(await recordKeptAction("price-logged", nativeDeps(requestReview))).toBe("requested");
    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  it("counts nothing for a kind outside the closed table", async () => {
    const requestReview = vi.fn(async () => {});
    const outcome = await recordKeptAction("app-launched" as unknown as KeptActionKind, nativeDeps(requestReview));
    expect(outcome).toBe("skipped");
    expect(keptActionCount()).toBe(0);
    expect(requestReview).not.toHaveBeenCalled();
  });
});

// The seam is worth nothing if a caller writes its own rule beside it, and a
// rating ask is exactly the prompt that grows a "just this once" second copy.
// Sweep the tree rather than list files, in the __tests__/nativeCameraSurfaces
// idiom: a new surface must land inside the fence, not outside it.
describe("the review ask has one owner and no copy of its own", () => {
  const root = join(__dirname, "..");
  const SEAM = "lib/nativeReviewPrompt.ts";
  const ROOTS = ["app", "components", "lib"];
  const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...sourceFiles(full));
      } else if (/\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  const files = ROOTS.flatMap((dirName) => sourceFiles(join(root, dirName)));

  it("keeps the review plugin behind the one seam", () => {
    const offenders = files
      .map((file) => relative(root, file))
      .filter((file) => file !== SEAM)
      .filter((file) => readFileSync(join(root, file), "utf8").includes("in-app-review"));
    expect(
      offenders,
      "the review plugin is reached through recordKeptAction() alone (lib/nativeReviewPrompt.ts)",
    ).toEqual([]);
  });

  it("renders no rating copy anywhere, so the OS dialog stays the whole UI", () => {
    // App Store Review Guideline 1.1.7 and Play policy both forbid steering the
    // rating, and a custom dialog in front of the native one is the named
    // pattern. So no source file may carry a line asking for a STORE rating.
    // The phrases below are the steering ones; the drink star rating in
    // components/ratings is a rating of a DRINK and is untouched by this.
    const banned = /\b(rate us|rate the app|rate this app|rate pubmax|leave (us )?a review|review us on|enjoying pubmax|give us (5|five))\b/i;
    const offenders = files
      .map((file) => relative(root, file))
      .filter((file) => banned.test(readFileSync(join(root, file), "utf8")));
    expect(offenders, "the platform dialog is the whole rating UI; we ask for no rating in our own words").toEqual([]);
  });
});
