// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => createElement("img", props),
}));
vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "Site navigation"),
}));
vi.mock("@/app/admin/VenuePhotoModeration", () => ({
  default: () => null,
}));

import AdminClient from "@/app/admin/AdminClient";

const state = vi.hoisted(() => ({
  pintDropsFail: false,
  socialPosts: [] as Array<{
    staffDisplayName: string;
    postId: string;
    mediaId: string | null;
    moderationClaim: string;
    createdAt: string;
  }>,
  socialUnavailable: false,
}));

let host: HTMLDivElement;
let root: Root;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function responseFor(input: string, init?: RequestInit): Response {
  const url = new URL(input, "http://localhost");
  const method = init?.method ?? "GET";
  if (url.pathname === "/api/admin/session") {
    return method === "POST" ? jsonResponse({ ok: true }) : jsonResponse({ authenticated: true });
  }
  if (url.pathname === "/api/admin/social-posts") {
    return state.socialUnavailable
      ? jsonResponse({ error: "unavailable" }, 503)
      : jsonResponse({ posts: state.socialPosts });
  }
  if (url.pathname.startsWith("/api/pint-drops")) {
    return state.pintDropsFail ? jsonResponse({ error: "unavailable" }, 503) : jsonResponse({ drops: [] });
  }
  if (url.pathname === "/api/admin/community-prices") return jsonResponse({ prices: [] });
  if (url.pathname.startsWith("/api/admin/comments")) return jsonResponse({ comments: [] });
  if (url.pathname.startsWith("/api/visit-reports")) return jsonResponse({ reports: [] });
  if (url.pathname.startsWith("/api/venue-photos")) return jsonResponse({ photos: [] });
  if (url.pathname.startsWith("/api/admin/profile-avatars")) {
    return jsonResponse({ avatars: [], rotationCovers: [] });
  }
  throw new Error(`Unexpected request: ${method} ${url.pathname}`);
}

async function loadAdmin(): Promise<void> {
  await act(async () => {
    root.render(createElement(AdminClient));
  });
  const load = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Load reported drops"),
  );
  expect(load).toBeTruthy();
  await act(async () => {
    load!.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem("pubmax_admin_token", "admin-token");
  state.pintDropsFail = false;
  state.socialPosts = [];
  state.socialUnavailable = false;
  vi.stubGlobal("fetch", vi.fn(responseFor));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Admin Social post moderation queue", () => {
  it("shows empty only after a successful empty response", async () => {
    await loadAdmin();
    expect(host.textContent).toContain("No Social posts awaiting review");
    expect(host.textContent).not.toContain("Social post moderation is unavailable.");
  });

  it("shows unavailable when the Social queue cannot be read", async () => {
    state.socialUnavailable = true;
    await loadAdmin();
    expect(host.textContent).toContain("Social post moderation is unavailable.");
    expect(host.textContent).not.toContain("No Social posts awaiting review");
  });

  it("loads Social even when Pint Drop requests fail", async () => {
    state.pintDropsFail = true;
    state.socialPosts = [{
      staffDisplayName: "Captain",
      postId: "11111111-1111-4111-8111-111111111111",
      mediaId: "22222222-2222-4222-8222-222222222222",
      moderationClaim: "A post with a photo",
      createdAt: "2026-08-29T12:00:00.000Z",
    }];
    await loadAdmin();
    expect(host.textContent).toContain("A post with a photo");
    expect(host.querySelector('img[src="/api/admin/social-posts/media/22222222-2222-4222-8222-222222222222"]')).toBeTruthy();
    expect(
      [...host.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Load reported drops"),
      ),
    ).toBeTruthy();
  });
});
