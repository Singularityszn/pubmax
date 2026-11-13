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

import { recentPresenceWithAmbient } from "@/lib/presenceStore";

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
