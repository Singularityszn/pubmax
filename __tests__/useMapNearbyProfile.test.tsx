// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NIGHT_PROFILE_INPUT } from "@/lib/nightProfile";
import { useMapNearbyProfile } from "@/lib/useMapNearbyProfile";

const { fetchProfile } = vi.hoisted(() => ({ fetchProfile: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: fetchProfile }));
const saved = { ...DEFAULT_NIGHT_PROFILE_INPUT, createdAt: "2026-10-28T12:00:00Z", updatedAt: "2026-10-28T12:00:00Z" };
const response = (profile: unknown) => new Response(JSON.stringify({ profile }));

beforeEach(() => fetchProfile.mockReset());

describe("nearby account preferences", () => {
  it("does not request a profile when signed out", () => {
    const { result } = renderHook(() => useMapNearbyProfile(null));
    expect(result.current).toEqual({ profile: null, status: "signed-out" });
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  it("reads only authenticated no-store account preferences", async () => {
    fetchProfile.mockResolvedValue(response(saved));
    const { result } = renderHook(() => useMapNearbyProfile("account-a:1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.profile).toEqual(saved);
    expect(fetchProfile).toHaveBeenCalledWith("/api/me/night-profile", expect.objectContaining({ method: "GET", cache: "no-store", signal: expect.any(AbortSignal) }), { requiresIdentity: true });
  });

  it("clears previous preferences immediately and rejects a late response after an account change", async () => {
    let finishA!: (value: Response) => void;
    let finishB!: (value: Response) => void;
    fetchProfile.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishA = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishB = resolve; }));
    const { result, rerender } = renderHook(({ owner }) => useMapNearbyProfile(owner), { initialProps: { owner: "account-a:1" } });
    const firstSignal = fetchProfile.mock.calls[0]![1].signal as AbortSignal;
    rerender({ owner: "account-b:1" });
    expect(firstSignal.aborted).toBe(true);
    expect(result.current).toEqual({ profile: null, status: "loading" });
    await act(async () => { finishA(response(saved)); });
    expect(result.current.profile).toBeNull();
    await act(async () => { finishB(response(null)); });
    expect(result.current).toEqual({ profile: null, status: "ready" });
  });

  it("does not reuse old preferences when the same account returns after sign-out", async () => {
    fetchProfile.mockResolvedValueOnce(response(saved)).mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ owner }: { owner: string | null }) => useMapNearbyProfile(owner), { initialProps: { owner: "account-a:1" as string | null } });
    await waitFor(() => expect(result.current.profile).toEqual(saved));
    rerender({ owner: null });
    expect(result.current.profile).toBeNull();
    rerender({ owner: "account-a:1" });
    expect(result.current).toEqual({ profile: null, status: "loading" });
  });

  it("fails closed for malformed profiles and failed account reads", async () => {
    fetchProfile.mockResolvedValue(response({ bad: true }));
    const { result } = renderHook(() => useMapNearbyProfile("account-a:1"));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.profile).toBeNull();
  });
});
