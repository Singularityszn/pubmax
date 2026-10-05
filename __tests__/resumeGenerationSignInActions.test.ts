// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The auth callback and the remembered-account switch, run for real against
// the document's cookies. The Supabase client is an explicit double that
// accepts or refuses the session; /api/auth/session answers 200 here.

const supabase = vi.hoisted(() => ({ refuse: false }));
vi.mock("@/lib/authClient", () => ({
  ensureSupabaseBrowser: async () => ({
    auth: {
      setSession: async () => supabase.refuse
        ? { data: { session: null }, error: new Error("synthetic invalid session") }
        : { data: { session: {} }, error: null },
    },
  }),
}));

import { establishAuthCallbackSession } from "@/lib/authCallbackClient";
import { readResumeGeneration } from "@/lib/authSessionResumeClient";
import { browserDeviceAccountSwitchDeps } from "@/lib/deviceAccountSwitch";

function token(sub: string): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.${part("signature")}`;
}

const callbackClient = {
  setSession: async () => supabase.refuse
    ? { data: { session: null }, error: { status: 403, message: "synthetic expired link" } }
    : { data: { session: { user: { id: "account-b" } } }, error: null },
};

beforeEach(() => {
  supabase.refuse = false;
  document.cookie = "pubmax_resume_gen=g0; Path=/";
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sign-in actions start a generation only once they succeed", () => {
  it("leaves the remembered generation alone when a callback link is refused", async () => {
    supabase.refuse = true;
    const result = await establishAuthCallbackSession(callbackClient, { accessToken: token("account-b"), refreshToken: "rt-b" });
    expect(result.failed).toBe(true);
    expect(readResumeGeneration()).toBe("g0");
  });

  it("starts a generation for the account a callback signed in", async () => {
    await establishAuthCallbackSession(callbackClient, { accessToken: token("account-b"), refreshToken: "rt-b" });
    expect(readResumeGeneration()).toMatch(/~account-b$/);
  });

  it("leaves the remembered generation alone when a remembered-account switch is refused", async () => {
    supabase.refuse = true;
    const result = await browserDeviceAccountSwitchDeps().setSession({ access_token: token("account-b"), refresh_token: "rt-b" });
    expect(result.ok).toBe(false);
    expect(readResumeGeneration()).toBe("g0");
  });

  it("starts a generation for the account a switch signed in", async () => {
    const result = await browserDeviceAccountSwitchDeps().setSession({ access_token: token("account-b"), refresh_token: "rt-b" });
    expect(result.ok).toBe(true);
    expect(readResumeGeneration()).toMatch(/~account-b$/);
  });
});
