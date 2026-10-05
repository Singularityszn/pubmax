// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic Supabase client, durable-cookie DELETE, account switch and
// /api/pint-drops transport. The provider's sign-out sequencing, account
// boundary, Pint Drop hook and browser storage stay real. This is not real
// GoTrue revocation or durable server persistence.
const harness = vi.hoisted(() => ({
  emit: null as null | ((event: string, session: unknown) => void),
  // "removed-then-logout-error" is what the installed SDK does on a network or
  // 5xx logout failure (__tests__/supabaseSignOutLogoutErrorContract.test.ts).
  // "session-kept-refusal" is its session-read failure: nothing is removed.
  outcome: "signed-out" as "signed-out" | "removed-then-logout-error" | "session-kept-refusal",
  duringProviderSignOut: null as null | (() => Promise<void>),
  events: [] as string[],
  atActivate: null as null | { owner: string | null; spills: string | null; drafts: string[]; lane: string[] },
  post: null as null | ((init: RequestInit) => Promise<Response>),
}));

vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/posthog/posthogPerson", () => ({ syncPosthogPersonIdentity: vi.fn() }));
vi.mock("@/lib/authClient", () => ({
  isAuthConfigured: () => true,
  getAccessToken: async () => "synthetic-access",
  ensureSupabaseBrowser: async () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        harness.emit = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signOut: async () => {
        harness.events.push("provider-sign-out");
        if (harness.outcome === "session-kept-refusal") return { error: new Error("synthetic session read failure") };
        harness.emit?.("SIGNED_OUT", null);
        await harness.duringProviderSignOut?.();
        return { error: harness.outcome === "removed-then-logout-error" ? new Error("synthetic logout 503") : null };
      },
    },
  }),
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  loadSocialAuthProviders: async () => ({ google: false, apple: false, microsoft: false }),
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
}));
vi.mock("@/lib/authRedirect", () => ({
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT: "pubmax-auth-return-fragment-restored",
  scrubAuthCallback: async () => null,
  scrubLingeringAuthCallback: vi.fn(() => false),
}));
vi.mock("@/lib/authSessionBootstrap", () => ({
  AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS: 20_000,
  bootstrapAuthSession: async () => ({ status: "none" }),
}));
vi.mock("@/lib/authSessionResumeClient", async () => ({
  ...(await vi.importActual<typeof import("@/lib/authSessionResumeClient")>("@/lib/authSessionResumeClient")),
  clearPersistedSession: async () => {
    harness.events.push("durable-cookie-delete");
  },
}));
vi.mock("@/lib/deviceAccountSwitch", async () => ({
  ...(await vi.importActual<typeof import("@/lib/deviceAccountSwitch")>("@/lib/deviceAccountSwitch")),
  activateDeviceAccount: vi.fn(async (userId: string) => {
    harness.events.push(`activate:${userId}`);
    harness.atActivate = {
      owner: localStorage.getItem("pubmax_account_owner"),
      spills: localStorage.getItem("pubmax:optimistic-spill-posts:v1"),
      drafts: Object.keys(sessionStorage).filter((key) => key.includes("account%3Aaccount-a")),
      lane: readDeviceAccounts(localStorage).map((account) => account.userId),
    };
    return { status: "switched", userId };
  }),
}));
vi.mock("@/lib/identityClient", () => ({
  handleClaimRouteAfterSignIn: async () => null,
  IDENTITY_HANDLE_CHANGED_EVENT: "pubmax:identity-handle-changed",
  identityHandleForOwner: (identity: { ownerId?: string; handle?: string } | null, owner: string | null) =>
    identity && identity.ownerId === owner ? identity.handle ?? null : null,
  resolveCanonicalIdentity: async (userId: string) => ({ ok: true, identity: { ownerId: userId, handle: "fixture_a" } }),
}));
vi.mock("@/lib/referralClaimClient", () => ({
  claimSignupReferralFromAuthCallback: async () => {},
  withReferralSignupProof: (attempt: unknown) => attempt,
}));

import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { usePintDrops } from "@/components/map/usePintDrops";
import { readProviderAccountRevision, readProviderSignOutRevision } from "@/lib/authProviderRevision";
import { deviceAccountOwner } from "@/lib/deviceAccountIdentity";
import { readDeviceAccounts, rememberDeviceAccount } from "@/lib/deviceAccountSessions";
import { OPTIMISTIC_SPILL_STORAGE_KEY, readOptimisticSpills, writeOptimisticSpills } from "@/lib/optimisticSpillPost";
import { pintDropDraftStorageKey } from "@/lib/pintDropDraft";
import type { Visibility } from "@/lib/spill";

const ACCOUNT = "account-a";
const OTHER = "account-b";
const VENUE_ID = "venue-test1";
const NOTE = "Account A's own Pint Drop story";
const accountDraftKeys = ["venue-one", "venue-two"].map((venueId) => pintDropDraftStorageKey(venueId, `account:${ACCOUNT}`));
const retainedKeys = [
  pintDropDraftStorageKey("venue-one", `account:${OTHER}`),
  pintDropDraftStorageKey("venue-one", "signed-out"),
];
const storedSpill = {
  clientRequestId: "fixture-failed-spill",
  drop: {
    id: "optimistic-fixture-failed-spill", handle: "fixture_a", priceGbp: null, drink: "", passedDownNote: NOTE,
    era: "", provenance: "anecdote", venueId: VENUE_ID, createdAt: "2026-10-04T18:00:00Z", vibeTags: [],
    pintPhotoUrl: null, venuePhotoUrl: null,
  },
  retry: {
    venueId: VENUE_ID, handle: "fixture_a", priceGbp: "", drink: "", passedDownNote: NOTE, era: "",
    visibility: "anonymous" as Visibility, vibeTags: [], pintPhotoUrl: null, venuePhotoUrl: null,
  },
} as Parameters<typeof writeOptimisticSpills>[1][number];

let auth: ReturnType<typeof useAuth> | null = null;
let drops: ReturnType<typeof usePintDrops> | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Probe() {
  const current = useAuth();
  const state = usePintDrops("london");
  useEffect(() => {
    auth = current;
    drops = state;
  });
  return createElement("output", { "data-testid": "viewer" }, current.user?.id ?? "signed-out");
}

function viewer(): string | null | undefined {
  return container?.querySelector('[data-testid="viewer"]')?.textContent;
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function signOut(scope?: "account" | "device"): Promise<void> {
  await act(async () => auth?.signOut(scope));
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  harness.outcome = "signed-out";
  harness.duringProviderSignOut = null;
  harness.events = [];
  harness.atActivate = null;
  harness.post = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url === "/api/pint-drops" && init.method === "POST" && harness.post) return harness.post(init);
    if (url.startsWith("/api/pint-drops")) return new Response(JSON.stringify({ drops: [] }));
    return new Response("{}");
  }));
  for (const key of [...accountDraftKeys, ...retainedKeys]) sessionStorage.setItem(key, "{}");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(Probe)));
  });
  await act(async () => {
    harness.emit?.("SIGNED_IN", {
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      user: { id: ACCOUNT, email: "a@example.com", email_confirmed_at: "2026-01-01T00:00:00.000Z" },
    });
  });
  await vi.waitFor(() => expect(auth?.handle).toBe("fixture_a"));
  expect(viewer()).toBe(ACCOUNT);
  expect(deviceAccountOwner(localStorage)).toBe(ACCOUNT);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});

describe("explicit sign-out account boundary", () => {
  it("leaves everything the account owns on this device when a refusal keeps the session", async () => {
    writeOptimisticSpills(localStorage, [storedSpill]);
    harness.outcome = "session-kept-refusal";
    localStorage.setItem(`pubmaxx:moment-draft:v1:${ACCOUNT}`, "{}");
    const signOutRevision = readProviderSignOutRevision("supabase");
    const accountRevision = readProviderAccountRevision();
    await signOut();
    expect(harness.events).toEqual(["provider-sign-out"]);
    expect(readProviderSignOutRevision("supabase")).toBe(signOutRevision);
    expect(readProviderAccountRevision()).toBe(accountRevision);
    expect(viewer()).toBe(ACCOUNT);
    expect(deviceAccountOwner(localStorage)).toBe(ACCOUNT);
    expect(readDeviceAccounts(localStorage).map((account) => account.userId)).toContain(ACCOUNT);
    expect(readOptimisticSpills(localStorage)).toEqual([storedSpill]);
    for (const key of accountDraftKeys) expect(sessionStorage.getItem(key)).toBe("{}");
    expect(localStorage.getItem(`pubmaxx:moment-draft:v1:${ACCOUNT}`)).toBe("{}");
  });

  describe.each(["signed-out", "removed-then-logout-error"] as const)("when the SDK removed the session (%s)", (outcome) => {
    beforeEach(() => {
      harness.outcome = outcome;
    });

    it("removes every venue draft, Moment draft and pending Pint Drop of the departing account with no map mounted", async () => {
      writeOptimisticSpills(localStorage, [storedSpill]);
      // jsdom has no IndexedDB, so the Moment draft lives in its documented localStorage fallback.
      for (const owner of [ACCOUNT, OTHER, "guest"]) localStorage.setItem(`pubmaxx:moment-draft:v1:${owner}`, "{}");
      const signOutRevision = readProviderSignOutRevision("supabase");
      await signOut();
      expect(harness.events).toEqual(["provider-sign-out", "durable-cookie-delete"]);
      expect(readProviderSignOutRevision("supabase")).toBe(signOutRevision + 1);
      expect(viewer()).toBe("signed-out");
      expect(deviceAccountOwner(localStorage)).toBeNull();
      expect(readDeviceAccounts(localStorage).map((account) => account.userId)).not.toContain(ACCOUNT);
      expect(localStorage.getItem(OPTIMISTIC_SPILL_STORAGE_KEY)).toBeNull();
      for (const key of accountDraftKeys) expect(sessionStorage.getItem(key)).toBeNull();
      for (const key of retainedKeys) expect(sessionStorage.getItem(key)).toBe("{}");
      expect(localStorage.getItem(`pubmaxx:moment-draft:v1:${ACCOUNT}`)).toBeNull();
      expect(localStorage.getItem(`pubmaxx:moment-draft:v1:${OTHER}`)).toBe("{}");
      expect(localStorage.getItem("pubmaxx:moment-draft:v1:guest")).toBe("{}");
    });

    it("purges the departing account and deletes the durable cookie before the next account takes over", async () => {
      rememberDeviceAccount(localStorage, { userId: OTHER, refreshToken: "synthetic-refresh-b", email: "b@example.com" }, Date.now() - 60_000);
      writeOptimisticSpills(localStorage, [storedSpill]);
      await signOut();
      expect(harness.events).toEqual(["provider-sign-out", "durable-cookie-delete", `activate:${OTHER}`]);
      expect(harness.atActivate).toEqual({ owner: null, spills: null, drafts: [], lane: [OTHER] });
    });

    it("forgets every remembered account and hands the device to nobody on a device sign-out", async () => {
      rememberDeviceAccount(localStorage, { userId: OTHER, refreshToken: "synthetic-refresh-b", email: "b@example.com" }, Date.now() - 60_000);
      writeOptimisticSpills(localStorage, [storedSpill]);
      await signOut("device");
      expect(harness.events).toEqual(["provider-sign-out", "durable-cookie-delete"]);
      expect(viewer()).toBe("signed-out");
      expect(deviceAccountOwner(localStorage)).toBeNull();
      expect(readDeviceAccounts(localStorage)).toEqual([]);
      expect(localStorage.getItem(OPTIMISTIC_SPILL_STORAGE_KEY)).toBeNull();
      for (const key of accountDraftKeys) expect(sessionStorage.getItem(key)).toBeNull();
    });
  });

  describe.each([
    ["public", "signed-out"],
    ["anonymous", "signed-out"],
    ["public", "removed-then-logout-error"],
    ["anonymous", "removed-then-logout-error"],
  ] as const)("a %s Pint Drop settling during a %s provider call", (visibility, outcome) => {
    beforeEach(() => {
      harness.outcome = outcome;
    });

    async function submitPending() {
      await act(async () => {
        drops?.setVisibility(visibility);
        drops?.setDropForm((form) => ({ ...form, note: NOTE }));
      });
      await act(async () => {
        void drops?.submitDrop({ preventDefault() {} } as React.FormEvent, VENUE_ID, { venueName: "The Fixture Arms" });
      });
      await vi.waitFor(() => expect(readOptimisticSpills(localStorage).map((entry) => entry.retry?.handle)).toEqual(["fixture_a"]));
    }

    it("cannot repopulate the purged feed storage with a late failure", async () => {
      harness.post = (init) => new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      });
      await submitPending();
      harness.duringProviderSignOut = settle;
      await signOut();
      await settle();
      expect(viewer()).toBe("signed-out");
      expect(localStorage.getItem(OPTIMISTIC_SPILL_STORAGE_KEY)).toBeNull();
      expect(drops?.dropMsg).toBeNull();
    });

    it("cannot repopulate the purged feed storage with a late accepted response", async () => {
      let accept!: () => void;
      harness.post = () => new Promise<Response>((resolve) => {
        accept = () => resolve(new Response(JSON.stringify({ drop: {
          ...storedSpill.drop, id: "fixture-accepted-drop", visibility,
          handle: visibility === "anonymous" ? "a PUBMAXXER" : "fixture_a",
        } }), { status: 201 }));
      });
      await submitPending();
      harness.duringProviderSignOut = async () => {
        accept();
        await settle();
      };
      await signOut();
      await settle();
      expect(viewer()).toBe("signed-out");
      expect(localStorage.getItem(OPTIMISTIC_SPILL_STORAGE_KEY)).toBeNull();
      expect(drops?.dropMsg).toBeNull();
    });
  });
});
