// @vitest-environment jsdom

// "COPY LINK" ON A PINT DROP WORKS HOWEVER THE READER ARRIVED (review finding
// PAGE-5). The permalink wired its button with an inline <script>, and React
// never runs a script it renders on a client-side navigation, so a reader who
// reached /p/{id} through a next/link (bar tab, feed card) got a dead button.
// The button is now the shared client copy button.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CrawlStoryCopyButton from "@/components/crawl/CrawlStoryCopyButton";

const PAGE = readFileSync(join(process.cwd(), "app/p/[id]/page.tsx"), "utf8");

let host: HTMLDivElement;
let root: Root;
const writeText = vi.fn();

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  writeText.mockReset();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  window.history.replaceState(null, "", "/p/drop-123");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.history.replaceState(null, "", "/");
});

describe("the Pint Drop permalink copy link", () => {
  it("is a client component on the page, never an inline script", () => {
    expect(PAGE).toContain('<CrawlStoryCopyButton className="permalink__primary" />');
    expect(PAGE).not.toContain("dangerouslySetInnerHTML");
    expect(PAGE).not.toContain("<script");
    expect(PAGE).not.toContain("data-copy-link");
  });

  it("copies the permalink and says so", async () => {
    writeText.mockResolvedValue(undefined);
    await act(async () => root.render(createElement(CrawlStoryCopyButton, { className: "permalink__primary" })));
    const button = host.querySelector<HTMLButtonElement>("button.permalink__primary")!;
    expect(button.textContent).toBe("Copy link");
    await act(async () => button.click());
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/drop-123`);
    expect(button.textContent).toBe("Copied");
  });

  it("says when the copy failed", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    await act(async () => root.render(createElement(CrawlStoryCopyButton, { className: "permalink__primary" })));
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Could not copy link. Try again.");
  });
});
