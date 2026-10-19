// @vitest-environment jsdom

import { act, Suspense, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/u/focus_pints",
  notFound: () => { throw new Error("notFound"); },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...props }: {
    href: string; children: ReactNode; prefetch?: boolean;
  }) => { void _prefetch; return <a href={href} {...props}>{children}</a>; },
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/SiteNavMore", () => ({ default: () => null }));
vi.mock("@/components/profile/PubmaxxAccountHub", () => ({ default: () => null }));
vi.mock("@/components/profile/ProfileTimeline", () => ({ default: () => null }));
vi.mock("@/components/profile/SocialLinksEditor", () => ({ default: () => null }));
vi.mock("@/components/social/CrewsPanel", () => ({ default: () => null }));
vi.mock("@/components/diary/DiaryList", () => ({ default: () => null }));
vi.mock("@/components/wanted/WantedList", () => ({ default: () => null }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    accountRevision: 0, user: { id: "local-focus-owner" }, handle: "focus_pints",
    configured: true, identityResolved: true, signOut: async () => undefined,
  }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ phase: "signed-in", signedIn: true, signedOut: false, unresolved: false }),
}));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => "focus_pints" }));
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => "local-focus-token" }));

import ProfilePageClient from "@/app/u/[handle]/ProfilePageClient";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";
import { publishAuthActionState } from "@/lib/authedFetch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const profile = {
  id: "11111111-1111-4111-8111-111111111111", handle: "focus_pints", displayName: "Focus Pints",
  visibility: "public", createdAt: "2026-06-01T12:00:00.000Z", updatedAt: "2026-10-13T09:00:00.000Z",
};
let host: HTMLDivElement;
let root: Root;
const writes: string[] = [];

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

beforeEach(() => {
  clearSurfaceCache();
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  writes.length = 0;
  window.history.replaceState(null, "", "/u/focus_pints");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (init?.method === "PATCH") {
      writes.push(url.pathname);
      return json({ profile: { ...profile, displayName: "Saved Focus Pints" } });
    }
    if (url.pathname === "/api/profiles/focus_pints") return json({ profile, projection: "full", socialLinks: [], counts: { followers: 0, following: 0 }, viewerFollowing: false, followsViewer: false });
    if (url.pathname === "/api/pint-drops") return json({ drops: [], passportAreas: [] });
    if (url.pathname === "/api/crawls") return json({ crawls: [], count: 0, unlisted: [] });
    return json({});
  }));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearSurfaceCache();
  publishAuthActionState({ status: "unknown", identityResolved: false });
  vi.unstubAllGlobals();
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function button(selector: string): HTMLButtonElement {
  const element = host.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing profile control: ${selector}`);
  return element;
}

async function visit() {
  const params = Promise.resolve({ handle: "focus_pints" });
  await act(async () => root.render(<Suspense fallback={null}><ProfilePageClient params={params} /></Suspense>));
  await vi.waitFor(async () => {
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector(".profileEditToggle")).not.toBeNull();
  });
}

it("waits for the owner's stored fields before opening a form that can save", async () => {
  let release!: (value: Response) => void;
  const storedRead = new Promise<Response>((resolve) => { release = resolve; });
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((input, init) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/profiles/focus_pints" && init?.method !== "PATCH") return storedRead;
    return originalFetch(input, init);
  });
  await visit();
  await act(async () => button(".profileEditToggle").click());
  expect(host.querySelector('[aria-label="Edit your profile"]')).toBeNull();
  expect(host.querySelector("#profile-editing")?.textContent).toContain("Loading your profile");
  expect(writes).toEqual([]);
  await act(async () => release(json({
    profile: { ...profile, bio: "My existing bio", favouriteDrink: "Gin and beer" },
    projection: "full", socialLinks: [], counts: { followers: 0, following: 0 },
  })));
  expect(host.querySelector<HTMLInputElement>("#pe-displayName")?.value).toBe("Focus Pints");
  expect(host.querySelector<HTMLTextAreaElement>("#pe-bio")?.value).toBe("My existing bio");
  expect(host.querySelector<HTMLInputElement>("#pe-favouriteDrink")?.value).toBe("Gin and beer");
});

it("cannot save missing private fields when the read returns a limited card", async () => {
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((input, init) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/profiles/focus_pints" && init?.method !== "PATCH") {
      return Promise.resolve(json({ profile: { handle: "focus_pints", displayName: "Focus Pints" }, projection: "limited", socialLinks: [] }));
    }
    return originalFetch(input, init);
  });
  await visit();
  await act(async () => button(".profileEditToggle").click());
  expect(host.querySelector('[aria-label="Edit your profile"]')).toBeNull();
  expect(host.querySelector('#profile-editing a')?.getAttribute("href")).toBe("/u/focus_pints?edit=1");
  expect(writes).toEqual([]);
});

it("returns focus to Edit profile when Cancel removes the inline editor", async () => {
  await visit();
  const opener = button(".profileEditToggle");
  await act(async () => { opener.focus(); opener.click(); });
  const cancel = button(".profileEditorCancel");
  await act(async () => { cancel.focus(); cancel.click(); });
  expect(host.querySelector('[aria-label="Edit your profile"]')).toBeNull();
  expect(opener.textContent).toBe("Edit profile");
  expect(document.activeElement).toBe(opener);
  expect(writes).toEqual([]);
});

it("keeps focus on the header control when Close editor removes the form", async () => {
  await visit();
  const opener = button(".profileEditToggle");
  await act(async () => { opener.focus(); opener.click(); });
  expect(opener.textContent).toBe("Close editor");
  await act(async () => button(".profileEditorCancel").focus());
  await act(async () => { opener.focus(); opener.click(); });
  expect(host.querySelector('[aria-label="Edit your profile"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(writes).toEqual([]);
});

it("returns focus after a successful local save and retains the saved profile notice", async () => {
  await visit();
  const opener = button(".profileEditToggle");
  await act(async () => { opener.focus(); opener.click(); });
  const save = button(".profileEditorSave");
  await act(async () => { save.focus(); save.click(); });
  await vi.waitFor(async () => {
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector('[aria-label="Edit your profile"]')).toBeNull();
  });
  expect(writes).toEqual(["/api/profiles/focus_pints"]);
  expect(host.querySelector(".profileDisplayName")?.textContent).toBe("Saved Focus Pints");
  expect(host.querySelector('.profileSavedNotice[role="status"]')?.textContent?.trim()).toBe("Saved");
  expect(document.activeElement).toBe(opener);
});

it("preserves edit deep links and returns focus after their inline Cancel", async () => {
  window.history.replaceState(null, "", "/u/focus_pints?edit=1#passport");
  await visit();
  await vi.waitFor(async () => {
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    expect(host.querySelector('[aria-label="Edit your profile"]')).not.toBeNull();
  });
  expect(window.location.search).toBe("");
  expect(window.location.hash).toBe("#passport");
  const cancel = button(".profileEditorCancel");
  await act(async () => { cancel.focus(); cancel.click(); });
  expect(document.activeElement).toBe(button(".profileEditToggle"));
  expect(writes).toEqual([]);
});

it("does not take focus when the read-only profile first arrives", async () => {
  await visit();
  expect(document.activeElement).not.toBe(button(".profileEditToggle"));
  expect(host.querySelector('[aria-label="Edit your profile"]')).toBeNull();
});
