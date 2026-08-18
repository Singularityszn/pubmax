// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What the describe prefill owes is a VALUE IN A FIELD, not a line order, so
// this file mounts the composer and reads the input. The rule it pins has three
// halves that a source read cannot see: the URL beats a held ask draft, the
// draft is SPENT either way (it is one-shot, and a URL visit used to leave it
// behind for the next /plan to open on somebody's earlier ask), and the URL
// prefill survives a `sessionStorage` that THROWS - which it does outright when
// site data is blocked or the document is a sandboxed frame.

vi.mock("server-only", () => ({}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => Promise.resolve(),
  }),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null, loading: false, identityResolved: true }),
}));

// Siblings of the field under test, each with its own coverage. The describe
// surface itself stays real: it is what adopts the prefill.
vi.mock("@/components/plan/PlanIntake", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanCultureOpener", () => ({ default: () => null }));
vi.mock("@/components/wanted/WantedPlanChips", () => ({ default: () => null }));

vi.mock("@/lib/analytics", () => ({
  trackEvent: () => undefined,
  trackMeaningfulCoreAction: () => undefined,
  laneSourceFromSearch: () => null,
}));

import PlanComposer from "@/components/plan/PlanComposer";
import { ASK_PLAN_DRAFT_STORAGE_KEY } from "@/lib/ask/types";

const URL_ASK = "Plan a crawl in Soho for 4";
const DRAFT_ASK = "an older ask nobody asked for again";

let root: Root | null = null;
let host: HTMLElement | null = null;

const realSessionStorage = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;

const realLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage")!;

/**
 * Site data blocked, the way a browser really does it: `window.sessionStorage`
 * and `window.localStorage` are PROPERTY GETTERS, and a blocked browser raises
 * on the read itself rather than on a later method call. So the fake replaces
 * the getter, which is strictly stronger - naming the identifier anywhere is
 * enough to throw. `vi.spyOn` cannot express even the weaker form: jsdom's
 * Storage is a proxy, the spy silently never installs, and the assertion is
 * then vacuous.
 */
function blockStorage(): void {
  const refuse = (): never => {
    throw new DOMException("site data is blocked", "SecurityError");
  };
  Object.defineProperty(window, "sessionStorage", { configurable: true, get: refuse });
  Object.defineProperty(window, "localStorage", { configurable: true, get: refuse });
}

function restoreStorage(): void {
  Object.defineProperty(window, "sessionStorage", realSessionStorage);
  Object.defineProperty(window, "localStorage", realLocalStorage);
}

function setSearch(search: string): void {
  window.history.replaceState({}, "", `/plan${search}`);
}

async function mountComposer(): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(createElement(PlanComposer));
  });
  // The prefill is read in a microtask off the effect, so let it settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function describeFieldValue(): string {
  const field = document.querySelector<HTMLInputElement>("#plan-describe-first-query");
  if (!field) throw new Error("describe-first field did not render");
  return field.value;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve([]),
  } as unknown as Response)));
  sessionStorage.clear();
  localStorage.clear();
  setSearch("");
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => { current.unmount(); });
  }
  root = null;
  host?.remove();
  host = null;
  restoreStorage();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

describe("PlanComposer describe prefill", () => {
  it("prefers the URL ask over a held draft, and spends the draft anyway", async () => {
    sessionStorage.setItem(
      ASK_PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({ query: DRAFT_ASK }),
    );
    setSearch(`?query=${encodeURIComponent(URL_ASK)}`);

    await mountComposer();

    expect(describeFieldValue()).toBe(URL_ASK);
    // One-shot: the next /plan visit must not reopen on this ask.
    expect(sessionStorage.getItem(ASK_PLAN_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("falls back to the held draft when the URL carries no ask, and spends it", async () => {
    sessionStorage.setItem(
      ASK_PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({ query: DRAFT_ASK }),
    );

    await mountComposer();

    expect(describeFieldValue()).toBe(DRAFT_ASK);
    expect(sessionStorage.getItem(ASK_PLAN_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("still lands the URL ask when the browser refuses site data", async () => {
    setSearch(`?query=${encodeURIComponent(URL_ASK)}`);
    blockStorage();

    await mountComposer();

    // The whole composer has to survive, not just the prefill effect: a persist
    // effect that names a blocked storage throws during the same flush and
    // React unmounts the tree, which reads as a blank /plan.
    expect(describeFieldValue()).toBe(URL_ASK);
  });

  it("leaves the field empty when there is neither an ask nor a draft", async () => {
    await mountComposer();

    expect(describeFieldValue()).toBe("");
  });
});
