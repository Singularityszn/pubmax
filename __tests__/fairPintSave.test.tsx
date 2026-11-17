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
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });
const last: FairPintDrawn = { pence: 550, start: "2026-11-18T18:00", generated: { operationKey: "fair-pint-create-operation", groundingProof: "fixture-proof", inferredContext: inferNightContext("three stops in Camden").context, planningConfidence: { level: "low", score: 0, routeReady: false, missingEvidence: [], warnings: [], provenance: [] }, stops: [1, 2, 3].map((id) => ({ venueId: `venue-${id}`, venueName: `Pub ${id}` })) } };
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
  await act(async () => { await hook.save("Alex", "london"); });
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
