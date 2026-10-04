import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const isLimitedMock = vi.hoisted(() =>
  vi.fn<(local: string, durable: string) => Promise<boolean>>(async () => false),
);

vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: isLimitedMock };
});

import { POST as postComment } from "@/app/api/pint-drops/comments/route";
import { POST as postSaved } from "@/app/api/saved-pubs/route";
import * as venueIndex from "@/lib/venueIndex";

const COMMENTS_URL = "http://localhost/api/pint-drops/comments";
const SAVED_URL = "http://localhost/api/saved-pubs";
const REAL_VENUE_ID = "venue-test-rate";

function postCommentReq(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return postComment(
    new Request(COMMENTS_URL, { method: "POST", body: JSON.stringify(body), headers }),
  );
}

function postSavedReq(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return postSaved(
    new Request(SAVED_URL, { method: "POST", body: JSON.stringify(body), headers }),
  );
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  isLimitedMock.mockReset();
  isLimitedMock.mockResolvedValue(false);
  vi.spyOn(venueIndex, "resolveVenue").mockResolvedValue({
    id: REAL_VENUE_ID,
    name: "Test Pub",
    borough: "Westminster",
    lat: 51.5,
    lng: -0.1,
    kind: "pub",
  });
});

describe("POST /api/pint-drops/comments dual rate limits", () => {
  it("passes when both budgets allow the write", async () => {
    const res = await postCommentReq(
      { dropId: "drop-ok", handle: "ale", body: "nice pint" },
      { "x-forwarded-for": "198.51.100.1" },
    );
    expect(res.status).toBe(201);
    expect(isLimitedMock).toHaveBeenCalledTimes(2);
  });

  it("429s with the existing shape when the actor budget is exhausted", async () => {
    isLimitedMock.mockResolvedValueOnce(true);
    const res = await postCommentReq(
      { dropId: "drop-a", handle: "ale", body: "one" },
      { "x-forwarded-for": "198.51.100.2" },
    );
    expect(res.status).toBe(429);
    expect(isLimitedMock).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({
      error: "Too many comments, slow down.",
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("429s with the existing shape when the per-drop budget is exhausted", async () => {
    isLimitedMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = await postCommentReq(
      { dropId: "drop-hot", handle: "ale", body: "one" },
      { "x-forwarded-for": "198.51.100.3" },
    );
    expect(res.status).toBe(429);
    expect(isLimitedMock).toHaveBeenCalledTimes(2);
    expect(await res.json()).toEqual({
      error: "Too many comments, slow down.",
      code: "RATE_LIMITED",
      retryable: true,
    });
  });
});

describe("POST /api/saved-pubs dual rate limits", () => {
  it("passes when both budgets allow the toggle", async () => {
    const res = await postSavedReq(
      { handle: "ale", venueId: REAL_VENUE_ID, listType: "Historic" },
      { "x-forwarded-for": "192.0.2.10" },
    );
    expect(res.status).toBe(200);
    expect(isLimitedMock).toHaveBeenCalledTimes(2);
  });

  it("429s when the per-handle save budget is exhausted", async () => {
    isLimitedMock.mockResolvedValueOnce(true);
    const res = await postSavedReq(
      { handle: "savehandle", venueId: REAL_VENUE_ID, listType: "Historic" },
      { "x-forwarded-for": "192.0.2.11" },
    );
    expect(res.status).toBe(429);
    expect(isLimitedMock).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({
      error: "Too many saves, slow down.",
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("429s when the per-actor save budget is exhausted", async () => {
    isLimitedMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = await postSavedReq(
      { handle: "actorhandle", venueId: REAL_VENUE_ID, listType: "Historic" },
      { "x-forwarded-for": "192.0.2.12" },
    );
    expect(res.status).toBe(429);
    expect(isLimitedMock).toHaveBeenCalledTimes(2);
    expect(await res.json()).toEqual({
      error: "Too many saves, slow down.",
      code: "RATE_LIMITED",
      retryable: true,
    });
  });
});
