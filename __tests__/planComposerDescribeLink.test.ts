// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
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
import { createPlanIntakeDraft, writePlanIntakeDraft } from "@/lib/planIntake";
import { writePlanDraftEnvelope } from "@/lib/planDraft";

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

function conciergeFieldValue(): string {
  const field = document.querySelector<HTMLInputElement>("#plan-concierge-query");
  if (!field) throw new Error("concierge field did not render");
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

    // The composer has to survive whole, not just the prefill effect: a persist
    // effect that names a blocked storage throws during the same flush and
    // React unmounts the tree, which reads as a blank /plan. This mounts the
    // composer alone - the page's own AuthProvider is mocked out here, and the
    // nudge it renders on every page carries its own blocked-storage coverage
    // in __tests__/identityNudge.test.ts.
    expect(describeFieldValue()).toBe(URL_ASK);
  });

  it("leaves the field empty when there is neither an ask nor a draft", async () => {
    await mountComposer();

    expect(describeFieldValue()).toBe("");
  });
});

// A URL ask is a fresher intention than anything the browser held, and the two
// states below are the ones that used to hide the only surface showing it - so
// the CTA landed on /plan with the ask nowhere on screen and nothing said.
describe("PlanComposer never drops a URL ask", () => {
  it("opens describe-first over an unfinished wizard draft", async () => {
    writePlanIntakeDraft(createPlanIntakeDraft({ kind: "patch", id: "soho" }));
    setSearch(`?query=${encodeURIComponent(URL_ASK)}`);

    await mountComposer();

    expect(describeFieldValue()).toBe(URL_ASK);
  });

  it("still opens on the wizard when no ask rides the URL", async () => {
    writePlanIntakeDraft(createPlanIntakeDraft({ kind: "patch", id: "soho" }));

    await mountComposer();

    expect(
      document.querySelector("#plan-describe-first-query"),
      "an unfinished wizard draft still wins on its own",
    ).toBeNull();
  });

  it("lands the ask in the composer's own field when a held pub opens it", async () => {
    // A held acceptance opens the full composer, so describe-first never renders.
    writePlanDraftEnvelope(
      {
        title: "",
        creatorName: "",
        startTime: "",
        conciergeQuery: "",
        stops: [{ key: 1, venueId: "venue-held", venueName: "The Held Arms" }],
        acceptedAnchor: {
          venueId: "venue-held",
          source: "pal",
          cityId: "london",
          acceptedArea: null,
          startsAt: null,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      },
      "planning-intent",
      sessionStorage,
    );
    setSearch(`?query=${encodeURIComponent(URL_ASK)}`);

    await mountComposer();

    expect(document.querySelector("#plan-describe-first-query")).toBeNull();
    expect(conciergeFieldValue()).toBe(URL_ASK);
  });
});

// The server knows no address, so anything the composer reads off
// `window.location` during the HYDRATION render paints a field the server left
// empty - and React reconciles that as a mismatch. The URL ask therefore waits
// for the remount that follows hydration.
describe("PlanComposer hydration", () => {
  // An ask naming its own crawl size, so the stop-count picker's `aria-pressed`
  // really differs between the server's default and anything read off the URL.
  // An ask that infers the default 3 would make this assertion vacuous.
  const SIZED_ASK = "A five stop crawl in Soho";

  it("hydrates a /plan?query= document without a mismatch", async () => {
    // The real server has no `window`, so the helper answers null there
    // whatever the address is - which is what an empty search models here.
    // Rendering the server HTML with the address in place would make both
    // sides read it and leave nothing for this test to catch.
    setSearch("");
    const serverHtml = renderToString(createElement(PlanComposer));
    setSearch(`?query=${encodeURIComponent(SIZED_ASK)}`);

    host = document.createElement("div");
    host.innerHTML = serverHtml;
    document.body.append(host);

    const complaints: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      complaints.push(args.map((arg) => String(arg)).join(" "));
    });

    await act(async () => {
      root = hydrateRoot(host!, createElement(PlanComposer));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      complaints.filter((line) => /hydrat|did not match|mismatch/i.test(line)),
      "hydrating the composer should not reconcile against a different tree",
    ).toEqual([]);
    // The ask still lands, on the remount that follows hydration.
    expect(describeFieldValue()).toBe(SIZED_ASK);
  });
});
