import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emitIdentityHandleChanged,
  identityHandleForOwner,
  resolveCanonicalIdentity,
} from "@/lib/identityClient";

describe("identity handle events", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts handle changes only for the current account", () => {
    const detail = { ownerId: "user-a", handle: "alice" };

    expect(identityHandleForOwner(detail, "user-a")).toBe("alice");
    expect(identityHandleForOwner(detail, "user-b")).toBeNull();
    expect(identityHandleForOwner(detail, null)).toBeNull();
  });

  it("rejects legacy unscoped handle events", () => {
    expect(identityHandleForOwner({ handle: "alice" }, "user-a")).toBeNull();
  });

  it("invalidates matching anonymous Round identity when claimed", () => {
    const values = new Map<string, string>([
      [
        "pubmax_round_anonymous_identity_v1",
        JSON.stringify({ owner: "anonymous", handle: "bob" }),
      ],
    ]);
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    vi.stubGlobal("window", {
      localStorage,
      dispatchEvent: vi.fn(),
    });

    emitIdentityHandleChanged({ ownerId: "user-bob", handle: "@Bob" });

    expect(values.has("pubmax_round_anonymous_identity_v1")).toBe(false);
  });

  it("preserves an unrelated anonymous Round identity after a claim", () => {
    const stored = JSON.stringify({ owner: "anonymous", handle: "alice" });
    const values = new Map<string, string>([
      ["pubmax_round_anonymous_identity_v1", stored],
    ]);
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    vi.stubGlobal("window", {
      localStorage,
      dispatchEvent: vi.fn(),
    });

    emitIdentityHandleChanged({ ownerId: "user-bob", handle: "bob" });

    expect(values.get("pubmax_round_anonymous_identity_v1")).toBe(stored);
  });

  it("resolves canonical identity with captured auth and clears its anonymous marker", async () => {
    const values = new Map<string, string>([
      [
        "pubmax_round_anonymous_identity_v1",
        JSON.stringify({ owner: "anonymous", handle: "bob" }),
      ],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const request = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer token-a",
        );
        return Response.json({ handle: "Bob" });
      },
    );

    const result = await resolveCanonicalIdentity(
      "user-a",
      { access_token: "token-a", user: { id: "user-a" } } as never,
      storage,
      request,
    );

    expect(result).toEqual({
      ok: true,
      identity: { ownerId: "user-a", handle: "bob" },
    });
    expect(values.has("pubmax_round_anonymous_identity_v1")).toBe(false);
  });
});
