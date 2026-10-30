import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Metadata } from "next";

import { describe, expect, it, vi } from "vitest";

import {
  APP_NAME,
  BRAND_NAME,
  appPageTitle,
  metadataSiteName,
} from "@/lib/brandNaming";
import { AnalyticsConsentPromptContent } from "@/components/AnalyticsConsentPrompt";
import { PageHead } from "@/components/auth/LoginPage";
import PintPassport from "@/components/profile/PintPassport";
import { buildPassport } from "@/lib/passport";

// /pubs derives its own title from the row count, and the count is the only
// reason its metadata touches the dataset. The share-card name is what is under
// test here, so the read is stubbed rather than parsing the priced index.
vi.mock("@/lib/scrapedPubs.server", () => ({
  readScrapedPubsForPage: async () => ({ pubs: [], complete: true }),
}));

// next/font is a build-time loader, so the root layout needs its faces stubbed
// to be importable here. Nothing about the metadata under test reads them, but
// the layout reads each Google face's generated fallback from style.fontFamily,
// so the stub keeps next/font's "primary, fallback" shape.
vi.mock("next/font/google", () => {
  const face = () => ({
    variable: "--font-x",
    className: "font-x",
    style: { fontFamily: "'X', 'X Fallback'" },
  });
  return { Space_Grotesk: face, Inter: face };
});
vi.mock("next/font/local", () => {
  const face = () => ({ variable: "--font-x", className: "font-x", style: {} });
  return { default: face };
});

describe("brand naming (product decision 16 Oct 2026)", () => {
  it("names PUBMAXX on the web, and keeps the old name for the native install alone", () => {
    expect(BRAND_NAME).toBe("PUBMAXX");
    // The native shells and the store record keep it until the captain
    // renames them; no web surface may print it (the fences below).
    expect(APP_NAME).toBe("PUBMAXXING");
  });

  it("names PUBMAXX on the offline page the service worker falls back to", () => {
    // public/sw.js serves this document when a navigation has no network, so
    // it is a web surface like any page and keeps no trace of the old name.
    const offline = readFileSync(path.join(process.cwd(), "public/offline.html"), "utf8");
    expect(offline).not.toContain(APP_NAME);
    expect(offline).toContain(`<title>You're offline. ${BRAND_NAME}</title>`);
  });

  it("uses the one name in share-card page titles", () => {
    expect(appPageTitle("Privacy")).toBe("Privacy · PUBMAXX");
  });

  it("uses the brand in metadata siteName", () => {
    expect(metadataSiteName()).toBe("PUBMAXX");
  });
});

// Every route that restates openGraph must resolve the BRAND for siteName. App
// Router replaces a parent's openGraph object wholesale rather than merging it,
// so each of these owns its own share-card name, and the assertion runs their
// real `metadata` / `generateMetadata`: a page that reverts to the old name
// fails here rather than shipping a wrong card. The list covers the routes the
// brand decision touched PLUS the ones that still hold the literal, so an edit
// to either group is caught.
const OG_SITE_NAME_PAGES: ReadonlyArray<[string, () => Promise<Metadata>]> = [
  ["/about", async () => (await import("@/app/about/page")).metadata],
  ["/privacy", async () => (await import("@/app/privacy/page")).metadata],
  ["/terms", async () => (await import("@/app/terms/page")).metadata],
  ["/historic", async () => (await import("@/app/historic/page")).metadata],
  [
    "/time-machine",
    async () =>
      (await import("@/app/time-machine/page")).generateMetadata({
        searchParams: Promise.resolve({ year: "2013" }),
      }),
  ],
  ["/pubs", async () => (await import("@/app/pubs/page")).generateMetadata()],
  ["/social", async () => (await import("@/app/social/page")).generateMetadata({ searchParams: Promise.resolve({}) })],
  ["root layout", async () => (await import("@/app/layout")).metadata],
  ["/", async () => (await import("@/app/page")).metadata],
  ["/feed", async () => (await import("@/app/feed/page")).metadata],
  ["/crawls", async () => (await import("@/app/crawls/page")).metadata],
  ["/dog-of-the-week", async () => (await import("@/app/dog-of-the-week/page")).metadata],
  [
    "/u/[handle]",
    async () =>
      (await import("@/app/u/[handle]/page")).generateMetadata({
        params: Promise.resolve({ handle: "karan" }),
      }),
  ],
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

// The document title a reader sees is the page's own title run through the
// root layout's template, so that is what the no-double-brand rule is about.
// Resolved with Next's own resolver rather than a restatement of it.
const TEMPLATED_TITLE_PAGES: ReadonlyArray<[string, () => Promise<Metadata>]> = [
  ["/about", async () => (await import("@/app/about/page")).metadata],
  ["/privacy", async () => (await import("@/app/privacy/page")).metadata],
  ["/terms", async () => (await import("@/app/terms/page")).metadata],
  ["/pubs", async () => (await import("@/app/pubs/page")).generateMetadata()],
  ["/social", async () => (await import("@/app/social/page")).generateMetadata({ searchParams: Promise.resolve({}) })],
];

describe("a document title carries the brand exactly once", () => {
  it.each(TEMPLATED_TITLE_PAGES)("%s", async (_route, load) => {
    const { resolveTitle } = await import(
      "next/dist/lib/metadata/resolvers/resolve-title.js"
    );
    const root = (await import("@/app/layout")).metadata;
    const template = (root.title as { template?: string }).template;
    expect(template).toBe(`%s | ${BRAND_NAME}`);

    const page = await load();
    const resolved = resolveTitle(page.title, template).absolute as string;

    expect(resolved.endsWith(` | ${BRAND_NAME}`)).toBe(true);
    expect(resolved.split(`| ${BRAND_NAME}`)).toHaveLength(2);
    expect(resolved).not.toContain(APP_NAME);
  });
});

describe("page metadata names the brand, never the app", () => {
  it.each(OG_SITE_NAME_PAGES)("%s carries the brand siteName", async (_route, load) => {
    const resolved = await load();
    expect(resolved.openGraph, "page restates openGraph").toBeTruthy();
    expect(
      (resolved.openGraph as { siteName?: string }).siteName,
    ).toBe(BRAND_NAME);
  });

  it("names PUBMAXX, never the old app name, in the share-card title", async () => {
    const privacy = (await import("@/app/privacy/page")).metadata;
    const privacyCardTitle = (privacy.openGraph as { title?: string }).title;
    expect(privacyCardTitle).toBe(appPageTitle("Privacy"));

    const social = await (await import("@/app/social/page")).generateMetadata({ searchParams: Promise.resolve({}) });
    const socialCardTitle = (social.openGraph as { title?: string }).title ?? "";
    expect(socialCardTitle).toContain(BRAND_NAME);
    expect(socialCardTitle).not.toContain(APP_NAME);
  });
});

const PRODUCT_UI_BRAND_RENDERERS: ReadonlyArray<[string, () => string]> = [
  [
    "login header",
    () =>
      renderToStaticMarkup(
        createElement(PageHead, {
          title: "Sign in or create your account",
          lead: "Use your email, or pick a handle after the link lands.",
        }),
      ),
  ],
  [
    "analytics prompt",
    () =>
      renderToStaticMarkup(
        createElement(AnalyticsConsentPromptContent, { onDecision: () => undefined }),
      ),
  ],
  [
    "pint passport seal",
    () =>
      renderToStaticMarkup(
        createElement(PintPassport, {
          handle: "alice",
          displayName: "Alice Fennimore",
          data: buildPassport([]),
        }),
      ),
  ],
];

describe("product chrome names the brand, never the app", () => {
  it.each(PRODUCT_UI_BRAND_RENDERERS)("%s", (_surface, render) => {
    const markup = render();
    expect(markup).toContain(BRAND_NAME);
    expect(markup).not.toContain(APP_NAME);
  });
});
