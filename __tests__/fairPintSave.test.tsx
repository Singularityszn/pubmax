// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useFairPintSave } from "@/components/map/fairpint/useFairPintSave";
import { inferNightContext } from "@/lib/nightPlanning";
import type { FairPintDrawn } from "@/lib/fairPint";
const share = vi.hoisted(() => vi.fn().mockResolvedValue("shared"));
vi.mock("@/lib/shareSheet", () => ({ shareNightObject: share }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });
const last: FairPintDrawn = { pence: 550, start: "2026-11-18T18:00", startIso: "2026-11-18T18:00:00.000Z", generated: { operationKey: "fair-pint-create-operation", groundingProof: "fixture-proof", inferredContext: inferNightContext("three stops in Camden").context, planningConfidence: { level: "low", score: 0, routeReady: false, missingEvidence: [], warnings: [], provenance: [] }, stops: [1, 2, 3].map((id) => ({ venueId: `venue-${id}`, venueName: `Pub ${id}` })) } };
it("retries an uncertain create once, prepares a join URL, and shares without another fetch", async () => {
  const id = "11111111-1111-4111-8111-111111111111", token = "a".repeat(32);
  const saved = new Map<string, unknown>(); let uncertain = true;
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/plans") {
      const key = new Headers(options?.headers).get("idempotency-key")!;
      const payload = JSON.parse(String(options?.body));
      if (saved.has(key)) expect(payload).toEqual(saved.get(key)); else saved.set(key, payload);
      if (uncertain) { uncertain = false; throw new TypeError("Connection lost after create"); }
      return Response.json({ plan: { plan: { id } }, memberToken: "test-member" });
    }
    expect(url).toBe(`/api/plans/${id}`);
    return Response.json({ inviteToken: token });
  });
  vi.stubGlobal("fetch", fetcher);
  let hook: ReturnType<typeof useFairPintSave>;
  function Host() { hook = useFairPintSave(last); return null; }
  const host = document.createElement("div"), root = createRoot(host);
  act(() => root.render(createElement(Host)));
  await act(async () => { await hook.save("Alex", "london"); });
  expect(hook!.state.phase).toBe("editing");
  expect(hook!.nameLocked).toBe(true);
  await act(async () => { await hook.save("Changed after uncertain create", "london"); });
  expect(saved.size).toBe(1);
  expect(saved.get(last.generated.operationKey)).toMatchObject({ creatorName: "Alex", groundingProof: last.generated.groundingProof, context: last.generated.inferredContext });
  expect(hook!.state.phase).toBe("locked");
  expect(hook!.url).toContain(`/invite/${token}`);
  const before = fetcher.mock.calls.length;
  await act(async () => { hook!.share(); expect(share).toHaveBeenLastCalledWith(expect.objectContaining({ url: hook!.url })); });
  expect(fetcher.mock.calls.length).toBe(before);
  act(() => root.unmount());
});
it("keeps a saved plan locked when its invite cannot be read", async () => {
  const id = "22222222-2222-4222-8222-222222222222";
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/plans" ? Response.json({ plan: { plan: { id } } }) : Response.json({ inviteToken: null })));
  let hook: ReturnType<typeof useFairPintSave>;
  function Host() { hook = useFairPintSave(last); return null; }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Host)));
  await act(async () => { await hook.save("Alex", "london"); });
  expect(hook!.state).toMatchObject({ phase: "locked", planId: id, link: { phase: "failed" } });
  expect(hook!.url).toBeNull();
  act(() => root.unmount());
});

it.each([null, "hosthandle"])("keeps an entered organiser name through time revalidation (handle %s)", async (handle) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
  const shards = await import("@/lib/slimShards");
  const loader = shards.createSlimShardLoader("london");
  const rows = [1, 2, 3].map((id) => ({
    id: `soho-${id}`, name: `Listed pub ${id}`, cheapestPrice: 5, borough: "Westminster",
    lat: 51.514, lng: -0.13, fairPint: [500, "https://example.com/menu", new Date().toISOString()] as const,
  }));
  const factory = vi.spyOn(shards, "createSlimShardLoader").mockReturnValue({
    ...loader, inBounds: async () => rows, coverageComplete: () => true,
  });
  const viewer = vi.spyOn(await import("@/components/auth/useViewerHandle"), "useViewerHandle").mockReturnValue(handle);
  const diagram = vi.spyOn(await import("@/components/wild/PintLine"), "default").mockImplementation(() => null);
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    if (input === "/api/plans/generate") {
      const { planStartIso } = JSON.parse(String(options?.body));
      return Response.json({
        operationKey: `operation-${planStartIso}`, groundingProof: `proof-${planStartIso}`,
        inferredContext: inferNightContext("three stops in Soho").context,
        planningConfidence: { level: "low", warnings: [], missingEvidence: [], provenance: [], score: 0, routeReady: false },
        stops: rows.map((row) => ({ venueId: row.id, venueName: row.name })),
      });
    }
    expect(input).toBe("/api/plans");
    return Response.json({ plan: { plan: { id: "11111111-1111-4111-8111-111111111111", inviteToken: "a".repeat(32) } } });
  });
  const { default: Flow } = await import("@/components/map/fairpint/FairPintFlow");
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  const setInput = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  localStorage.clear();
  try {
    await act(async () => root.render(createElement(Flow, {
      mobile: false, cityId: "london", center: [-0.13, 51.514],
      bounds: { west: -0.135, east: -0.125, south: 51.51, north: 51.518 },
      onCommit: () => {}, onRoute: () => {},
    })));
    await act(async () => { await vi.dynamicImportSettled(); });
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Draw my night"))!.click());
    const name = () => host.querySelector<HTMLInputElement>("#fair-pint-name")!;
    expect(name().value).toBe(handle ?? "");
    act(() => setInput(name(), "Alex"));
    expect(name().value).toBe("Alex");
    const start = host.querySelector<HTMLInputElement>("#fair-pint-start")!;
    const later = new Date(new Date(`${start.value}:00Z`).getTime() + 3600000).toISOString().slice(0, 16);
    act(() => setInput(start, later));
    await act(async () => start.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(name().value).toBe("Alex");
    expect(host.querySelector<HTMLInputElement>("#fair-pint-start")?.value).toBe(later);
    const lock = [...host.querySelectorAll("button")].find((button) => button.textContent === "Lock it in")!;
    expect(lock.disabled).toBe(false);
    await act(async () => { lock.click(); await vi.dynamicImportSettled(); });
    const saved = fetcher.mock.calls.find(([input]) => input === "/api/plans")!;
    const startIso = new Date(`${later}:00Z`).toISOString();
    expect(JSON.parse(String(saved[1]?.body))).toMatchObject({ creatorName: "Alex", startTime: startIso, groundingProof: `proof-${startIso}` });
    expect(new Headers(saved[1]?.headers).get("idempotency-key")).toBe(`operation-${startIso}`);
    expect(host.textContent).toContain("Locked in.");
  } finally {
    act(() => root.unmount()); host.remove();
    factory.mockRestore(); viewer.mockRestore(); diagram.mockRestore(); fetcher.mockRestore(); localStorage.clear();
  }
});
