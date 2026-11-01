// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { getSession, viewer } = vi.hoisted(() => ({
  getSession: vi.fn(), viewer: { signedIn: true, identityResolved: true },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getSession } }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ signedIn: viewer.signedIn, signedOut: !viewer.signedIn, unresolved: false }),
}));
vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({ identityResolved: viewer.identityResolved }),
}));

import MatesPricesLine from "@/components/map/MatesPricesLine";
import { useDrinkerRegularNights } from "@/components/tonight/useTonightAnswerReads";
import { readProviderAccountRevision, setProviderIdentity } from "@/lib/authProviderRevision";
import { publishAuthActionState } from "@/lib/authedFetch";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
  getSession.mockReset();
  viewer.signedIn = true;
  viewer.identityResolved = true;
  setProviderIdentity("clerk", null);
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

function RegularNights() {
  const rows = useDrinkerRegularNights(2);
  return createElement("section", null, rows.map((row) =>
    createElement("div", { key: row.id, "data-own": String(row.own) }, row.placeName),
  ));
}

function regularNightAnswer(own: boolean) {
  return { reports: [{
    id: "c0ffee00-0000-4000-8000-000000000001", own, handle: "current_owner",
    venueId: "venue-crown", venueName: "The Crown", kind: "quiz", weekday: 2, status: "confirmed",
    lastSeenAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
  }] };
}

it("waits for the current credential before accepting a regular night's owner flags", async () => {
  setProviderIdentity("supabase", "account-b");
  getSession
    .mockResolvedValueOnce({ data: { session: { user: { id: "account-a" }, access_token: "previous-token" } } })
    .mockResolvedValue({ data: { session: { user: { id: "account-b" }, access_token: "current-token" } } });
  const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
    Response.json(regularNightAnswer(new Headers(init?.headers).get("authorization") === "Bearer current-token")),
  );
  vi.stubGlobal("fetch", fetchSpy);

  await act(async () => root.render(createElement(RegularNights)));

  expect(fetchSpy).not.toHaveBeenCalled();
  expect(host.querySelector("[data-own]")).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(50));
  expect(fetchSpy).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-own="true"]')?.textContent).toBe("The Crown");
});

it("preserves the anonymous regular-night read without reading a provider token", async () => {
  viewer.signedIn = false;
  viewer.identityResolved = false;
  setProviderIdentity("supabase", null);
  publishAuthActionState({ status: "signed-out", identityResolved: true });
  const fetchSpy = vi.fn(async () => Response.json(regularNightAnswer(false)));
  vi.stubGlobal("fetch", fetchSpy);

  await act(async () => root.render(createElement(RegularNights)));

  expect(getSession).not.toHaveBeenCalled();
  expect(fetchSpy).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-own="false"]')?.textContent).toBe("The Crown");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setProviderIdentity("supabase", null);
  publishAuthActionState({ status: "signed-out", identityResolved: true });
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  ["account-a", "account-b"],
  ["account-b", "account-a"],
])("waits for %s's credential when the SDK first returns %s's session", async (owner, previousOwner) => {
  setProviderIdentity("supabase", owner);
  const revision = readProviderAccountRevision();
  getSession
    .mockResolvedValueOnce({ data: { session: { user: { id: previousOwner }, access_token: "previous-token" } } })
    .mockResolvedValue({ data: { session: { user: { id: owner }, access_token: "current-token" } } });
  const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const authorization = new Headers(init?.headers).get("authorization");
    return Response.json(authorization === "Bearer current-token" ? {
      prices: [{ handle: "current_mate", priceGbp: 5, drink: "Lager", measure: "pint", loggedAt: new Date().toISOString() }],
    } : { error: "Wrong or missing account" }, { status: authorization === "Bearer current-token" ? 200 : 401 });
  });
  vi.stubGlobal("fetch", fetchSpy);

  await act(async () => root.render(createElement(MatesPricesLine, { venueId: "venue-harp" })));

  expect(fetchSpy).not.toHaveBeenCalled();
  expect(host.textContent).toBe("");
  await act(async () => vi.advanceTimersByTimeAsync(50));
  expect(fetchSpy).toHaveBeenCalledOnce();
  expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer current-token");
  expect(host.textContent).toContain("@current_mate");
  expect(getSession).toHaveBeenCalledTimes(2);
  expect(readProviderAccountRevision()).toBe(revision);
});

it("leaves mates prices empty when the SDK never supplies the current account's token", async () => {
  setProviderIdentity("supabase", "account-b");
  getSession.mockResolvedValue({ data: { session: { user: { id: "account-a" }, access_token: "previous-token" } } });
  const fetchSpy = vi.fn(async () => Response.json({ prices: [] }));
  vi.stubGlobal("fetch", fetchSpy);

  await act(async () => root.render(createElement(MatesPricesLine, { venueId: "venue-harp" })));
  await act(async () => vi.advanceTimersByTimeAsync(2_000));

  expect(fetchSpy).not.toHaveBeenCalled();
  expect(host.textContent).toBe("");
});

it.each(["mates", "regular nights"])("reads %s after canonical identity resolves beyond the transport timeout", async (surface) => {
  setProviderIdentity("supabase", "account-b");
  viewer.identityResolved = false;
  publishAuthActionState({ status: "signed-in", identityResolved: false });
  getSession.mockResolvedValue({ data: { session: { user: { id: "account-b" }, access_token: "current-token" } } });
  const fetchSpy = vi.fn(async () => Response.json(surface === "mates" ? {
    prices: [{ handle: "current_mate", priceGbp: 5, drink: "Lager", measure: "pint", loggedAt: new Date().toISOString() }],
  } : regularNightAnswer(true)));
  vi.stubGlobal("fetch", fetchSpy);
  const element = () => surface === "mates"
    ? createElement(MatesPricesLine, { venueId: "venue-harp" })
    : createElement(RegularNights);
  await act(async () => root.render(element()));
  await act(async () => vi.advanceTimersByTimeAsync(2_100));
  expect(fetchSpy).not.toHaveBeenCalled();

  await act(async () => {
    viewer.identityResolved = true;
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    root.render(element());
  });

  expect(fetchSpy).toHaveBeenCalledOnce();
  if (surface === "mates") expect(host.textContent).toContain("@current_mate");
  else expect(host.querySelector('[data-own="true"]')?.textContent).toBe("The Crown");
});
