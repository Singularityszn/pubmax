// @vitest-environment jsdom

// THE OWNER CONTROLS HYDRATE TO WHAT THE SERVER SENT, AND A BLOCKED STORE IS A
// STRANGER, NEVER A CRASH.
//
// CrawlStoryOwnerControls renders inside the server component
// app/crawls/[slug]/CrawlStoryPoster.tsx. The server cannot read the viewer's
// device handle, so it sends nothing; the client's FIRST render must send
// nothing too, and only then read the handle. The same rule covers the device
// handle the ratings client and the message thread read.

import { act, createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => Promise.resolve() }),
}));

import CrawlStoryOwnerControls from "@/components/crawl/CrawlStoryOwnerControls";
import { rememberHandle, storedHandle } from "@/components/ratings/ratingsClient";

const props = { slug: "soho-saunter", authorHandle: "moss" };

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host.remove();
  vi.restoreAllMocks();
});

function blockStorage() {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
}

describe("CrawlStoryOwnerControls hydration", () => {
  it("hydrates the author's device without a mismatch, then shows the controls", async () => {
    // The server has no window, so it renders the stranger's view.
    const serverHtml = renderToString(createElement(CrawlStoryOwnerControls, props));
    expect(serverHtml).toBe("");

    window.localStorage.setItem("pubmax_handle", "Moss");
    host.innerHTML = serverHtml;
    const recoverable = vi.fn();
    await act(async () => {
      root = hydrateRoot(host, createElement(CrawlStoryOwnerControls, props), {
        onRecoverableError: recoverable,
      });
    });

    expect(recoverable).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Delete crawl");
  });

  it("renders nothing, and does not throw, when storage is blocked", async () => {
    blockStorage();
    const recoverable = vi.fn();
    await act(async () => {
      root = hydrateRoot(host, createElement(CrawlStoryOwnerControls, props), {
        onRecoverableError: recoverable,
      });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(host.textContent).toBe("");
  });
});

describe("ratings client device handle", () => {
  it("reads and remembers nothing, without throwing, when storage is blocked", () => {
    blockStorage();
    expect(storedHandle()).toBe("");
    expect(() => rememberHandle("moss")).not.toThrow();
  });
});
