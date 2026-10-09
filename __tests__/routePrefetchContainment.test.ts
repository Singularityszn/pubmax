import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type Link from "next/link";

import { describe, expect, it, vi } from "vitest";

const { renderedLinks } = vi.hoisted(() => ({
  renderedLinks: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {} }),
}));
vi.mock("next/link", () => ({
  default: ({ prefetch, ...props }: ComponentProps<typeof Link>) => {
    renderedLinks({ prefetch, ...props });
    return createElement("a", props);
  },
}));

import NowSegment from "@/components/nav/NowSegment";

const entrySurfaces = [
  "components/nav/SiteNav.tsx",
  "components/landing/LandingPage.tsx",
  "components/landing/LandingHero.tsx",
  "app/today/TodayClient.tsx",
  "app/tonight/TonightClient.tsx",
  "app/out/OutClient.tsx",
];

describe("entry-route prefetch containment", () => {
  it.each(["day", "tonight"] as const)(
    "disables automatic prefetch on the rendered %s segment links",
    (current) => {
      renderedLinks.mockClear();
      const html = renderToStaticMarkup(createElement(NowSegment, { current }));

      expect(renderedLinks.mock.calls.map(([props]) => ({
        href: props.href,
        prefetch: props.prefetch,
        current: props["aria-current"],
      }))).toEqual([
        { href: "/today", prefetch: false, current: current === "day" ? "page" : undefined },
        { href: "/tonight", prefetch: false, current: current === "tonight" ? "page" : undefined },
      ]);
      expect(html).toContain('href="/today"');
      expect(html).toContain('href="/tonight"');
    },
  );

  it.each(entrySurfaces)("keeps automatic route prefetch off %s", (path) => {
    const source = readFileSync(join(process.cwd(), path), "utf8");
    const openingTags = source.match(/<Link\b[\s\S]*?>/g) ?? [];

    expect(openingTags.length).toBeGreaterThan(0);
    for (const tag of openingTags) expect(tag).toContain("prefetch={false}");
  });
});
