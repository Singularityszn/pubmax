import { describe, expect, it } from "vitest";

import ProfileHandleLayout from "@/app/u/[handle]/layout";

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
    await expect(
      ProfileHandleLayout({
        params: Promise.resolve({ handle: "existing_handle" }),
        children: "profile",
      }),
    ).resolves.toBe("profile");
  });

  it("lets the authenticated profile read decide whether a handle is unclaimed", async () => {
    await expect(
      ProfileHandleLayout({
        params: Promise.resolve({ handle: "never-existed-qa9" }),
        children: "profile",
      }),
    ).resolves.toBe("profile");
  });

  it("keeps the viewer sentinel and blocked handles on their own paths", async () => {
    await expect(ProfileHandleLayout({
      params: Promise.resolve({ handle: "you" }),
      children: "profile",
    })).resolves.toBe("profile");
  });
});
