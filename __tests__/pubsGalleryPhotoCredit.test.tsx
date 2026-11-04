// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import axe from "axe-core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/pubs",
}));

import PubsGallery from "@/components/pubs/PubsGallery";
import type { ScrapedPub } from "@/lib/scrapedPubs";

const PUB: ScrapedPub = {
  id: "venue-leather-bottle", name: "Leather Bottle", borough: "Wandsworth",
  source: "youngs.co.uk", sourceLabel: "Young's", cheapestPrice: null, zone: 3,
  photoUrl: "https://pub.example.com/photo.jpg",
};

let host: HTMLDivElement;
let root: Root;
let style: HTMLStyleElement;
let network: ReturnType<typeof vi.fn<typeof fetch>>;

beforeAll(async () => {
  // Load the real lazy component before React act. This is not browser lazy-
  // network evidence and does not replace the shared media/sign components.
  await import("@/components/wild/PubSign");
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("reduce"), media: query })));
  network = vi.fn<typeof fetch>(async () => { throw new Error("Unexpected network read"); });
  vi.stubGlobal("fetch", network);
  style = document.createElement("style");
  style.textContent = readFileSync(join(process.cwd(), "components/pubs/pubsGallery.css"), "utf8");
  document.head.append(style);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  axe.teardown();
  host.remove();
  style.remove();
  vi.unstubAllGlobals();
});

async function render(pub: ScrapedPub) {
  await act(async () => {
    root.render(createElement(PubsGallery, {
      pubs: [pub], matchingPubs: 1, filter: "all", zone: "all",
      counts: { all: 1, "youngs.co.uk": 1, "nicholsonspubs.co.uk": 0, "greene-king.co.uk": 0, other: 0 },
      zonesPresent: [3], page: 1, totalPages: 1, complete: true,
    }));
    await vi.dynamicImportSettled();
  });
}

function expectNamedSign() {
  const sign = host.querySelector<SVGElement>('svg[role="img"]');
  expect(sign).not.toBeNull();
  axe.setup(document);
  expect(axe.commons.text.accessibleText(sign!)).toBe("Illustrated sign for Leather Bottle, Wandsworth");
  axe.teardown();
  expect(host.querySelector(".pubsCardArt img")).toBeNull();
  // A native figure names its content through its own figcaption. A hidden
  // photo credit must not retain that semantic relationship around a sign.
  // Chromium's actual accessibility tree still requires browser acceptance.
  const photoCaptionedFigures = [...host.querySelectorAll("figure")].filter((figure) =>
    [...figure.children].some((child) => child.tagName === "FIGCAPTION" && child.textContent === "Photo: pub website"),
  );
  expect(photoCaptionedFigures).toHaveLength(0);
}

describe("chain catalogue photo credit semantics", () => {
  it("keeps the failed photo credit out of the sign's figure and restores credit for a new photo", async () => {
    await render(PUB);
    const photo = host.querySelector<HTMLImageElement>(".pubsCardArt img");
    const credit = host.querySelector<HTMLElement>(".pubsCardCredit");
    expect(photo).not.toBeNull();
    expect(credit?.textContent).toBe("Photo: pub website");
    expect(getComputedStyle(credit!).display).not.toBe("none");

    await act(async () => {
      photo!.dispatchEvent(new Event("error"));
      await vi.dynamicImportSettled();
    });
    expect(getComputedStyle(credit!).display).toBe("none");
    expectNamedSign();

    await render({ ...PUB, photoUrl: "https://pub.example.com/replacement.jpg" });
    expect(host.querySelector(".pubsCardArt img")).not.toBeNull();
    expect(host.querySelector("svg.pubSign__art")).toBeNull();
    expect(getComputedStyle(host.querySelector<HTMLElement>(".pubsCardCredit")!).display).not.toBe("none");
    expect(host.querySelector(".pubsCardCredit")?.textContent).toBe("Photo: pub website");
    expect(network).not.toHaveBeenCalled();
  });

  it("preserves a named sign without any photo credit when no photo URL exists", async () => {
    await render({ ...PUB, photoUrl: undefined });
    expectNamedSign();
    expect(host.querySelector(".pubsCardCredit")).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });
});
