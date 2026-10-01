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
        params: Promise.resolve({ handle: "never_existed_qa9" }),
        children: "profile",
      }),
    ).resolves.toBe("profile");
  });
});
