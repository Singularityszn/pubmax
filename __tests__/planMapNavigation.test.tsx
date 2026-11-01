// @vitest-environment jsdom

import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanMapNavigationProvider, usePlanMapHref, usePlanMapScope, useRegisterPlanMapRoute } from "@/components/nav/PlanMapNavigation";
import { clearPlanCapability, writePlanCapability } from "@/lib/planSessionCapability";
import type { PlanPrivacyPreviewDTO } from "@/lib/planPrivacy";
import PlanSummary, { PLAN_PENDING_ROUTE_PREFIX } from "@/components/plan/PlanSummary";
import { setProviderIdentity } from "@/lib/authProviderRevision";
import { buildCrawlMapHref } from "@/lib/crawlUrl";
import { clearPlanMemberProjectionRead } from "@/components/plan/usePlanMemberRead";

const viewer = vi.hoisted(() => ({ pathname: "/plan/saved", auth: { identityResolved: true, providerAuthState: "signed-out", user: null as { id: string } | null } }));
vi.mock("next/navigation", () => ({ usePathname: () => viewer.pathname }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => viewer.auth }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => viewer.auth }));
vi.mock("@/components/plan/PlanRoute", () => ({ default: ({ stops }: { stops: { venueId: string }[] }) => <ol>{stops.map((stop) => <li key={stop.venueId}>{stop.venueId}</li>)}</ol> }));
vi.mock("@/components/plan/PlanCollaborationPanel", () => ({ default: () => null }));
vi.mock("@/components/round/RoundStarter", () => ({ default: () => null }));


let root: Root;
let host: HTMLDivElement;
let capturedScope = "";
function SavedRoute({ ids = ["third", "first", "second"], savedScope }: { ids?: string[]; savedScope?: string }) {
  const scope = usePlanMapScope("saved");
  useEffect(() => { capturedScope = scope; }, [scope]);
  useRegisterPlanMapRoute("saved", savedScope ?? scope, buildCrawlMapHref(ids));
  return null;
}
function MapLink() {
  return <a data-testid="map-link" href={usePlanMapHref("/map?city=london")}>Map</a>;
}
async function render({ show = true, scope, ids }: { show?: boolean; scope?: string; ids?: string[] } = {}) {
  await act(async () => root.render(<StrictMode><PlanMapNavigationProvider>{show && <SavedRoute ids={ids} savedScope={scope} />}<MapLink /></PlanMapNavigationProvider></StrictMode>));
}
const href = () => host.querySelector('[data-testid="map-link"]')?.getAttribute("href");
beforeEach(() => {
  clearPlanMemberProjectionRead("saved");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  viewer.pathname = "/plan/saved";
  viewer.auth = { identityResolved: true, providerAuthState: "signed-out", user: null };
  localStorage.clear();
  sessionStorage.clear();
  writePlanCapability("saved", { token: "member", role: "host", collaborationAuthorized: true });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearPlanCapability("saved");
  clearPlanMemberProjectionRead("saved");
  vi.unstubAllGlobals();
});

describe("saved plan Map navigation", () => {
  it("keeps canonical stop order without depending on the plan start time", async () => {
    await render();
    expect(href()).toBe("/map?mode=build&pubs=third%2Cfirst%2Csecond");
  });
  it("keeps the preferred city for a privacy preview with no saved route", async () => {
    await render({ show: false });
    expect(href()).toBe("/map?city=london");
  });
  it("clears registration when the member surface unmounts under Strict Mode", async () => {
    await render();
    await render({ show: false });
    expect(href()).toBe("/map?city=london");
  });
  it("rejects a different plan and clean map navigation before effect cleanup", async () => {
    await render();
    viewer.pathname = "/plan/other";
    await render();
    expect(href()).toBe("/map?city=london");
    viewer.pathname = "/map";
    await render();
    expect(href()).toBe("/map?city=london");
  });
  it("rejects stale member data when the capability changes or disappears", async () => {
    await render();
    const oldScope = capturedScope;
    await act(async () => writePlanCapability("saved", { token: "replacement", role: "host", collaborationAuthorized: false }));
    await render({ scope: oldScope });
    expect(href()).toBe("/map?city=london");
    await act(async () => clearPlanCapability("saved"));
    expect(href()).toBe("/map?city=london");
  });
  it("rejects stale member data when the provider account changes", async () => {
    await render();
    const oldScope = capturedScope;
    await act(async () => setProviderIdentity("supabase", "different-account"));
    await render({ scope: oldScope });
    expect(href()).toBe("/map?city=london");
  });
  it("invalidates a saved registration when provider authentication changes", async () => {
    await render();
    const oldScope = capturedScope;
    viewer.auth.identityResolved = false;
    viewer.auth.providerAuthState = "unresolved";
    await render({ scope: oldScope });
    expect(href()).toBe("/map?city=london");
    viewer.auth.providerAuthState = "unavailable";
    await render({ scope: oldScope });
    expect(href()).toBe("/map?city=london");
  });
});

const preview: PlanPrivacyPreviewDTO = { hostDisplayName: "Sam", areaName: "Soho", startLabel: "18:00", stopCount: 3, vibeLabel: null, accessibilitySummary: null, routeReady: true, visibility: "preview" as const };
function memberState(ids: string[]) {
  return { plan: { id: "saved", title: "Tonight", startTime: "2026-10-26T18:00:00.000Z", createdAt: "2026-10-26T08:00:00.000Z", routeRevision: 1 }, stops: ids.map((venueId, position) => ({ venueId, venueName: venueId, position })), crew: [], context: { nightArea: "soho", stopCount: 3 } };
}
async function renderSummary() {
  await act(async () => root.render(<PlanMapNavigationProvider><PlanSummary planId="saved" initialPreview={preview} /><MapLink /></PlanMapNavigationProvider>));
}

it("does not register unsaved route edits from the pending draft", async () => {
  localStorage.setItem(`${PLAN_PENDING_ROUTE_PREFIX}saved`, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), expectedRouteRevision: 1, stops: memberState(["draft-a", "draft-b", "draft-c"]).stops }));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(memberState(["third", "first", "second"]))));
  await renderSummary();
  expect(href()).toBe("/map?mode=build&pubs=third%2Cfirst%2Csecond");
});

it.each(["unavailable", "unresolved"])("registers a cookie member route only after canonical success while authentication is %s", async (providerState) => {
  viewer.auth.identityResolved = false;
  viewer.auth.providerAuthState = providerState;
  let resolveMember!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveMember = resolve; })));
  await renderSummary();
  expect(href()).toBe("/map?city=london");
  await act(async () => resolveMember(Response.json(memberState(["third", "first", "second"]))));
  expect(host.querySelectorAll("li")).toHaveLength(3);
  expect(href()).toBe("/map?mode=build&pubs=third%2Cfirst%2Csecond");
  await act(async () => clearPlanCapability("saved"));
  expect(href()).toBe("/map?city=london");
});

it("does not reuse a delayed previous account read for the next account", async () => {
  let resolveOld!: (response: Response) => void;
  let resolveNew!: (response: Response) => void;
  const fetcher = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveNew = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  await renderSummary();
  await act(async () => setProviderIdentity("supabase", "delayed-next-account"));
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => resolveOld(Response.json(memberState(["old-a", "old-b", "old-c"]))));
  expect(href()).toBe("/map?city=london");
  await act(async () => resolveNew(Response.json(memberState(["new-a", "new-b", "new-c"]))));
  expect(href()).toBe("/map?mode=build&pubs=new-a%2Cnew-b%2Cnew-c");
});

it.each([1, null])("replaces the previous account's canonical stops even with route revision %s", async (revision) => {
  const previous = memberState(["old-a", "old-b", "old-c"]);
  const next = memberState(["new-a", "new-b", "new-c"]);
  const withRevision = (state: ReturnType<typeof memberState>) => ({ ...state, plan: { ...state.plan, routeRevision: revision } });
  // Only the member read takes the queued answers: the night panels under the
  // summary (presentation, clues, table beacon) ask their own endpoints.
  const memberReads = [withRevision(previous), withRevision(next)];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (/^\/api\/plans\/[^/?]+$/.test(url)) return Response.json(memberReads.shift() ?? withRevision(next));
    return Response.json({ error: "not_found" }, { status: 404 });
  }));
  await renderSummary();
  expect(href()).toBe("/map?mode=build&pubs=old-a%2Cold-b%2Cold-c");
  await act(async () => setProviderIdentity("supabase", `same-revision-account-${revision}`));
  expect(href()).toBe("/map?mode=build&pubs=new-a%2Cnew-b%2Cnew-c");
  expect(Array.from(host.querySelectorAll("li"), (item) => item.textContent)).toEqual(["new-a", "new-b", "new-c"]);
});

it("keeps a newer registration when an older publisher cleans up", async () => {
  const tree = (older: boolean) => <PlanMapNavigationProvider>{older && <SavedRoute key="older" ids={["old-a", "old-b"]} />}<SavedRoute key="newer" ids={["new-a", "new-b"]} /><MapLink /></PlanMapNavigationProvider>;
  await act(async () => root.render(tree(true)));
  expect(href()).toBe("/map?mode=build&pubs=new-a%2Cnew-b");
  await act(async () => root.render(tree(false)));
  expect(href()).toBe("/map?mode=build&pubs=new-a%2Cnew-b");
});
