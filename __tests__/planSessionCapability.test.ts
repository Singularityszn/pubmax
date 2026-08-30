import { afterEach, describe, expect, it, vi } from "vitest";

const signedInActionFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/authedFetch", () => ({ signedInActionFetch }));

import { parsePlanCapabilitySnapshot, PlanSessionUnavailableError, readPlanCapabilitySnapshot, restorePlanCapability, writePlanCapability } from "@/lib/planSessionCapability";

function legacyWindow(planId: string, token = "legacy-secret") {
  const values = new Map<string, string>([[`pubmax-plan-member:${planId}`, token]]);
  const sessionStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
  (globalThis as { window?: unknown }).window = { dispatchEvent: vi.fn(), sessionStorage };
  vi.stubGlobal("sessionStorage", sessionStorage);
  return { values, sessionStorage };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  signedInActionFetch.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("plan session capabilities", () => {
  it("keeps bearer authority in memory and preserves the server-issued role", () => {
    const sessionStorage = { setItem: vi.fn(), getItem: vi.fn() };
    (globalThis as { window?: unknown }).window = { dispatchEvent: vi.fn(), sessionStorage };
    const id = "6ab5ca40-836b-4970-9477-d1779fdd31ab";
    writePlanCapability(id, { token: "bearer-secret", collaborationAuthorized: true, role: "host" });
    expect(parsePlanCapabilitySnapshot(readPlanCapabilitySnapshot(id))).toEqual({
      token: "bearer-secret",
      collaborationAuthorized: true,
      role: "host",
    });
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.getItem).not.toHaveBeenCalled();
  });

  it("exchanges then purges legacy sessionStorage bearer keys", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const { values } = legacyWindow(id);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ active: true, role: "host", collaborationAuthorized: true })));
    await restorePlanCapability(id);
    expect(fetchMock).toHaveBeenCalledWith(`/api/plans/${id}/session`, expect.objectContaining({
      method: "POST",
      headers: { authorization: "Bearer legacy-secret" },
    }));
    expect([...values.keys()]).toEqual([]);
  });

  it("keeps a purged legacy token in volatile memory across a retryable 503", async () => {
    const id = "22222222-3333-4444-8555-666666666666";
    const { values } = legacyWindow(id);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: true, role: "host", collaborationAuthorized: true })));
    await expect(restorePlanCapability(id)).rejects.toBeInstanceOf(PlanSessionUnavailableError);
    expect([...values.keys()]).toEqual([]);
    await expect(restorePlanCapability(id)).resolves.toMatchObject({ role: "host" });
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/plans/${id}/session`, expect.objectContaining({ method: "POST" }));
  });

  it("keeps volatile legacy recovery across a network failure", async () => {
    const id = "33333333-4444-4555-8666-777777777777";
    legacyWindow(id);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: true, role: "guest", collaborationAuthorized: true })));
    await expect(restorePlanCapability(id)).rejects.toBeInstanceOf(PlanSessionUnavailableError);
    await expect(restorePlanCapability(id)).resolves.toMatchObject({ role: "guest" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to a valid HttpOnly cookie when a legacy token is stale", async () => {
    const id = "44444444-5555-4666-8777-888888888888";
    legacyWindow(id, "stale-secret");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: false }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: true, role: "host", collaborationAuthorized: true })));
    await expect(restorePlanCapability(id)).resolves.toMatchObject({ role: "host" });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ cache: "no-store" }));
  });

  it("recovers an account-owned Plan after the HttpOnly cookie is lost", async () => {
    const id = "45555555-5555-4666-8777-888888888888";
    legacyWindow(id, "");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: false })));
    signedInActionFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      active: true,
      role: "guest",
      collaborationAuthorized: false,
    })));

    await expect(restorePlanCapability(id)).resolves.toMatchObject({
      token: "__pubmax_http_only_plan_session__",
      role: "guest",
      collaborationAuthorized: false,
    });
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ cache: "no-store" }));
    expect(signedInActionFetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "PATCH",
      headers: { "idempotency-key": expect.any(String) },
    }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not spend account recovery budget for a signed-out visitor", async () => {
    const id = "45655555-5555-4666-8777-888888888888";
    legacyWindow(id, "");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: false })));
    signedInActionFetch.mockResolvedValueOnce(null);

    await expect(restorePlanCapability(id)).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(signedInActionFetch).toHaveBeenCalledOnce();
  });

  it("settles a stalled session read as unavailable", async () => {
    const id = "55555555-6666-4777-8888-999999999999";
    (globalThis as { window?: unknown }).window = {
      dispatchEvent: vi.fn(),
      sessionStorage: { getItem: vi.fn(() => null), removeItem: vi.fn() },
    };
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => undefined),
    );

    const restoration = restorePlanCapability(id);
    const rejection = expect(restoration).rejects.toBeInstanceOf(PlanSessionUnavailableError);
    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledWith(`/api/plans/${id}/session`, expect.anything());
    vi.useRealTimers();
  });
});
