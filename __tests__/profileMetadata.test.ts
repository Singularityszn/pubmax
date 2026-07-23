import { describe, expect, it, vi } from "vitest";

// Route modules can run assertServerEnv() at import scope (the house pattern).
// On Vercel vitest reads as production without test-scoped Supabase vars, so the
// import would throw — mock it to a no-op, exactly like every sibling route test
// (see __tests__/opsFreeze.test.ts).
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { generateMetadata } from "@/app/u/[handle]/page";

describe("profile route metadata", () => {
  it("titles a real handle profile with the handle and pins a canonical", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ handle: "Sam" }),
    });

    // normalizeHandle lowercases, so "Sam" → "sam".
    expect(metadata.title).toBe("@sam");
    expect(metadata.description).toBe(
      "@sam's pint passport on PUBMAXX. Their Pint Drops, saved pubs, and the crawls they've walked.",
    );
    expect(metadata.alternates).toEqual({ canonical: "/u/sam" });
    expect(metadata.openGraph).toMatchObject({
      title: "@sam",
      url: "/u/sam",
      type: "profile",
    });
    // A public profile stays indexable (the OG image is supplied by the
    // file-convention opengraph-image.tsx, so no images are set here).
    expect(metadata.robots).toBeUndefined();
    expect(metadata.openGraph).not.toHaveProperty("images");
  });

  it("keeps the per-viewer 'you' sentinel out of search", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ handle: "you" }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
  });

  it("keeps a missing/unusable handle out of search", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ handle: "@@@" }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
