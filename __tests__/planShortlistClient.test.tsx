// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  identityResolved: true,
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  getAccessToken: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => state }));
vi.mock("@/lib/authClient", () => ({ getAccessToken: state.getAccessToken }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push }),
  useSearchParams: () => new URLSearchParams("shortlist=1&area=bank"),
}));

import PlanShortlistEntry from "@/components/plan/PlanShortlistEntry";
import PlanShortlistHost from "@/components/plan/PlanShortlistHost";
import { ShortlistOptionDetails } from "@/components/plan/PlanShortlistCard";
import { publishAuthActionState } from "@/lib/authedFetch";
import { setProviderIdentity } from "@/lib/authProviderRevision";
import { clearPlanCapability } from "@/lib/planSessionCapability";
import type { ShortlistOption, ShortlistView } from "@/lib/planShortlist";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const id = "22222222-2222-4222-8222-222222222222";
const endpoint = `/api/plans/${id}/shortlist`;
const oldToken = "a".repeat(32);
const newToken = "b".repeat(32);
const option: ShortlistOption = {
  venueId: "pub-a", venueName: "Pub A", lat: 51.5, lng: -0.1, listedPint: null, reasons: ["Quiet"],
};
const view: ShortlistView = {
  options: [option], counts: { "pub-a": 0 }, myVote: null, confirmed: null, expiresAt: "2099-01-08T00:00:00Z",
};
const host = () => ({ shortlist: view, token: oldToken, budgetLimitPence: null, expired: false });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const session = () => json({ active: true, role: "host", collaborationAuthorized: true });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  state.identityResolved = true;
  state.user = { id: "11111111-1111-4111-8111-111111111111" };
  state.getAccessToken.mockReset().mockResolvedValue("account-token");
  state.push.mockReset();
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  setProviderIdentity("supabase", state.user.id);
  clearPlanCapability(id);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  clearPlanCapability(id);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mountHost() {
  await act(async () => { root.render(createElement(PlanShortlistHost, { planId: id })); });
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => button.click());
}
async function confirmPub() {
  container.querySelector<HTMLSelectElement>("select[name=venueId]")!.value = "pub-a";
  container.querySelector<HTMLInputElement>("input[name=start]")!.value = "2099-01-01T19:00";
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

describe("organiser account continuity", () => {
  it.each([true, false])("creates with the current account bearer when signed in: %s", async (signedIn) => {
    if (!signedIn) state.getAccessToken.mockResolvedValue(null);
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).startsWith("/api/plans/shortlist?")) return json({ options: [option] });
      const auth = new Headers(init?.headers).get("authorization");
      return auth === (signedIn ? "Bearer account-token" : null)
        ? json({ planId: id, created: true }) : json({ error: "Wrong account" }, 403);
    });
    await act(async () => { root.render(createElement(PlanShortlistEntry, { areas: [{ slug: "bank", name: "Bank" }], children: null })); });
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
    await click("Create shortlist");
    expect(state.push).toHaveBeenCalledWith(`/plan/${id}`);
    expect(fetcher.mock.calls.filter(([input]) => input === "/api/plans")).toHaveLength(1);
  });

  it.each(["account recovery", "anonymous cookie"])("loads and confirms through %s", async (mode) => {
    let cookie = mode === "anonymous cookie";
    if (cookie) {
      state.user = null;
      state.getAccessToken.mockResolvedValue(null);
      publishAuthActionState({ status: "signed-out", identityResolved: true });
      setProviderIdentity("supabase", null);
    }
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/session")) {
        if (init?.method === "PATCH") {
          cookie = new Headers(init.headers).get("authorization") === "Bearer account-token";
          return cookie ? session() : json({ active: false }, 403);
        }
        return cookie ? session() : json({ active: false });
      }
      if (!cookie) return json({ error: "No organiser capability" }, 403);
      return init?.method === "POST"
        ? json({ shortlist: { ...view, confirmed: { venueId: "pub-a", startTime: "2099-01-01T19:00:00Z" } } })
        : json(host());
    });
    await mountHost();
    await confirmPub();
    expect(container.querySelector("time")?.dateTime).toBe("2099-01-01T19:00:00Z");
    expect(container.querySelector("a[href*='maps']")).not.toBeNull();
  });
});

describe("superseded organiser reads", () => {
  it.each([
    { action: "confirm", status: 200 }, { action: "rotate", status: 200 },
    { action: "confirm", status: 503 }, { action: "rotate", status: 503 },
  ])("keeps $action when an older refresh answers $status", async ({ action, status }) => {
    const stale = deferred<Response>();
    let reads = 0;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/session")) return session();
      if (String(input).endsWith("/invite-rotate")) return json({ inviteToken: newToken });
      if (init?.method === "POST") return json({ shortlist: { ...view, confirmed: { venueId: "pub-a", startTime: "2099-01-01T19:00:00Z" } } });
      if (String(input) === endpoint && ++reads > 1) return stale.promise;
      return json(host());
    });
    await mountHost();
    await click("Refresh votes");
    if (action === "rotate") await click("Make new invite link");
    else await confirmPub();
    await act(async () => stale.resolve(json(status === 200 ? host() : { error: "Read failed" }, status)));
    if (action === "rotate") {
      expect(container.querySelector<HTMLInputElement>("input[type=url]")?.value).toContain(newToken);
      expect(container.textContent).toContain("New invite link ready");
    } else {
      expect(container.querySelector("time")?.dateTime).toBe("2099-01-01T19:00:00Z");
      expect(container.querySelector("form")).toBeNull();
      expect(container.textContent).toContain("Pub and time confirmed");
    }
  });

  it("keeps the latest vote totals when refreshes finish in reverse order", async () => {
    const stale = deferred<Response>();
    let reads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/session")) return session();
      reads++;
      if (reads === 2) return stale.promise;
      return json(reads === 3 ? { ...host(), shortlist: { ...view, counts: { "pub-a": 2 } } } : host());
    });
    await mountHost();
    await click("Refresh votes");
    await click("Refresh votes");
    await act(async () => stale.resolve(json(host())));
    expect(container.querySelector("ul[aria-label='Vote totals']")?.textContent).toContain("Pub A · 2");
  });
});

it("removes expired price and budget claims from cached options when the tab resumes", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-29T00:00:00Z"));
  const cached: ShortlistOption = {
    ...option,
    listedPint: { priceGbp: 5, pintName: "Lager", observedOn: "2026-01-01", publisher: { label: "Pub menu", url: "https://example.com/menu" } },
    reasons: ["Quiet", "Listed pint meets the per-pint limit"],
  };
  await act(async () => root.render(createElement(ShortlistOptionDetails, { option: cached })));
  expect(container.textContent).toContain("£5");
  vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(container.textContent).not.toContain("£5");
  expect(container.textContent).not.toContain("meets the per-pint limit");
  expect(container.textContent).toContain("No current listed pint to check against the limit");
});
