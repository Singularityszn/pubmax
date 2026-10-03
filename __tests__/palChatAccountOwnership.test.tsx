// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));
const effects = vi.hoisted(() => ({ answer: vi.fn() }));
vi.mock("@/lib/consentAnswerMoment", () => ({ markConsentAnswerMoment: effects.answer }));
vi.mock("@/lib/authedFetch", async (original) => ({
  ...(await original<typeof import("@/lib/authedFetch")>()), authedActionFetch: transport.fetch,
}));
vi.mock("@/components/auth/AuthProvider", async () => ({
  useAuth: (await import("@/components/auth/authContext")).useAuth,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) =>
  createElement("a", { href }, children) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/ui/screen", () => ({ default: ({ children }: { children: ReactNode }) =>
  createElement("section", null, children) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/venuesSlim", () => ({ loadSlimVenuesForCity: async () => [],
  loadSlimVenuesForCityResult: async () => ({ status: "ready", rows: [] }) }));
vi.mock("@/components/map/useWhatsOnTonight", () => ({ useWhatsOnTonight: () => ({ status: "empty", rows: [] }) }));

import PalChat from "@/components/pal/PalChat";
import { AuthContext, type AuthContextValue } from "@/components/auth/authContext";
import { captureAccountAuth } from "@/lib/accountBoundFetch";
import { NO_SOCIAL_AUTH_PROVIDERS } from "@/lib/authProviderAvailability";
import { readProviderIdentityRevision, setProviderAuthState, setProviderIdentity } from "@/lib/authProviderRevision";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A_ASK = "Synthetic A-only quiet outing near Bank";
const A_REPLY = "Synthetic A-only reply.";
let host: HTMLDivElement;
let root: Root;
let current: Session | null;
let bodies: Record<string, unknown>[];

function session(owner: string, token = "synthetic-token"): Session {
  return { access_token: token, refresh_token: "synthetic-refresh", expires_in: 3600,
    token_type: "bearer", user: { id: owner, aud: "authenticated", app_metadata: {},
      user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };
}
function authValue(): AuthContextValue {
  return { session: current, user: current?.user ?? null, loading: false, configured: true,
    clerkIntegrationConfigured: false, socialProviders: NO_SOCIAL_AUTH_PROVIDERS,
    signInWithGoogle: async () => ({ error: null }), signInWithApple: async () => ({ error: null }),
    signInWithMicrosoft: async () => ({ error: null }),
    signInWithEmail: async () => ({ status: "sent", message: "Synthetic sent." }),
    cancelAuthAttempt: () => {}, signOut: async () => {}, switchAccount: async () => ({ status: "unavailable" }),
    welcomeBack: null, resumeSignIn: async () => ({ status: "sent", message: "Synthetic sent." }),
    handle: null, identityResolved: true, accountRevision: readProviderIdentityRevision(),
    providerAuthState: current ? "authenticated" : "signed-out",
    supabaseAuthState: current ? "authenticated" : "signed-out", rejectedContributionAuth: null,
    contributionAuth: captureAccountAuth(current?.user.id ?? null, current),
    invalidateContributionAuth: () => {}, getCurrentUserId: () => current?.user.id ?? null };
}
async function render() {
  await act(async () => root.render(createElement(AuthContext.Provider,
    { value: authValue() }, createElement(PalChat))));
}
async function type(text: string) {
  const input = host.querySelector<HTMLInputElement>(".palChatInput");
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function ask(text: string) {
  await type(text);
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Ask"]');
  expect(button?.disabled).toBe(false);
  await act(async () => button!.click());
}
async function switchOwner(owner: string | null) {
  current = owner ? session(owner) : null; setProviderIdentity("supabase", owner); await render();
}
function answer(message: string, id = "conv_OwnerA1234") {
  return Response.json({ answer: message, cards: [], proposals: [], conversationId: id });
}
beforeEach(async () => {
  effects.answer.mockClear(); current = session(A); bodies = []; setProviderIdentity("supabase", A);
  setProviderIdentity("clerk", null); setProviderAuthState("supabase", "authenticated");
  transport.fetch.mockReset().mockImplementation(async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body))); return answer(current?.user.id === A ? A_REPLY : "Synthetic B-only reply.");
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setProviderIdentity("supabase", null); setProviderIdentity("clerk", null); vi.restoreAllMocks(); });

describe("Pal chat conversation belongs to the mounted account", () => {
  it.each([B, null])("retires A transcript and unsent text when owner becomes %s", async (owner) => {
    await ask(A_ASK); expect(bodies).toHaveLength(1); expect(host.textContent).toContain(A_REPLY);
    await type("Synthetic A-only unsent text"); await switchOwner(owner);
    expect(host.textContent).not.toContain(A_ASK); expect(host.textContent).not.toContain(A_REPLY);
    expect(host.querySelector<HTMLInputElement>(".palChatInput")?.value).toBe("");
  });
  it("does not send A turns or conversation id in B's next real client request", async () => {
    await ask(A_ASK); expect(host.textContent).toContain(A_REPLY); await switchOwner(B);
    await ask("Synthetic B-only outing in Soho"); expect(bodies).toHaveLength(2);
    expect(bodies[1].turns).toEqual([]); expect(bodies[1]).not.toHaveProperty("threadId");
    expect(JSON.stringify(bodies[1])).not.toContain(A_ASK); expect(JSON.stringify(bodies[1])).not.toContain(A_REPLY);
  });
  it("does not display A's delayed response in B's mounted conversation", async () => {
    let finish!: (response: Response) => void;
    transport.fetch.mockImplementationOnce((_input, init) => {
      bodies.push(JSON.parse(String(init?.body))); return new Promise((resolve) => { finish = resolve; });
    });
    await ask(A_ASK); expect(bodies).toHaveLength(1); await switchOwner(B);
    await ask("Synthetic B-only follow-up"); expect(bodies).toHaveLength(2); expect(bodies[1].turns).toEqual([]);
    expect(host.textContent).toContain("Synthetic B-only reply."); expect(effects.answer).toHaveBeenCalledTimes(1);
    await act(async () => finish(answer(A_REPLY)));
    expect(host.textContent).not.toContain(A_ASK); expect(host.textContent).not.toContain(A_REPLY);
    expect(host.textContent).toContain("Synthetic B-only reply."); expect(effects.answer).toHaveBeenCalledTimes(1);
  });
  it("keeps own transcript, draft and real session continuity during same-owner token refresh", async () => {
    await ask(A_ASK); await type("Synthetic own draft"); current = session(A, "synthetic-refreshed-token"); await render();
    expect(host.textContent).toContain(A_REPLY); expect(host.querySelector<HTMLInputElement>(".palChatInput")?.value).toBe("Synthetic own draft");
    await ask("Synthetic own follow-up"); expect(bodies).toHaveLength(2);
    expect(bodies[1].turns).toEqual([{ role: "user", content: A_ASK }, { role: "assistant", content: A_REPLY }]);
    expect(bodies[1].threadId).toBe("conv_OwnerA1234");
  });
  it("retires the conversation at a provider account boundary even when Supabase user stays A", async () => {
    await ask(A_ASK); setProviderIdentity("clerk", "synthetic-clerk-owner-b"); await render(); expect(host.textContent).not.toContain(A_REPLY);
    await ask("Synthetic next-provider outing"); expect(bodies[1].turns).toEqual([]);
    expect(bodies[1]).not.toHaveProperty("threadId");
  });
  it("keeps the same account conversation through a provider readiness change", async () => {
    await ask(A_ASK); await type("Synthetic own readiness draft");
    setProviderAuthState("supabase", "unavailable"); await render();
    expect(host.textContent).toContain(A_REPLY);
    expect(host.querySelector<HTMLInputElement>(".palChatInput")?.value).toBe("Synthetic own readiness draft");
  });
});


describe("Pal chat same-batch account retirement", () => {
  it("does not count A's answer when identity changes before the mounted boundary settles", async () => {
    let finish!: (response: Response) => void;
    transport.fetch.mockImplementationOnce((_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Promise((resolve) => { finish = resolve; });
    });
    await ask(A_ASK);
    expect(bodies).toHaveLength(1);
    expect(effects.answer).not.toHaveBeenCalled();
    await act(async () => {
      current = session(B);
      setProviderIdentity("supabase", B);
      finish(answer(A_REPLY));
      root.render(createElement(AuthContext.Provider,
        { value: authValue() }, createElement(PalChat)));
    });
    expect(effects.answer).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain(A_ASK);
    expect(host.textContent).not.toContain(A_REPLY);
    expect(host.querySelector<HTMLInputElement>(".palChatInput")?.value).toBe("");
    await ask("Synthetic B-only same-batch follow-up");
    expect(bodies).toHaveLength(2);
    expect(bodies[1].turns).toEqual([]);
    expect(bodies[1]).not.toHaveProperty("threadId");
    expect(host.textContent).toContain("Synthetic B-only reply.");
    expect(effects.answer).toHaveBeenCalledTimes(1);
  });
});
