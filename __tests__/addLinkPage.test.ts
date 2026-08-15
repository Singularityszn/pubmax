import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const profileRead = vi.hoisted(() => ({
  getByHandle: vi.fn(),
}));
const durableStore = vi.hoisted(() => ({ configured: false }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/social/ConfirmFollow", () => ({ default: () => null }));
vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({ getByHandle: profileRead.getByHandle }),
  publicOwnedImageUrl: () => null,
  isProfileTombstoned: (profile: { tombstonedAt?: string } | null | undefined) =>
    Boolean(profile?.tombstonedAt),
}));
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => durableStore.configured,
}));
vi.mock("@/app/add/[handle]/AddPageShell", () => ({
  default: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

import AddHandlePage from "@/app/add/[handle]/page";

function loadPage(): ReturnType<typeof AddHandlePage> {
  return AddHandlePage({
    params: Promise.resolve({ handle: "karan" }),
    searchParams: Promise.resolve({}),
  });
}

describe("add-link target read", () => {
  beforeEach(() => {
    profileRead.getByHandle.mockReset();
    durableStore.configured = false;
  });

  it("404s a deleted account even without a durable store", async () => {
    durableStore.configured = false;
    profileRead.getByHandle.mockResolvedValue({
      handle: "karan",
      displayName: "Retained name",
      tombstonedAt: "2026-08-16T00:00:00.000Z",
    });

    await expect(loadPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("does not turn an unanswered read into a 404", async () => {
    durableStore.configured = true;
    profileRead.getByHandle.mockRejectedValue(new Error("store unavailable"));

    await expect(loadPage()).resolves.toBeDefined();
  });
});
