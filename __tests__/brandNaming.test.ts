import type { Metadata } from "next";

import { describe, expect, it } from "vitest";

import {
  APP_NAME,
  BRAND_NAME,
  appPageTitle,
  metadataSiteName,
} from "@/lib/brandNaming";

describe("brand naming (captain 2026-08-17)", () => {
  it("names the brand and app separately", () => {
    expect(BRAND_NAME).toBe("PUBMAXX");
    expect(APP_NAME).toBe("PUBMAXXING");
  });

  it("uses the app name in page titles", () => {
    expect(appPageTitle("Privacy")).toBe("Privacy · PUBMAXXING");
  });

  it("uses the brand in metadata siteName", () => {
    expect(metadataSiteName()).toBe("PUBMAXX");
  });
});

// The sweep itself: every page that restates openGraph (App Router replaces the
// layout's object wholesale rather than merging it) must resolve the BRAND for
// siteName. These are the routes the brand decision touched; the assertion runs
// their real `metadata` / `generateMetadata`, so a page that reverts to
// "PUBMAXXING" fails here rather than shipping a wrong share card.
const OG_SITE_NAME_PAGES: ReadonlyArray<[string, () => Promise<Metadata>]> = [
  ["/about", async () => (await import("@/app/about/page")).metadata],
  ["/out", async () => (await import("@/app/out/page")).metadata],
  ["/privacy", async () => (await import("@/app/privacy/page")).metadata],
  ["/terms", async () => (await import("@/app/terms/page")).metadata],
  ["/historic", async () => (await import("@/app/historic/page")).metadata],
  ["/pubs", async () => (await import("@/app/pubs/page")).generateMetadata()],
  ["/social", async () => (await import("@/app/social/page")).generateMetadata()],
  [
    "/landmark/[id]",
    async () => {
      const { landmarks } = await import("@/lib/landmarks");
      const id = landmarks[0]?.id;
      expect(id, "a landmark to ask about").toBeTruthy();
      const { generateMetadata } = await import("@/app/landmark/[id]/page");
      return generateMetadata({
        params: Promise.resolve({ id: id as string }),
      });
    },
  ],
];

describe("page metadata names the brand, never the app", () => {
  it.each(OG_SITE_NAME_PAGES)("%s carries the brand siteName", async (_route, load) => {
    const resolved = await load();
    expect(resolved.openGraph, "page restates openGraph").toBeTruthy();
    expect(
      (resolved.openGraph as { siteName?: string }).siteName,
    ).toBe(BRAND_NAME);
  });

  it("names the app, never the brand, in the share-card title", async () => {
    const privacy = (await import("@/app/privacy/page")).metadata;
    const privacyCardTitle = (privacy.openGraph as { title?: string }).title;
    expect(privacyCardTitle).toBe(appPageTitle("Privacy"));

    const social = await (await import("@/app/social/page")).generateMetadata();
    expect((social.openGraph as { title?: string }).title).toContain(APP_NAME);
  });
});
