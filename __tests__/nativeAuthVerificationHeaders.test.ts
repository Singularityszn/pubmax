// @vitest-environment jsdom
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ form: "object" as "object" | "headers" | "tuples" }));

// The real SDK consumes the browser client's fetch option. This adapter supplies
// each supported HeadersInit representation at that executable transport boundary.
vi.mock("@supabase/supabase-js", async (original) => {
  const sdk = await original<typeof import("@supabase/supabase-js")>();
  return { ...sdk, createClient: (...args: Parameters<typeof sdk.createClient>) => {
    const [url, key, options] = args;
    const request = options?.global?.fetch;
    return sdk.createClient(url, key, { ...options, global: { ...options?.global,
      ...(request ? { fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const entries = [...new Headers(init?.headers)].map(([name, value]): [string, string] =>
          [name === "authorization" ? "aUtHoRiZaTiOn" : name, value]);
        const headers: HeadersInit = transport.form === "object" ? Object.fromEntries(entries)
          : transport.form === "headers" ? new Headers(entries) : entries;
        return request(input, { ...init, headers });
      } } : {}),
    } });
  } };
});

function session(id: string): Session {
  const access = `e30.${Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.unsigned`;
  return { access_token: access, refresh_token: `${id}-refresh`, user: { id } } as Session;
}

let client: SupabaseClient | null = null;
afterEach(async () => {
  await client?.auth.stopAutoRefresh();
  client = null;
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each(["object", "headers", "tuples"] as const)("canonical native verification with %s headers", (form) => {
  it.each([false, true])("preserves unrelated requests and B after cancelled A verification rejects=%s", async (reject) => {
    vi.resetModules();
    transport.form = form;
    localStorage.clear();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://header-test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_offline_fixture");
    const a = session("account-a");
    const b = session("account-b");
    let release!: () => void;
    let verifying = false;
    let current = true;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    const unrelated = Response.json({ marker: "unrelated" }, { status: 401 });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const bearer = new Headers(init?.headers).get("authorization");
      if (path === "/functions/v1/probe") return unrelated;
      expect(path).toBe("/auth/v1/user");
      if (bearer === "Bearer unrelated-token") return Response.json({ message: "Unrelated verification", code: "unrelated" }, { status: 401 });
      if (bearer === `Bearer ${b.access_token}`) return Response.json(b.user);
      expect(bearer).toBe(`Bearer ${a.access_token}`);
      verifying = true;
      await delayed;
      return reject ? Response.json({ code: "session_not_found", message: "Session does not exist" }, {
        status: 400, headers: { "x-supabase-api-version": "2024-01-01" },
      }) : Response.json(a.user);
    });
    const auth = await import("@/lib/authClient");
    client = await auth.ensureSupabaseBrowser();
    expect(client).not.toBeNull();
    const signedIn: string[] = [];
    const subscription = client!.auth.onAuthStateChange((event, value) => {
      if (event === "SIGNED_IN" && value) signedIn.push(value.user.id);
    });
    const installation = auth.installNativeSession(client!.auth, a, () => current);
    await vi.waitFor(() => expect(verifying).toBe(true));
    const otherUser = await client!.auth.getUser("unrelated-token");
    expect(otherUser.error?.message).toBe("Unrelated verification");
    const probe = await client!.functions.invoke("probe", { headers: { authorization: `Bearer ${a.access_token}` } });
    expect(probe.error.context).toBe(unrelated);
    await client!.auth.setSession({ access_token: b.access_token, refresh_token: b.refresh_token });
    current = false;
    auth.discardCancelledNativeSessionInstallation();
    release();
    expect(await installation).toBeNull();
    expect((await client!.auth.getSession()).data.session?.user.id).toBe("account-b");
    expect(JSON.parse(localStorage.getItem("sb-header-test-auth-token")!).user.id).toBe("account-b");
    expect(signedIn).toEqual(["account-b"]);
    subscription.data.subscription.unsubscribe();
  });
});
