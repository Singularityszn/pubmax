// @vitest-environment jsdom

import { act, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import Link from "next/link";
import { expect, it, vi } from "vitest";

// Reject the real dynamic import transport, rather than replacing either view.
const imports = vi.hoisted(() => ({
  line: { requested: false, reject: null as null | ((reason: Error) => void) },
  receipt: { requested: false, reject: null as null | ((reason: Error) => void) },
}));
// Next aliases this entry to App Router dynamic imports in the real build.
vi.mock("next/dynamic", async () => ({ default: (await import("next/dist/shared/lib/app-dynamic")).default }));
vi.mock("@/components/wild/PintLine", async () => {
  imports.line.requested = true;
  await new Promise((_, reject) => { imports.line.reject = reject; });
  throw new Error("unreachable import resolution");
});
vi.mock("@/components/wild/CrawlReceipt", async () => {
  imports.receipt.requested = true;
  await new Promise((_, reject) => { imports.receipt.reject = reject; });
  throw new Error("unreachable import resolution");
});

import CrawlReceiptGate from "@/components/wild/CrawlReceiptGate";
import PintLineGate from "@/components/wild/PintLineGate";
import type { WildCrawl } from "@/lib/wildPintLineCrawl";

class RouteError extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p>The whole route failed.</p> : this.props.children; }
}

it("keeps the mounted stops and map action after either optional import fails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host, { onCaughtError: () => {} });
  const crawl: WildCrawl = {
    name: "Victorian Soho", plannedStops: 2, totalKm: 0.2, totalMinutes: 3,
    stops: ["The Nellie Dean", "The Crown & Two Chairmen"].map((name, index) => ({
      position: index + 1, name, point: null, pint: null, legMinutes: null,
    })),
  };
  try {
    await act(async () => root.render(<RouteError><main>
      <Link prefetch={false} href="/map?mode=build&pubs=venue-1ufn31x,venue-1t8siin">Plan this crawl</Link>
      <PintLineGate crawl={crawl} />
      <ul aria-label="Victorian Soho stops"><li>The Nellie Dean</li><li>The Crown &amp; Two Chairmen</li></ul>
      <CrawlReceiptGate crawl={crawl} />
    </main></RouteError>));
    await vi.waitFor(() => {
      expect(imports.line.requested).toBe(true);
      expect(imports.receipt.requested).toBe(true);
    });
    const mapAction = host.querySelector("a");
    const stops = host.querySelector("ul");
    expect(mapAction?.textContent).toBe("Plan this crawl");
    expect(stops?.children).toHaveLength(2);

    await act(async () => { imports.line.reject!(new Error("Pint Line chunk unavailable")); });
    await vi.waitFor(async () => {
      await act(async () => { await Promise.resolve(); });
      expect(host.textContent).not.toContain("Loading the route diagram.");
    });
    expect(host.querySelector("a")).toBe(mapAction);
    expect(host.querySelector("ul")).toBe(stops);
    expect(host.textContent).toContain("The route diagram could not load.");
    expect(host.textContent).not.toContain("The whole route failed.");

    await act(async () => { imports.receipt.reject!(new Error("Receipt chunk unavailable")); });
    await vi.waitFor(async () => {
      await act(async () => { await Promise.resolve(); });
      expect(host.textContent).not.toContain("Loading the selected pints subtotal.");
    });
    expect(host.querySelector("a")).toBe(mapAction);
    expect(host.querySelector("ul")).toBe(stops);
    expect(host.textContent).toContain("The selected pints subtotal could not load.");
    expect(host.textContent).toContain("The Nellie Dean");
    expect(host.textContent).not.toContain("The whole route failed.");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
