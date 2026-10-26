// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  accountRevision: 0,
  user: { id: "optional-details-owner" },
  session: { user: { id: "optional-details-owner" }, access_token: "local-test-token" },
  loading: false,
  identityResolved: true,
  configured: true,
  handle: null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/u/you",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => "local-test-token" }));

import PubmaxxAccountHub from "@/components/profile/PubmaxxAccountHub";
import { AccountOnboardingForm } from "@/components/identity/AccountOnboarding";
import { CURRENT_IDENTITY_PATH, forgetCurrentIdentityRead } from "@/lib/currentIdentityRead";
import { publishAuthActionState } from "@/lib/authedFetch";
import { SocialFriendsLaunchProvider } from "@/lib/useSocialFriendsLaunch";

it("keeps unclaimed profile guidance consistent with optional onboarding details", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  forgetCurrentIdentityRead();
  localStorage.clear();
  const requests = vi.fn<typeof fetch>(async () => Response.json({ handle: null, profile: null, pending: [] }));
  vi.stubGlobal("fetch", requests);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(PubmaxxAccountHub)));
    expect(host.textContent).toContain("Claim your @handle");
    expect(host.textContent).toContain("Your name and date of birth are optional.");
    expect(host.textContent).not.toContain("Claiming a handle alone is not enough");
    expect(requests.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    await act(async () => root.render(createElement(AccountOnboardingForm, {
      handle: "night_owl", dateOfBirth: "", fullName: "", availability: "available",
      busy: false, error: null, onHandleChange: vi.fn(), onDateOfBirthChange: vi.fn(),
      onFullNameChange: vi.fn(), onSubmit: vi.fn(),
    })));
    const labels = [...host.querySelectorAll("label")];
    expect(labels.find((label) => label.textContent?.startsWith("Name"))?.textContent).toContain("Optional");
    expect(labels.find((label) => label.textContent?.startsWith("Date of birth"))?.textContent).toContain("Optional");
    const claim = [...host.querySelectorAll("button")].find((button) => button.textContent === "Claim handle");
    expect(claim).toBeDefined();
    expect(claim?.disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe("");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    forgetCurrentIdentityRead();
    publishAuthActionState({ status: "unknown", identityResolved: false });
    vi.unstubAllGlobals();
  }
});

const INVITE_LINK_PATH = "/api/referrals/invite-link";
const SYNTHETIC_INVITE_URL = "https://pubmaxx.test/r/synthetic-invite-0001";

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

// Same-app fakes for the reads a signed-in hub makes on mount. Nothing leaves
// the test: every other path gets the generic empty account body.
function accountRead(path: string): Response {
  if (path === CURRENT_IDENTITY_PATH) return Response.json({ handle: null });
  if (path === "/api/me/night-profile") return Response.json({ profile: null });
  if (path === "/api/referrals/status") {
    return Response.json({ qualifiedCount: 0, nextMilestone: 1, mark: null });
  }
  return Response.json({ handle: null, profile: null, pending: [] });
}

function offAppPaths(calls: ReadonlyArray<Parameters<typeof fetch>>): string[] {
  return calls
    .map(([input]) => requestPath(input))
    .filter((path) => !path.startsWith("/") || path.startsWith("//"));
}

function buttonNamed(host: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((button) => button.textContent === name);
}

function inviteLinkInput(host: HTMLElement): HTMLInputElement | null | undefined {
  return [...host.querySelectorAll("label")]
    .find((label) => label.textContent?.startsWith("Your invite link"))
    ?.querySelector("input");
}

async function withSignedInHub(
  network: typeof fetch,
  run: (host: HTMLDivElement) => Promise<void>,
): Promise<void> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  forgetCurrentIdentityRead();
  localStorage.clear();
  vi.stubGlobal("fetch", network);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(
      SocialFriendsLaunchProvider,
      { value: true },
      createElement(PubmaxxAccountHub),
    )));
    await run(host);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    forgetCurrentIdentityRead();
    publishAuthActionState({ status: "unknown", identityResolved: false });
    localStorage.clear();
    vi.unstubAllGlobals();
  }
}

it("shows optional usage analytics as a plain, withdrawable choice on the signed-in hub", async () => {
  const requests = vi.fn<typeof fetch>(async (input) => accountRead(requestPath(input)));
  await withSignedInHub(requests, async (host) => {
    const heading = [...host.querySelectorAll("h3")]
      .find((candidate) => candidate.textContent === "Optional usage analytics");
    expect(heading).toBeDefined();
    const section = heading?.parentElement;
    expect(section?.textContent).toContain(
      "using a persistent device ID, standard browser details and allow-listed product events",
    );
    expect(section?.textContent).toContain("It's optional, and you can withdraw it here.");
    expect([...(section?.querySelectorAll("button") ?? [])].map((button) => button.textContent))
      .toEqual(["Allow", "No thanks"]);
    expect(host.textContent).not.toContain("Anonymous usage analytics");
    expect(host.textContent).not.toContain("person-level account checks");
    expect(requests.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(offAppPaths(requests.mock.calls)).toEqual([]);
  });
});

it("shares the fetched invite link only when the reader taps Share", async () => {
  let resolveInvite: (response: Response) => void = () => undefined;
  const inviteResponse = new Promise<Response>((resolve) => {
    resolveInvite = resolve;
  });
  const requests = vi.fn<typeof fetch>(async (input) => {
    const path = requestPath(input);
    return path === INVITE_LINK_PATH ? inviteResponse : accountRead(path);
  });
  const inviteRequests = () =>
    requests.mock.calls.filter(([input]) => requestPath(input) === INVITE_LINK_PATH);
  const share = vi.fn<(data: ShareData) => Promise<void>>(async () => undefined);
  const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, "share");
  // Installed before mount: the hub reads Web Share support on first client render.
  Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: share });
  try {
    await withSignedInHub(requests, async (host) => {
      expect(inviteRequests()).toEqual([]);
      const invite = buttonNamed(host, "Invite a mate");
      expect(invite).toBeDefined();
      await act(async () => invite?.click());

      expect(inviteRequests()).toHaveLength(1);
      const inviteInit = inviteRequests()[0]?.[1];
      expect(inviteInit?.method).toBe("POST");
      expect(new Headers(inviteInit?.headers).get("authorization")).toBe("Bearer local-test-token");
      expect(buttonNamed(host, "Getting your link…")?.disabled).toBe(true);
      expect(inviteLinkInput(host)).toBeUndefined();
      expect(share).not.toHaveBeenCalled();

      await act(async () => resolveInvite(Response.json({ url: SYNTHETIC_INVITE_URL })));
      expect(inviteLinkInput(host)?.value).toBe(SYNTHETIC_INVITE_URL);
      expect(host.textContent).toContain("Your invite link is ready. Copy it or share it.");
      expect(share).not.toHaveBeenCalled();

      const shareButton = buttonNamed(host, "Share…");
      expect(shareButton).toBeDefined();
      await act(async () => shareButton?.click());
      expect(share.mock.calls).toEqual([[{
        title: "PUBMAXX",
        text: "Listed pub prices name and link their publisher when recorded and say when none is recorded.",
        url: SYNTHETIC_INVITE_URL,
      }]]);
      expect(host.textContent).toContain("Invite link shared.");
      expect(inviteRequests()).toHaveLength(1);
      expect(offAppPaths(requests.mock.calls)).toEqual([]);
    });
  } finally {
    if (shareDescriptor) Object.defineProperty(navigator, "share", shareDescriptor);
    else Reflect.deleteProperty(navigator, "share");
  }
});
