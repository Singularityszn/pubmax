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
    expect(document.querySelector("time")?.dateTime).toBe("2026-10-19");
    expect(document.querySelector("time")?.textContent).toBe("19 October 2026");
    expect(document.querySelector("article h2")?.textContent).toBe("More London menu prices, steadier pub pages");
    expect(document.querySelectorAll("article li")).toHaveLength(2);
    expect(document.querySelector<HTMLAnchorElement>('main a[href="/map"]')?.textContent).toBe("Open the map");
    expect(document.querySelector("form, input")).toBeNull();
  });

  it("gives shared links their own canonical address and plain description", () => {
    expect(metadata.alternates?.canonical).toBe("/updates");
    expect(metadata.title).toBe("Updates");
    expect(metadata.description).toBe("The latest changes to PUBMAXX, with the day each one went live.");
  });
});
