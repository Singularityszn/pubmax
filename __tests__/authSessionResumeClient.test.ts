// The browser half of the durable resume cookie.
//
// THE REPORT: "still not staying signed in". A persist that the server refuses
// leaves the device with NO durable session, and this call used to swallow the
// answer - so a browser could look signed in for a whole visit and come back
// cold, with nothing anywhere saying the cookie was never written. The outcome
// is returned now, and the one refusal a client can actually repair (a bearer
// token that has already expired) is repairable because the caller can see it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createResumePersistence } from "@/lib/authResumePersistence";

import {
  fetchResumeHint,
  persistSessionForResume,
  redeemPersistedSession,
} from "@/lib/authSessionResumeClient";

const SESSION = { access_token: "at_1", refresh_token: "rt_1" };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reading the resume hint", () => {
  it("distinguishes a present hint from an absent cookie", async () => {
    const present = vi.fn(
      async () =>
        new Response(JSON.stringify({ hint: { maskedEmail: "p***@example.com" } }), {
          status: 200,
        }),
    );
    const absent = vi.fn(
      async () => new Response(JSON.stringify({ hint: null }), { status: 200 }),
    );

    await expect(fetchResumeHint(present)).resolves.toEqual({
      status: "present",
      hint: { maskedEmail: "p***@example.com" },
    });
    await expect(fetchResumeHint(absent)).resolves.toEqual({ status: "absent" });
  });

  it("keeps server and transport failures unavailable", async () => {
    const serverFailure = vi.fn(async () => new Response("", { status: 503 }));
    const transportFailure = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(fetchResumeHint(serverFailure)).resolves.toEqual({
      status: "unavailable",
    });
    await expect(fetchResumeHint(transportFailure)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("rejects a present hint without its masked address field", async () => {
    const malformed = vi.fn(
      async () => new Response(JSON.stringify({ hint: {} }), { status: 200 }),
    );

    await expect(fetchResumeHint(malformed)).resolves.toEqual({
      status: "unavailable",
    });
  });
});

describe("persisting the resume cookie", () => {
  it.each([200, 429])("recovers an expired pending bearer after an outage with persist status %s", async (recoveredStatus) => {
    vi.useFakeTimers();
    const persistence = createResumePersistence();
    const expiresAt = Date.now() + 60_000;
    let online = false;
    let writeStatus = recoveredStatus;
    let cookieToken = "rt_0";
    const writes: string[] = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!online) throw new TypeError("offline");
      const token = new Headers(init?.headers).get("authorization");
      if (token === "Bearer at_1" && Date.now() >= expiresAt) return Response.json({}, { status: 401 });
      const body = JSON.parse(String(init?.body));
      writes.push(body.refreshToken);
      if (writeStatus === 200) cookieToken = body.refreshToken;
      return Response.json({}, { status: writeStatus });
    });
    const session = { ...SESSION, user: { id: "reader" } };
    const initialPersist = persistence.persist(session, null);
    await vi.runAllTimersAsync();
    await expect(initialPersist).resolves.toBe(false);

    vi.setSystemTime(expiresAt + 1);
    online = true;
    const exchange = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { refresh_token } = JSON.parse(String(init?.body));
      return Response.json({
        access_token: refresh_token === "rt_1" ? "at_2" : "at_3",
        refresh_token: refresh_token === "rt_1" ? "rt_2" : "rt_3",
        user: { id: "reader" },
      });
    });
    const browserFetch = persistence.wrapFetch(exchange, null);
    const refresh = (token: string) => browserFetch("https://auth.test/auth/v1/token?grant_type=refresh_token", {
      method: "POST", body: JSON.stringify({ refresh_token: token }),
    });
    const recovered = refresh("rt_1");
    const concurrent = await refresh("rt_1");
    expect(concurrent.status).toBe(503);
    await vi.runAllTimersAsync();
    expect(await (await recovered).json()).toMatchObject({ refresh_token: "rt_2" });
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((token) => token === "rt_2")).toBe(true);
    expect(cookieToken).toBe(recoveredStatus === 200 ? "rt_2" : "rt_0");

    if (recoveredStatus === 429) {
      const blocked = refresh("rt_2");
      await vi.runAllTimersAsync();
      expect((await blocked).status).toBe(503);
      expect(exchange).toHaveBeenCalledTimes(1);
    }
    writeStatus = 200;
    const next = refresh("rt_2");
    await vi.runAllTimersAsync();
    const nextSession = await (await next).json();
    expect(nextSession.refresh_token).toBe("rt_3");
    await expect(persistence.persist(nextSession, null)).resolves.toBe(true);
    expect(cookieToken).toBe("rt_3");
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it.each([401, 429, 503, "offline"] as const)("retries %s with the newest session", async (failure) => {
    vi.useFakeTimers();
    const persistence = createResumePersistence();
    let finishFirst!: () => void;
    const firstResponse = new Promise<void>((resolve) => { finishFirst = resolve; });
    const storedTokens: string[] = [];
    let calls = 0;
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        await firstResponse;
        if (failure === "offline") throw new TypeError("offline");
        return Response.json({}, { status: failure });
      }
      storedTokens.push((JSON.parse(String(init?.body)) as { refreshToken: string }).refreshToken);
      return Response.json({ status: "stored" });
    });
    const first = persistence.persist({ ...SESSION, user: { id: "reader" } }, null);
    const newest = persistence.persist({ access_token: "at_2", refresh_token: "rt_2", user: { id: "reader" } }, null);
    finishFirst();
    await vi.runAllTimersAsync();
    await expect(first).resolves.toBe(true);
    await expect(newest).resolves.toBe(true);
    expect(storedTokens).toEqual(["rt_2"]);
  });

  it("finishes an outstanding cookie write before sign-out can delete it", async () => {
    const persistence = createResumePersistence();
    let finishWrite!: () => void;
    const written = new Promise<void>((resolve) => { finishWrite = resolve; });
    const operations: string[] = [];
    vi.stubGlobal("fetch", async () => {
      await written;
      operations.push("persist");
      return Response.json({ status: "stored" });
    });
    const persisted = persistence.persist({ ...SESSION, user: { id: "reader" } }, null);
    const cleared = persistence.clear().then(() => { operations.push("delete"); });
    expect(operations).toEqual([]);
    finishWrite();
    await Promise.all([persisted, cleared]);
    expect(operations).toEqual(["persist", "delete"]);
  });

  it("reports a stored cookie", async () => {
    const request = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(persistSessionForResume(SESSION, request)).resolves.toBe(
      "stored",
    );
    const init = (request.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer at_1");
    expect(JSON.parse(String(init.body))).toEqual({
      action: "persist",
      refreshToken: "rt_1",
    });
  });

  it("names a refused bearer token rather than passing for success", async () => {
    const request = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(persistSessionForResume(SESSION, request)).resolves.toBe(
      "unauthenticated",
    );
  });

  it("treats every other failure as a transient one", async () => {
    const failing = vi.fn(async () => new Response("{}", { status: 503 }));
    await expect(persistSessionForResume(SESSION, failing)).resolves.toBe(
      "unavailable",
    );
    const offline = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(persistSessionForResume(SESSION, offline)).resolves.toBe(
      "unavailable",
    );
  });
});

describe("redeeming the resume cookie", () => {
  it("restores a session the server handed back", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "restored",
            session: { access_token: "at_2", refresh_token: "rt_2" },
          }),
          { status: 200 },
        ),
    );
    await expect(redeemPersistedSession(request)).resolves.toEqual({
      status: "restored",
      session: { access_token: "at_2", refresh_token: "rt_2" },
    });
  });

  it("carries the masked address through a dead token", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ status: "expired", maskedEmail: "k…@example.com" }),
          { status: 200 },
        ),
    );
    await expect(redeemPersistedSession(request)).resolves.toEqual({
      status: "expired",
      maskedEmail: "k…@example.com",
    });
  });
});
