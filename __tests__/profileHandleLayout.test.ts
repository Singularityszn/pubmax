import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ProfileHandleLayout from "@/app/u/[handle]/layout";
import { UnclaimedProfileContent } from "@/app/u/UnclaimedProfile";
import { identityHandleStore } from "@/lib/identityHandleStore";
import { __resetMemoryProfiles, __seedMemoryOwnedProfile } from "@/lib/profileStore";

describe("profile handle layout", () => {
  it("calls notFound for an identity block before the page streams", async () => {
    await expect(
      ProfileHandleLayout({
        params: Promise.resolve({ handle: "karansdad" }),
        children: null,
      }),
    ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("renders a normal handle", async () => {
    __resetMemoryProfiles();
    __seedMemoryOwnedProfile("existing_handle", "user-existing");
    await expect(
      ProfileHandleLayout({
        params: Promise.resolve({ handle: "existing_handle" }),
        children: "profile",
      }),
    ).resolves.toBe("profile");
  });

  it("calls notFound for an unclaimed handle before the page streams", async () => {
    __resetMemoryProfiles();
    await expect(
      ProfileHandleLayout({
        params: Promise.resolve({ handle: "never-existed-qa9" }),
        children: "profile",
      }),
    ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("renders the normalised handle and a claim link for the missing profile", () => {
    const html = renderToStaticMarkup(createElement(UnclaimedProfileContent, {
      pathname: "/u/nobody-here-xyz",
      fallback: null,
    }));
    expect(html).toContain("Nobody has claimed @nobodyherexyz");
    expect(html).toContain("Claim a handle");
    expect(html).toContain('href="/u/you"');
  });

  it("does not treat a storage failure as an unclaimed handle", async () => {
    const resolve = vi.spyOn(identityHandleStore(), "resolve").mockRejectedValueOnce(new Error("storage unavailable"));
    try {
      await expect(ProfileHandleLayout({
        params: Promise.resolve({ handle: "someone" }),
        children: "profile",
      })).rejects.toThrow("storage unavailable");
    } finally {
      resolve.mockRestore();
    }
  });

  it("keeps the viewer sentinel and blocked handles on their own paths", async () => {
    await expect(ProfileHandleLayout({
      params: Promise.resolve({ handle: "you" }),
      children: "profile",
    })).resolves.toBe("profile");
    const html = renderToStaticMarkup(createElement(UnclaimedProfileContent, {
      pathname: "/u/karansdad",
      fallback: "Not found",
    }));
    expect(html).toBe("Not found");
  });
});
