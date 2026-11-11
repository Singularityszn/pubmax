// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import UpdatesPage, { metadata } from "@/app/updates/page";
import { PUBLIC_UPDATES } from "@/lib/publicUpdates";

const datesNewestFirst = PUBLIC_UPDATES.map((update) => update.date).toSorted().toReversed();
const newest = PUBLIC_UPDATES.find((update) => update.date === datesNewestFirst[0])!;
const dayAfterNewest = new Date(Date.parse(`${newest.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const newestLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
}).format(new Date(`${newest.date}T00:00:00Z`));

describe("the public updates page", () => {
  it("gives a signed-out reader dated changes and a way back to the map", () => {
    document.body.innerHTML = renderToStaticMarkup(createElement(UpdatesPage));

    expect(document.querySelector("main h1")?.textContent).toBe("What's changed");
    expect(document.querySelector("time")?.dateTime).toBe(newest.date);
    expect(document.querySelector("time")?.textContent).toBe(newestLabel);
    expect(document.querySelector("article h2")?.textContent).toBe(newest.title);
    expect(Array.from(document.querySelectorAll("time"), (time) => time.dateTime)).toEqual(datesNewestFirst);
    expect(document.querySelectorAll("article li"))
      .toHaveLength(PUBLIC_UPDATES.reduce((count, update) => count + update.changes.length, 0));
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
          { id: "appended-release", date: dayAfterNewest, title: "A newer release", changes: ["A verified change."] },
        ],
      };
    });
    try {
      const { default: AppendedUpdatesPage } = await import("@/app/updates/page");
      document.body.innerHTML = renderToStaticMarkup(createElement(AppendedUpdatesPage));

      expect(Array.from(document.querySelectorAll("time"), (time) => time.dateTime))
        .toEqual([dayAfterNewest, ...datesNewestFirst]);
      expect(document.querySelector("article h2")?.textContent).toBe("A newer release");
    } finally {
      vi.doUnmock("@/lib/publicUpdates");
      vi.resetModules();
    }
  });
});
