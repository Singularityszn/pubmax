// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The auth callback and the remembered-account switch, run for real against
// the document's cookies. The Supabase client is an explicit double that
// records the generation it is called under and accepts or refuses the session.

const supabase = vi.hoisted(() => ({
  refuse: false as boolean | "throw",
  generationsAtInstall: [] as Array<string | null>,
}));
vi.mock("@/lib/authClient", () => ({
  ensureSupabaseBrowser: async () => ({
    auth: {
      setSession: async () => {
        supabase.generationsAtInstall.push(currentGeneration());
        if (supabase.refuse === "throw") throw new TypeError("Failed to fetch");
        return supabase.refuse
          ? { data: { session: null }, error: new Error("synthetic invalid session") }
          : { data: { session: {} }, error: null };
      },
    },
  }),
}));

import { establishAuthCallbackSession } from "@/lib/authCallbackClient";
import { readResumeGeneration } from "@/lib/authSessionResumeClient";
import { browserDeviceAccountSwitchDeps } from "@/lib/deviceAccountSwitch";

function currentGeneration(): string | null {
  return /(?:^|; )pubmax_resume_gen=([^;]*)/.exec(document.cookie)?.[1] ?? null;
}

function token(sub: string): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.${part("signature")}`;
}

const callbackClient = {
  setSession: async () => {
    supabase.generationsAtInstall.push(currentGeneration());
    if (supabase.refuse === "throw") throw new TypeError("Failed to fetch");
    return supabase.refuse
      ? { data: { session: null }, error: { status: 403, message: "synthetic expired link" } }
      : { data: { session: { user: { id: "account-b" } } }, error: null };
  },
};

beforeEach(() => {
  supabase.refuse = false;
  supabase.generationsAtInstall = [];
  document.cookie = "pubmax_resume_gen=g0; Path=/";
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a sign-in action owns the generation it installs under", () => {
  it.each([true, "throw"] as const)("leaves the remembered generation alone when a callback link fails (%s)", async (refuse) => {
    supabase.refuse = refuse;
    const result = await establishAuthCallbackSession(callbackClient, { accessToken: token("account-b"), refreshToken: "rt-b" });
    expect(result.failed).toBe(true);
    expect(readResumeGeneration()).toBe("g0");
  });

  it("installs a callback session under the generation of the account it signs in", async () => {
    await establishAuthCallbackSession(callbackClient, { accessToken: token("account-b"), refreshToken: "rt-b" });
    expect(supabase.generationsAtInstall).toHaveLength(1);
    expect(supabase.generationsAtInstall[0]).toMatch(/~account-b$/);
    expect(readResumeGeneration()).toBe(supabase.generationsAtInstall[0]);
  });

  it.each([true, "throw"] as const)("leaves the remembered generation alone when a remembered-account switch fails (%s)", async (refuse) => {
    supabase.refuse = refuse;
    const result = await browserDeviceAccountSwitchDeps().setSession({ access_token: token("account-b"), refresh_token: "rt-b" });
    expect(result.ok).toBe(false);
    expect(readResumeGeneration()).toBe("g0");
  });

  it("installs a switched-to session under that account's generation", async () => {
    const result = await browserDeviceAccountSwitchDeps().setSession({ access_token: token("account-b"), refresh_token: "rt-b" });
    expect(result.ok).toBe(true);
    expect(supabase.generationsAtInstall[0]).toMatch(/~account-b$/);
  });

  it("does not install a switch that another sign-in overtook while its token was minted", async () => {
    const deps = browserDeviceAccountSwitchDeps();
    document.cookie = "pubmax_resume_gen=g9~account-c; Path=/";
    const result = await deps.setSession({ access_token: token("account-b"), refresh_token: "rt-b" });
    expect(result.ok).toBe(false);
    expect(supabase.generationsAtInstall).toEqual([]);
    expect(readResumeGeneration()).toBe("g9~account-c");
  });

  it("does not roll back a newer sign-in when its own install fails", async () => {
    supabase.refuse = true;
    const original = callbackClient.setSession;
    callbackClient.setSession = async () => {
      document.cookie = "pubmax_resume_gen=g9~account-c; Path=/";
      return original();
    };
    try {
      await establishAuthCallbackSession(callbackClient, { accessToken: token("account-b"), refreshToken: "rt-b" });
    } finally {
      callbackClient.setSession = original;
    }
    expect(readResumeGeneration()).toBe("g9~account-c");
  });
});
