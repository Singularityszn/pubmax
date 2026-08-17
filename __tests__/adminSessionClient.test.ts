import { describe, expect, it } from "vitest";

import {
  ADMIN_SESSION_NOT_KEPT_MESSAGE,
  ADMIN_SESSION_UNCONFIRMED_MESSAGE,
  ADMIN_SESSION_UNREACHABLE_MESSAGE,
  readAdminSessionState,
  submitAdminToken,
} from "@/lib/adminSessionClient";

type Call = { input: string; init?: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch that answers the POST first and the confirming GET second. */
function scriptedFetch(
  answers: ReadonlyArray<() => Promise<Response>>,
): { fetch: (input: string, init?: RequestInit) => Promise<Response>; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ input, init });
      const answer = answers[index];
      index += 1;
      if (!answer) throw new Error(`unexpected request ${index}: ${input}`);
      return answer();
    },
  };
}

describe("submitAdminToken", () => {
  it("opens the console only after the session read says the cookie landed", async () => {
    const { fetch, calls } = scriptedFetch([
      async () => jsonResponse({ ok: true }),
      async () => jsonResponse({ authenticated: true }),
    ]);

    await expect(submitAdminToken("  secret  ", fetch)).resolves.toEqual({
      status: "open",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBe(JSON.stringify({ token: "secret" }));
    expect(calls[0].init?.credentials).toBe("include");
    expect(calls[1].init?.method).toBe("GET");
    expect(calls[1].init?.credentials).toBe("include");
  });

  // THE REGRESSION: the POST answers 200 while the browser drops a `Secure`
  // cookie over plain HTTP. The old form reloaded on that 200 and met itself
  // again with nothing said.
  it("refuses with the HTTPS line when a 200 POST left no session behind", async () => {
    const { fetch, calls } = scriptedFetch([
      async () => jsonResponse({ ok: true }),
      async () => jsonResponse({ authenticated: false }),
    ]);

    await expect(submitAdminToken("secret", fetch)).resolves.toEqual({
      status: "refused",
      message: ADMIN_SESSION_NOT_KEPT_MESSAGE,
    });
    expect(calls).toHaveLength(2);
  });

  it("separates a confirm it could not run from a cookie that was dropped", async () => {
    const unreadable = scriptedFetch([
      async () => jsonResponse({ ok: true }),
      async () => new Response("nope", { status: 503 }),
    ]);
    await expect(submitAdminToken("secret", unreadable.fetch)).resolves.toEqual({
      status: "refused",
      message: ADMIN_SESSION_UNCONFIRMED_MESSAGE,
    });

    const offline = scriptedFetch([
      async () => jsonResponse({ ok: true }),
      async () => {
        throw new TypeError("network down");
      },
    ]);
    await expect(submitAdminToken("secret", offline.fetch)).resolves.toEqual({
      status: "refused",
      message: ADMIN_SESSION_UNCONFIRMED_MESSAGE,
    });

    const shapeless = scriptedFetch([
      async () => jsonResponse({ ok: true }),
      async () => jsonResponse({}),
    ]);
    await expect(submitAdminToken("secret", shapeless.fetch)).resolves.toEqual({
      status: "refused",
      message: ADMIN_SESSION_UNCONFIRMED_MESSAGE,
    });
  });

  it("keeps the route's own refusal copy and never confirms after it", async () => {
    const { fetch, calls } = scriptedFetch([
      async () => jsonResponse({ error: "Not authorised." }, 403),
    ]);

    await expect(submitAdminToken("wrong", fetch)).resolves.toEqual({
      status: "refused",
      message: "Not authorised.",
    });
    expect(calls).toHaveLength(1);
  });

  // Both admin doors read the session through this one function, so a 200 POST
  // can never be mistaken for a session on either of them.
  it("is the one session read, and it answers three ways", async () => {
    const held = scriptedFetch([async () => jsonResponse({ authenticated: true })]);
    await expect(readAdminSessionState(held.fetch)).resolves.toBe("authenticated");

    const none = scriptedFetch([async () => jsonResponse({ authenticated: false })]);
    await expect(readAdminSessionState(none.fetch)).resolves.toBe("anonymous");

    const failed = scriptedFetch([async () => new Response("", { status: 500 })]);
    await expect(readAdminSessionState(failed.fetch)).resolves.toBe("unknown");

    const offline = scriptedFetch([
      async () => {
        throw new TypeError("network down");
      },
    ]);
    await expect(readAdminSessionState(offline.fetch)).resolves.toBe("unknown");

    const shapeless = scriptedFetch([async () => jsonResponse({})]);
    await expect(readAdminSessionState(shapeless.fetch)).resolves.toBe("unknown");
  });

  it("names an unreachable server rather than a dropped cookie", async () => {
    const { fetch, calls } = scriptedFetch([
      async () => {
        throw new TypeError("network down");
      },
    ]);

    await expect(submitAdminToken("secret", fetch)).resolves.toEqual({
      status: "refused",
      message: ADMIN_SESSION_UNREACHABLE_MESSAGE,
    });
    expect(calls).toHaveLength(1);
  });
});
