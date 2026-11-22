import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("@/lib/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient("https://presence.example.test", "test-service-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => boundary.fetch(input, init) },
  });
  return {
    isSupabaseConfigured: () => true,
    requireSupabaseAdmin: () => client,
  };
});

import { leavePresence, recentPresenceWithAmbient } from "@/lib/presenceStore";

const NOW = Date.UTC(2026, 10, 7, 20);
const VENUE = "venue-presence-audience-test";

beforeEach(() => {
  boundary.fetch.mockReset();
  boundary.fetch.mockImplementation(async () => Response.json([{
    handle: "me",
    venue_id: VENUE,
    created_at: new Date(NOW - 60_000).toISOString(),
  }]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("durable presence audience", () => {
  it("deletes by account actor and owned handle without targeting a venue", async () => {
    boundary.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    await leavePresence({ handle: "me", actorHash: "account-actor" });
    const requests = boundary.fetch.mock.calls.map(([input, init]) => ({
      url: new URL(String(input)), method: init?.method,
    }));
    expect(requests).toHaveLength(2);
    expect(requests.map(({ url }) => [...url.searchParams])).toEqual([
      [["actor_hash", "eq.account-actor"]],
      [["handle", "eq.me"]],
    ]);
    expect(requests.every(({ url, method }) => url.pathname === "/rest/v1/pub_presence" && method === "DELETE")).toBe(true);
  });

  it.each([0, 1])("refuses to confirm a leave when database deletion %i fails", async (index) => {
    if (index === 1) boundary.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    boundary.fetch.mockResolvedValueOnce(Response.json({ message: "Database unavailable" }, { status: 503 }));
    await expect(leavePresence({ handle: "me", actorHash: "account-actor" })).rejects.toThrow("Database unavailable");
  });

  it.each([undefined, VENUE])("sends the audience with the limited PostgREST read at %s", async (venueId) => {
    const rows = await recentPresenceWithAmbient(venueId, NOW, ["me", "mate"]);

    expect(rows.map((row) => row.handle)).toEqual(["me"]);
    const url = new URL(String(boundary.fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/rest/v1/pub_presence");
    expect(url.searchParams.get("handle")).toBe("in.(me,mate)");
    expect(url.searchParams.get("limit")).toBe("40");
    expect(url.searchParams.get("expires_at")).toBe(`gt.${new Date(NOW).toISOString()}`);
    expect(url.searchParams.get("order")).toBe("created_at.desc");
    expect(url.searchParams.get("venue_id")).toBe(venueId ? `eq.${VENUE}` : null);
    expect(rows.every((row) => row.provenance !== "demo")).toBe(true);
  });

  it("does not read real presence for an empty audience", async () => {
    await expect(recentPresenceWithAmbient(undefined, NOW, [])).resolves.toEqual([]);
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("returns an empty list when the database read fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    boundary.fetch.mockImplementation(async () => Response.json({ message: "Database unavailable" }, { status: 503 }));
    await expect(recentPresenceWithAmbient(undefined, NOW, ["me"])).resolves.toEqual([]);
  });
});
