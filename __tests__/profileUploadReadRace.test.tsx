// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  viewerHandle: "owner",
  auth: { accountRevision: 1, user: { id: "owner" }, identityResolved: true, signOut: vi.fn() },
  deliverProfile: null as null | ((body: unknown) => void),
  upload: vi.fn(),
  router: { replace: vi.fn(), push: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => state.router }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => { const imageProps = { ...props }; delete imageProps.unoptimized; return createElement("img", imageProps); } }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => state.auth }));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => state.viewerHandle }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => ({ unresolved: false, signedOut: false }) }));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({ useSocialFriendsLaunch: () => true }));
vi.mock("@/lib/authedFetch", () => ({ authedFetch: (...args: Parameters<typeof fetch>) => fetch(...args), authedActionFetch: (...args: unknown[]) => state.upload(...args), AuthActionSessionError: class extends Error {} }));
vi.mock("@/lib/surfaceDataCache", () => ({ loadSurfaceJson: async (url: string, _options: unknown, publish: (value: unknown) => void) => {
  if (url.startsWith("/api/profiles/")) {
    await new Promise<void>(resolve => { state.deliverProfile = body => { publish(body); resolve(); }; });
  } else { publish({ drops: [] }); }
  return "fresh";
} }));
vi.mock("@/lib/savedPubs", () => ({ fetchFollowedListsForHandle: async () => [], fetchSavedForHandle: async () => [], groupDTOsByList: () => ({}), savedByList: () => ({}) }));
vi.mock("@/components/profile/ProfileImageCropper", () => ({ default: ({ onCropped }: { onCropped: (file: File) => void }) => <button type="button" onClick={() => onCropped(new File(["jpeg"], "crop.jpg", { type: "image/jpeg" }))}>Use photo</button> }));
vi.mock("@/components/profile/ClaimMomentWelcome", () => ({ default: () => null }));
vi.mock("@/components/profile/ContributionLanesCard", () => ({ default: () => null }));
vi.mock("@/components/profile/FirstActionsRow", () => ({ default: () => null }));
vi.mock("@/components/profile/FollowButton", () => ({ default: () => null }));
vi.mock("@/components/profile/NextBadgeChips", () => ({ default: () => null }));
vi.mock("@/components/profile/OutTonightBoard", () => ({ default: () => null }));
vi.mock("@/components/profile/OutTonightCrewLine", () => ({ default: () => null }));
vi.mock("@/components/profile/OutTonightToggle", () => ({ default: () => null }));
vi.mock("@/components/profile/PintPassport", () => ({ default: () => null }));
vi.mock("@/components/profile/SocialLinksEditor", () => ({ default: () => null }));
vi.mock("@/components/profile/SavedPubList", () => ({ default: () => null }));
vi.mock("@/components/profile/YourContributionsCard", () => ({ default: () => null }));
vi.mock("@/components/profile/ProfileCoverPhotosEditor", () => ({ default: () => null }));
vi.mock("@/components/profile/ProfileCoverCarousel", () => ({ default: () => null }));
vi.mock("@/components/profile/ProfileSocialLinks", () => ({ default: () => null }));
vi.mock("@/components/messages/ProfileMessageButton", () => ({ default: () => null }));
vi.mock("@/components/wanted/WantedList", () => ({ default: () => null }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/SiteNavMore", () => ({ default: () => null }));

import ProfilePageClient from "@/app/u/[handle]/ProfilePageClient";
let host: HTMLDivElement;
let root: Root;
const profile = { id: "owner", handle: "owner", displayName: "Owner", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.deliverProfile = null;
  state.auth.accountRevision = 1; state.auth.user = { id: "owner" }; state.viewerHandle = "owner";
  state.upload.mockReset().mockResolvedValue({ ok: true, json: async () => ({ profile: { ...profile, avatarUrl: "/api/avatar/owner/new" } }) });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ crawls: [], saved: [], lists: [] }) })));
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("keeps the uploaded header avatar when an older public read finishes", async () => {
  const params = Promise.resolve({ handle: "owner" });
  await act(async () => root.render(<ProfilePageClient params={params} />));
  expect(state.deliverProfile).not.toBeNull();
  const edit = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Edit profile");
  expect(edit).toBeDefined();
  await act(async () => edit!.click());
  const input = host.querySelector<HTMLInputElement>("#pe-avatar-file")!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.defineProperty(input, "files", { value: [new File(["source"], "photo.jpg", { type: "image/jpeg" })], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const usePhoto = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Use photo")!;
  await act(async () => usePhoto.click());
  expect(state.upload).toHaveBeenCalledWith("/api/profiles/owner/avatar", expect.objectContaining({ method: "POST" }), { requiresIdentity: true });
  expect(host.querySelector("header.profileHeader img.profileAvatar")?.getAttribute("src")).toBe("/api/avatar/owner/new");
  await act(async () => state.deliverProfile!({ profile }));
  expect(host.querySelector("header.profileHeader img.profileAvatar")?.getAttribute("src")).toBe("/api/avatar/owner/new");
  expect(host.textContent).toContain("Editing your profile");
  state.auth.accountRevision += 1;
  await act(async () => root.render(<ProfilePageClient params={params} />));
  await act(async () => state.deliverProfile!({ profile: { ...profile, avatarUrl: "/api/avatar/owner/later" } }));
  expect(host.querySelector("header.profileHeader img.profileAvatar")?.getAttribute("src")).toBe("/api/avatar/owner/later");
});

it("rejects an old account read after the viewer changes", async () => {
  const params = Promise.resolve({ handle: "owner" });
  await act(async () => root.render(<ProfilePageClient params={params} />));
  const previousRead = state.deliverProfile!;
  state.auth.accountRevision = 2; state.auth.user = { id: "other" }; state.viewerHandle = "other";
  await act(async () => root.render(<ProfilePageClient params={params} />));
  await act(async () => previousRead({ profile: { ...profile, avatarUrl: "/api/avatar/owner/stale" } }));
  expect(host.querySelector("header.profileHeader img.profileAvatar")).toBeNull();
  await act(async () => state.deliverProfile!({ profile: { ...profile, avatarUrl: "/api/avatar/owner/public" } }));
  expect(host.querySelector("header.profileHeader img.profileAvatar")?.getAttribute("src")).toBe("/api/avatar/owner/public");
  expect(Array.from(host.querySelectorAll("button")).some(button => button.textContent === "Edit profile")).toBe(false);
});
