import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bindDeviceAccountOwner,
  deviceAccountOwner,
  DEVICE_IDENTITY_CHANGED_EVENT,
  releaseDeviceAccountOwner,
} from "@/lib/deviceAccountIdentity";
import {
  emitIdentityHandleChanged,
  handleClaimRouteAfterSignIn,
  identityHandleForOwner,
  resolveCanonicalIdentity,
  syncDeviceHandle,
} from "@/lib/identityClient";

describe("device handle sync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("announces a changed handle and stays quiet when the same handle lands again", () => {
    // Another tab signing in to the same account re-runs the canonical read. A
    // notice for the handle already here made /social re-ask for access and
    // close the composer that was open.
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    syncDeviceHandle(storage, "@Alice");
    expect(values.get("pubmax_handle")).toBe("alice");
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({ type: DEVICE_IDENTITY_CHANGED_EVENT });

    syncDeviceHandle(storage, "alice");
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    syncDeviceHandle(storage, "bob");
    expect(values.get("pubmax_handle")).toBe("bob");
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
  });
});

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
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
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
    expect(values.get("pubmax_handle")).toBe("bob");
  });
});

describe("post-callback handle claim routing", () => {
  const SESSION = {
    access_token: "token-a",
    user: { id: "user-a" },
  } as never;

  function storageWith(values: Map<string, string>) {
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
  }

  function requestAnswering(handle: string | null) {
    return vi.fn(async () => Response.json({ handle }));
  }

  it("routes a session with no claimed handle to /u/you", async () => {
    await expect(
      handleClaimRouteAfterSignIn(
        SESSION,
        "/map?area=soho",
        storageWith(new Map()),
        requestAnswering(null),
      ),
    ).resolves.toBe("/u/you");
  });

  it("stays put when the account already has a handle", async () => {
    const storage = storageWith(new Map());
    await expect(
      handleClaimRouteAfterSignIn(
        SESSION,
        "/map",
        storage,
        requestAnswering("alice"),
      ),
    ).resolves.toBeNull();
    expect(storage.getItem("pubmax_handle")).toBe("alice");
  });

  it("stays put on a device handle THIS account owns, without asking the server", async () => {
    const request = requestAnswering(null);
    await expect(
      handleClaimRouteAfterSignIn(
        SESSION,
        "/map",
        storageWith(
          new Map([
            ["pubmax_handle", "alice"],
            ["pubmax_account_owner", "user-a"],
          ]),
        ),
        request,
      ),
    ).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("asks the server when the device handle belongs to another account", async () => {
    // The founder's browser: @karan is still cached from the account that just
    // signed out. Taking it as proof skipped BOTH the canonical read and the
    // claim step, so the new account browsed under the old one's name.
    const request = requestAnswering(null);
    await expect(
      handleClaimRouteAfterSignIn(
        SESSION,
        "/map",
        storageWith(
          new Map([
            ["pubmax_handle", "karan"],
            ["pubmax_account_owner", "user-previous"],
          ]),
        ),
        request,
      ),
    ).resolves.toBe("/u/you");
    expect(request).toHaveBeenCalled();
  });

  it("asks the server when nobody stamped the device handle", async () => {
    const request = requestAnswering(null);
    await expect(
      handleClaimRouteAfterSignIn(
        SESSION,
        "/map",
        storageWith(new Map([["pubmax_handle", "karan"]])),
        request,
      ),
    ).resolves.toBe("/u/you");
    expect(request).toHaveBeenCalled();
  });

  it("never bounces a restored return fragment or the claim surface itself", async () => {
    const request = requestAnswering(null);
    await expect(
      handleClaimRouteAfterSignIn(
        SESSION,
        "/plan/abc#invite=SECRET-A",
        storageWith(new Map()),
        request,
      ),
    ).resolves.toBeNull();
    await expect(
      handleClaimRouteAfterSignIn(SESSION, "/u/you", storageWith(new Map()), request),
    ).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("treats a failed or unreadable server answer as no evidence", async () => {
    const failing = vi.fn(async () => new Response("nope", { status: 500 }));
    const offline = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      handleClaimRouteAfterSignIn(SESSION, "/map", storageWith(new Map()), failing),
    ).resolves.toBeNull();
    await expect(
      handleClaimRouteAfterSignIn(SESSION, "/map", storageWith(new Map()), offline),
    ).resolves.toBeNull();
    await expect(
      handleClaimRouteAfterSignIn(null, "/map", storageWith(new Map()), failing),
    ).resolves.toBeNull();
  });
});

describe("canonical identity account boundaries", () => {
  afterEach(() => vi.unstubAllGlobals());

  function deviceStorage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => { resolve = accept; });
    return { promise, resolve };
  }

  function heldCanonicalReply(phase: "response" | "body") {
    const response = deferred<Response>();
    const body = deferred<{ handle: string }>();
    const bodyEntered = deferred<void>();
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token-a");
      if (phase === "response") return response.promise;
      return {
        ok: true,
        json: () => { bodyEntered.resolve(); return body.promise; },
      } as Response;
    });
    return {
      request,
      entered: phase === "body" ? bodyEntered.promise : Promise.resolve(),
      release: () => {
        if (phase === "response") response.resolve(Response.json({ handle: "alice" }));
        else body.resolve({ handle: "alice" });
      },
    };
  }

  it.each(["response", "body"] as const)("keeps B's canonical handle when A's held %s arrives after rebinding", async (phase) => {
    const storage = deviceStorage();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    bindDeviceAccountOwner("user-a", storage);
    const held = heldCanonicalReply(phase);
    const pendingA = resolveCanonicalIdentity(
      "user-a", { access_token: "token-a", user: { id: "user-a" } } as never,
      storage, held.request,
    );
    await held.entered;

    bindDeviceAccountOwner("user-b", storage);
    const answerB = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token-b");
      return Response.json({ handle: "bob" });
    });
    await expect(resolveCanonicalIdentity(
      "user-b", { access_token: "token-b", user: { id: "user-b" } } as never,
      storage, answerB,
    )).resolves.toEqual({ ok: true, identity: { ownerId: "user-b", handle: "bob" } });
    expect(storage.getItem("pubmax_handle")).toBe("bob");
    const roundMarker = JSON.stringify({ owner: "anonymous", handle: "alice" });
    storage.setItem("pubmax_round_anonymous_identity_v1", roundMarker);
    const noticesBeforeA = dispatchEvent.mock.calls.length;

    held.release();
    await pendingA;

    expect(deviceAccountOwner(storage)).toBe("user-b");
    expect(storage.getItem("pubmax_handle")).toBe("bob");
    expect(storage.getItem("pubmax_round_anonymous_identity_v1")).toBe(roundMarker);
    expect(dispatchEvent).toHaveBeenCalledTimes(noticesBeforeA);
  });

  it.each(["response", "body"] as const)("keeps a released device anonymous when A's held %s arrives after sign-out", async (phase) => {
    const storage = deviceStorage();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    bindDeviceAccountOwner("user-a", storage);
    const held = heldCanonicalReply(phase);
    const pendingA = resolveCanonicalIdentity(
      "user-a", { access_token: "token-a", user: { id: "user-a" } } as never,
      storage, held.request,
    );
    await held.entered;

    releaseDeviceAccountOwner(storage);
    const roundMarker = JSON.stringify({ owner: "anonymous", handle: "alice" });
    storage.setItem("pubmax_round_anonymous_identity_v1", roundMarker);
    const noticesBeforeA = dispatchEvent.mock.calls.length;
    held.release();
    await pendingA;

    expect(deviceAccountOwner(storage)).toBeNull();
    expect(storage.getItem("pubmax_handle")).toBeNull();
    expect(storage.getItem("pubmax_round_anonymous_identity_v1")).toBe(roundMarker);
    expect(dispatchEvent).toHaveBeenCalledTimes(noticesBeforeA);
  });
});


describe("canonical lifecycle sibling controls", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not route an obsolete callback to claim a handle after its reply arrives", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    bindDeviceAccountOwner("user-a", storage);
    let active = true;
    let release!: (response: Response) => void;
    const heldReply = new Promise<Response>((resolve) => { release = resolve; });
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token-a");
      return heldReply;
    });
    const pendingRoute = handleClaimRouteAfterSignIn(
      { access_token: "token-a", user: { id: "user-a" } } as never,
      "/map", storage, request, () => active,
    );
    expect(request).toHaveBeenCalledTimes(1);
    active = false;
    release(Response.json({ handle: null }));
    await expect(pendingRoute).resolves.toBeNull();
    expect(storage.getItem("pubmax_handle")).toBeNull();
  });

  it.each(["absent", "blocked"] as const)("still resolves the current server identity with %s device storage", async (mode) => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    const storage = mode === "absent" ? null : {
      getItem: () => { throw new Error("Storage blocked"); },
      setItem: () => { throw new Error("Storage blocked"); },
      removeItem: () => { throw new Error("Storage blocked"); },
    };
    await expect(resolveCanonicalIdentity(
      "user-a", { access_token: "token-a", user: { id: "user-a" } } as never,
      storage, vi.fn(async () => Response.json({ handle: "alice" })),
    )).resolves.toEqual({ ok: true, identity: { ownerId: "user-a", handle: "alice" } });
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
