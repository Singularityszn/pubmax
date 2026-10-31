// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCrawlOfflinePack } from "@/components/plan/useCrawlOfflinePack";
import { CRAWL_OFFLINE_PACK_MESSAGE } from "@/lib/crawlOfflinePack";

// The service worker container as the crawl screen meets it: on a first visit
// no worker controls the page yet, and control arrives later as a
// controllerchange event, without the stops changing.
class FakeContainer extends EventTarget {
  controller: { postMessage: ReturnType<typeof vi.fn> } | null = null;
}

let container: FakeContainer;
let root: Root | null = null;
let host: HTMLDivElement;

function Crawl({ ids }: { ids: string[] }) {
  useCrawlOfflinePack(ids);
  return null;
}

function render(ids: string[]) {
  act(() => {
    root ??= createRoot(host);
    root.render(createElement(Crawl, { ids }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = new FakeContainer();
  Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  Reflect.deleteProperty(navigator, "connection");
});

describe("useCrawlOfflinePack", () => {
  it("sends the pack straight away when a worker already controls the page", () => {
    const postMessage = vi.fn();
    container.controller = { postMessage };
    render(["venue-a", "venue-b"]);
    expect(postMessage).toHaveBeenCalledWith({
      type: CRAWL_OFFLINE_PACK_MESSAGE,
      venueIds: ["venue-a", "venue-b"],
    });
  });

  it("sends the pack once a worker takes control after the crawl opened", () => {
    render(["venue-a"]);
    const postMessage = vi.fn();
    container.controller = { postMessage };
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: CRAWL_OFFLINE_PACK_MESSAGE, venueIds: ["venue-a"] });
    // A later controller change (a worker update) asks again, for the new worker.
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it("stops listening once the crawl screen closes", () => {
    render(["venue-a"]);
    act(() => root?.unmount());
    root = null;
    const postMessage = vi.fn();
    container.controller = { postMessage };
    container.dispatchEvent(new Event("controllerchange"));
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("still sends nothing with data saver on, even after control arrives", () => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
    render(["venue-a"]);
    const postMessage = vi.fn();
    container.controller = { postMessage };
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });
    expect(postMessage).not.toHaveBeenCalled();
  });
});
