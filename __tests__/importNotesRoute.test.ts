import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Supabase to use in-memory rate limiting, and disable serverEnv checks.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
  };
});

vi.mock("@/lib/serverEnv", () => ({
  assertServerEnv: () => {},
  assertProductionSecrets: () => {},
}));

// Mock the admin auth so we can control moderator status
vi.mock("@/lib/adminAuth", () => ({
  isModerator: () => true,
}));

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
});

describe("POST /api/admin/import-notes", () => {
  it("rate-limits import-notes submissions per hashed client IP", async () => {
    const { POST } = await import("@/app/api/admin/import-notes/route");
    const responses: Response[] = [];
    for (let i = 0; i < 11; i++) {
      responses.push(
        await POST(
          new Request("http://localhost/api/admin/import-notes", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-for": "198.51.100.40",
            },
            body: JSON.stringify({
              body: `https://example.com/note-${i}`,
              venueId: "venue-test",
              venueName: "Test Venue",
              provenance: "sourced",
            }),
          }),
        ),
      );
    }

    expect(responses.slice(0, 10).every((res) => res.status === 200)).toBe(true);
    expect(responses[10].status).toBe(429);
    expect(await responses[10].json()).toEqual({ error: "Too many requests, slow down." });
  });
});
