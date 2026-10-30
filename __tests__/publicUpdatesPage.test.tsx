// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import UpdatesPage, { metadata } from "@/app/updates/page";

describe("the public updates page", () => {
  it("gives a signed-out reader dated changes and a way back to the map", () => {
    document.body.innerHTML = renderToStaticMarkup(createElement(UpdatesPage));

    expect(document.querySelector("main h1")?.textContent).toBe("What's changed");
    expect(document.querySelector("time")?.dateTime).toBe("2026-10-30");
    expect(document.querySelector("time")?.textContent).toBe("30 October 2026");
    expect(document.querySelector("article h2")?.textContent).toBe("Gardens in the sun, a pint compass and offline crawls");
    // Newest first, through the notes up to 30 Oct.
    expect(Array.from(document.querySelectorAll("time"), (time) => time.dateTime))
      .toEqual(["2026-10-30", "2026-10-28", "2026-10-27", "2026-10-26", "2026-10-25", "2026-10-22", "2026-10-19"]);
    expect(document.querySelectorAll("article li")).toHaveLength(28);
    expect(document.querySelector<HTMLAnchorElement>('main a[href="/map"]')?.textContent).toBe("Open the map");
    expect(document.querySelector("form, input")).toBeNull();
  });

  it("gives shared links their own canonical address and plain description", () => {
    expect(metadata.alternates?.canonical).toBe("/updates");
    expect(metadata.title).toBe("Updates");
    expect(metadata.description).toBe("The latest changes now live on PUBMAXX, newest first.");
  });

  it("shows an appended newer release before older notes", async () => {
    vi.resetModules();
    vi.doMock("@/lib/publicUpdates", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/publicUpdates")>();
      return {
        PUBLIC_UPDATES: [
          ...actual.PUBLIC_UPDATES,
          { id: "appended-release", date: "2026-10-31", title: "A newer release", changes: ["A verified change."] },
        ],
      };
    });
    try {
      const { default: AppendedUpdatesPage } = await import("@/app/updates/page");
      document.body.innerHTML = renderToStaticMarkup(createElement(AppendedUpdatesPage));

      expect(Array.from(document.querySelectorAll("time"), (time) => time.dateTime))
        .toEqual(["2026-10-31", "2026-10-30", "2026-10-28", "2026-10-27", "2026-10-26", "2026-10-25", "2026-10-22", "2026-10-19"]);
      expect(document.querySelector("article h2")?.textContent).toBe("A newer release");
    } finally {
      vi.doUnmock("@/lib/publicUpdates");
      vi.resetModules();
    }
  });
});
