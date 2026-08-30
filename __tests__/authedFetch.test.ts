import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authClient", () => ({
  getAccessToken: vi.fn(async () => "test-jwt-token"),
}));

import { getAccessToken } from "@/lib/authClient";
import {
  AuthActionSessionError,
  authedActionFetch,
  authedFetch,
  publishAuthActionState,
} from "@/lib/authedFetch";
import { setProviderIdentity } from "@/lib/authProviderRevision";

beforeEach(() => {
  vi.mocked(getAccessToken).mockReset().mockResolvedValue("test-jwt-token");
  publishAuthActionState({ status: "signed-out", identityResolved: true });
  setProviderIdentity("supabase", null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("authedFetch (Wave I2)", () => {
  it("attaches Authorization Bearer when a token is available", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await authedFetch("/api/messages?handle=ken");
    expect(getAccessToken).toHaveBeenCalled();
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer test-jwt-token");
    fetchSpy.mockRestore();
  });

  it("proceeds anonymously when getAccessToken returns null", async () => {
    vi.mocked(getAccessToken).mockResolvedValueOnce(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await authedFetch("/api/messages?handle=ken", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("content-type")).toBe("application/json");
    fetchSpy.mockRestore();
  });

  it("waits for a token that arrives after the first lookup before sending an action", async () => {
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("late-jwt-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await authedActionFetch("/api/referrals/invite-link", { method: "POST" });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer late-jwt-token");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("does not let an account A action use account B auth after switch unmounts its owner", async () => {
    let resolveToken!: (token: string | null) => void;
    const token = new Promise<string | null>((resolve) => {
      resolveToken = resolve;
    });
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockReturnValueOnce(token);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const owner = new AbortController();

    const request = authedActionFetch("/api/identity/adult-assertion", {
      method: "POST",
      signal: owner.signal,
    });
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();

    setProviderIdentity("supabase", "account-b");
    owner.abort();
    resolveToken("account-b-token");

    await rejection;
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("aborts an account A action already in flight when the account changes", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockResolvedValueOnce("account-a-token");
    let actionSignal: AbortSignal | null = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) => new Promise<Response>((_resolve, reject) => {
        actionSignal = init?.signal ?? null;
        actionSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      }),
    );

    const request = authedActionFetch("/api/social/tags", { method: "POST" });
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer account-a-token");
    setProviderIdentity("supabase", "account-b");

    await rejection;
    expect(actionSignal?.aborted).toBe(true);
  });

  it("rejects an account A body when the account changes after headers arrive", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockResolvedValueOnce("account-a-token");
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            bodyController = controller;
            init?.signal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("The operation was aborted.", "AbortError")),
              { once: true },
            );
          },
        });
        return Promise.resolve(new Response(body, {
          headers: { "content-type": "application/json" },
        }));
      },
    );

    const response = await authedActionFetch("/api/social/posts", { method: "POST" });
    const actionSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(actionSignal?.aborted).toBe(false);

    setProviderIdentity("supabase", "account-b");
    expect(actionSignal?.aborted).toBe(true);
    try {
      bodyController.enqueue(new TextEncoder().encode('{"owner":"account-a"}'));
      bodyController.close();
    } catch {
      // Account change may already have errored the response stream.
    }

    await expect(response.json()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves response metadata and binary body methods", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    const source = new Response(Uint8Array.from([1, 2, 3]), {
      status: 206,
      statusText: "Partial Content",
      headers: { "content-type": "application/octet-stream", "x-test": "kept" },
    });
    Object.defineProperties(source, {
      redirected: { value: true },
      type: { value: "cors" },
      url: { value: "https://pubmaxx.example/api/private-photo" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(source);

    const response = await authedActionFetch("/api/private-photo");
    const actionSignal = fetchSpy.mock.calls[0]?.[1]?.signal;

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(206);
    expect(response.statusText).toBe("Partial Content");
    expect(response.headers.get("x-test")).toBe("kept");
    expect(response.url).toBe("https://pubmaxx.example/api/private-photo");
    expect(response.type).toBe("cors");
    expect(response.redirected).toBe(true);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);

    setProviderIdentity("supabase", "account-b");
    expect(actionSignal?.aborted).toBe(false);
  });

  it("preserves form-data reads", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    const form = new FormData();
    form.set("owner", "account-a");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(form));

    const response = await authedActionFetch("/api/social/form");

    expect((await response.formData()).get("owner")).toBe("account-a");
  });

  it("releases the account binding when the response body is cancelled", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>()),
    );

    const response = await authedActionFetch("/api/social/posts");
    const actionSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
    await response.body?.cancel();

    setProviderIdentity("supabase", "account-b");
    expect(actionSignal?.aborted).toBe(false);
  });

  it("waits for identity resolution before reading a signed-in action token", async () => {
    publishAuthActionState({ status: "signed-in", identityResolved: false });
    vi.mocked(getAccessToken)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("resolved-jwt-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    setTimeout(() => {
      publishAuthActionState({ status: "signed-in", identityResolved: true });
    }, 10);

    await authedActionFetch("/api/profiles/ken/avatar", { method: "POST" });

    expect(getAccessToken).toHaveBeenCalledTimes(2);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer resolved-jwt-token");
  });

  it("does not treat an auth-hydrating browser as signed out", async () => {
    publishAuthActionState({ status: "unknown", identityResolved: false });
    vi.mocked(getAccessToken).mockResolvedValue("hydrated-jwt-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    setTimeout(() => {
      setProviderIdentity("supabase", "hydrated-account");
      publishAuthActionState({ status: "signed-in", identityResolved: true });
    }, 10);

    await authedActionFetch("/api/messages", { method: "POST" });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer hydrated-jwt-token");
  });

  it("keeps signed-out action behaviour anonymous", async () => {
    vi.mocked(getAccessToken).mockResolvedValue(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await authedActionFetch("/api/referrals/invite-link", { method: "POST" });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBeNull();
  });

  it("does not send an anonymous request when a signed-in token never arrives", async () => {
    vi.useFakeTimers();
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockResolvedValue(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const request = authedActionFetch("/api/referrals/invite-link", { method: "POST" });
    const rejection = expect(request).rejects.toBeInstanceOf(AuthActionSessionError);
    await vi.advanceTimersByTimeAsync(2_100);

    await rejection;
    await expect(request).rejects.toMatchObject({
      code: "AUTH_SESSION_WAKING",
      message: "Still waking your session - try again.",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("bounds a session read that never resolves", async () => {
    vi.useFakeTimers();
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockImplementation(() => new Promise(() => {}));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const request = authedActionFetch("/api/profiles/ken/avatar", { method: "POST" });
    const rejection = expect(request).rejects.toBeInstanceOf(AuthActionSessionError);
    await vi.advanceTimersByTimeAsync(2_100);

    await rejection;
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
