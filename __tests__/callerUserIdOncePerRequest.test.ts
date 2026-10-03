import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Signed-in check-ins and saved-pubs each ask resolveMessageHandle and
// gateHandleAction, and each of those asks callerUserId. One Request must
// verify its bearer once. A second Request verifies again, including when it
// carries the same token or the first verification failed.

const authState = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
    getSupabaseAdmin: () => ({ auth: { getUser: authState.getUser } }),
  };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { POST as postCheckIn } from "@/app/api/check-ins/route";
import { POST as postSavedPub } from "@/app/api/saved-pubs/route";
import { callerUserId } from "@/lib/authServer";
import { __resetMemoryCheckIns } from "@/lib/checkInStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";
import { __resetMemorySavedPubs } from "@/lib/savedPubsStore";
import { getVenueIndex } from "@/lib/venueIndex";

const CHECK_INS = "http://localhost/api/check-ins";
const SAVED_PUBS = "http://localhost/api/saved-pubs";

let venueId = "";

function verifiedUser(id: string) {
  return {
    data: {
      user: { id, email: `${id}@example.com`, created_at: "2026-01-01T00:00:00Z" },
    },
    error: null,
  };
}

function bearer(url: string, token: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const index = await getVenueIndex();
  venueId = [...index.keys()][0] ?? "";
});

beforeEach(() => {
  __resetMemoryCheckIns();
  __resetMemoryProfiles();
  __resetMemorySavedPubs();
  authState.getUser.mockReset();
});

describe("one auth.getUser per Request", () => {
  it("verifies a signed-in check-in once and a signed-in save once", async () => {
    authState.getUser.mockImplementation(async (token: string) =>
      verifiedUser(token === "token-save" ? "user-save" : "user-checkin"),
    );

    const checkIn = await postCheckIn(
      bearer(CHECK_INS, "token-checkin", { handle: "q2checkin", areaSlug: "shoreditch" }),
    );
    expect(checkIn.status).toBe(201);
    expect(authState.getUser).toHaveBeenCalledTimes(1);
    expect(authState.getUser).toHaveBeenCalledWith("token-checkin");

    authState.getUser.mockClear();
    const saved = await postSavedPub(
      bearer(SAVED_PUBS, "token-save", {
        handle: "q2save",
        venueId,
        listType: "Want to Visit",
      }),
    );
    expect(saved.status).toBe(200);
    expect(authState.getUser).toHaveBeenCalledTimes(1);
    expect(authState.getUser).toHaveBeenCalledWith("token-save");
  });

  it("verifies two different Requests even when they carry the same token", async () => {
    authState.getUser.mockResolvedValue(verifiedUser("user-shared"));
    const first = bearer(CHECK_INS, "same-token", { handle: "q2first" });
    const second = bearer(CHECK_INS, "same-token", { handle: "q2second" });

    await expect(callerUserId(first)).resolves.toBe("user-shared");
    await expect(callerUserId(first)).resolves.toBe("user-shared");
    expect(authState.getUser).toHaveBeenCalledTimes(1);

    await expect(callerUserId(second)).resolves.toBe("user-shared");
    expect(authState.getUser).toHaveBeenCalledTimes(2);
    expect(authState.getUser).toHaveBeenNthCalledWith(1, "same-token");
    expect(authState.getUser).toHaveBeenNthCalledWith(2, "same-token");
  });

  it("remembers a failed verification for that Request only", async () => {
    authState.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 401, code: "bad_jwt" },
    });
    const first = bearer(CHECK_INS, "expired-token", { handle: "q2bad" });
    const second = bearer(CHECK_INS, "expired-token", { handle: "q2bad" });

    await expect(callerUserId(first)).resolves.toBeNull();
    await expect(callerUserId(first)).resolves.toBeNull();
    expect(authState.getUser).toHaveBeenCalledTimes(1);

    await expect(callerUserId(second)).resolves.toBeNull();
    expect(authState.getUser).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight verification when the same Request is asked twice at once", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    authState.getUser.mockImplementation(async () => {
      await gate;
      return verifiedUser("user-slow");
    });
    const request = bearer(CHECK_INS, "slow-token", { handle: "q2slow" });

    const first = callerUserId(request);
    const second = callerUserId(request);
    expect(authState.getUser).toHaveBeenCalledTimes(1);
    release();

    await expect(first).resolves.toBe("user-slow");
    await expect(second).resolves.toBe("user-slow");
    expect(authState.getUser).toHaveBeenCalledTimes(1);
  });
});
