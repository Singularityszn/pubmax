// @vitest-environment jsdom

import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VenueImage from "@/components/media/VenueImage";
import PubsGallery from "@/components/pubs/PubsGallery";
import VenueInspectorHeader from "@/components/map/inspector/VenueInspectorHeader";
import { BASE_TABS, type TabKey } from "@/lib/venueInspectorTabs";
import type { Venue } from "@/lib/venues";

vi.mock("next/navigation", () => ({
  usePathname: () => "/pubs",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; prefetch?: boolean }) => {
    const domProps = { ...props };
    delete domProps.prefetch;
    return createElement("a", { href, ...domProps }, children);
  },
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("reduce") }));
  window.localStorage.clear();
  window.history.replaceState(null, "", "/pubs");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(view: ReactElement) {
  await act(async () => {
    root.render(view);
  });
}

async function sign() {
  await vi.waitFor(async () => {
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector("svg[aria-label='Illustrated sign for The Nellie Dean, Soho']")).not.toBeNull();
  });
}

describe("the normal venue image fallback", () => {
  it("keeps a named placeholder while the sign code loads", () => {
    const html = renderToStaticMarkup(<VenueImage sources={[]} alt="" venueName="The Nellie Dean" venueArea="Soho" />);
    expect(html).toContain("No photo available for The Nellie Dean");
    expect(html).toContain("venueImage--named");
    expect(html).toContain("No photo yet");
  });

  it("shows an illustrated sign from the explicit pub name and area with wild mode off", async () => {
    await render(createElement(VenueImage, {
      sources: [],
      alt: "",
      venueName: "The Nellie Dean",
      venueArea: "Soho",
    }));
    await sign();
    expect(host.textContent).toContain("Soho");
    expect(host.querySelector(".venueImage__provenance")).toBeNull();
    expect(host.textContent).not.toMatch(/£|Since|Photo:/);
  });

  it("keeps the chain photograph, tries the community photograph after failure, then draws the sign", async () => {
    await render(<VenueImage
      sources={[
        { url: "https://pub.example/photo.jpg", provenance: "chain" },
        { url: "https://storage.example/community.jpg", provenance: "community" },
      ]}
      alt="The Nellie Dean, outside or in" venueName="The Nellie Dean" venueArea="Soho"
    />);
    expect(host.querySelector("img")?.getAttribute("src")).toContain("photo.jpg");
    expect(host.textContent).toContain("Photo: pub website");
    expect(host.querySelector(".pubSign")).toBeNull();
    await act(async () => { host.querySelector("img")!.dispatchEvent(new Event("error")); });
    expect(host.querySelector("img")?.getAttribute("src")).toBe("https://storage.example/community.jpg");
    expect(host.textContent).toContain("Photo: community");
    expect(host.querySelector(".pubSign")).toBeNull();
    await act(async () => { host.querySelector("img")!.dispatchEvent(new Event("error")); });
    await sign();
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).not.toContain("Photo:");
  });

  it("tries a replacement photo after earlier candidates failed", async () => {
    const common = { alt: "", venueName: "The Nellie Dean", venueArea: "Soho" };
    await render(<VenueImage {...common} sources={[{ url: "https://pub.example/old.jpg", provenance: "chain" }]} />);
    await act(async () => { host.querySelector("img")!.dispatchEvent(new Event("error")); });
    await sign();
    await render(<VenueImage {...common} sources={[{ url: "https://pub.example/new.jpg", provenance: "chain" }]} />);
    expect(host.querySelector("img")?.getAttribute("src")).toContain("new.jpg");
    expect(host.querySelector(".pubSign")).toBeNull();
  });

  it("does not invent a pub sign for unnamed uploaded media", async () => {
    await render(<VenueImage sources={[]} alt="A pint shared by Sam" />);
    expect(host.querySelector(".pubSign")).toBeNull();
    expect(host.textContent).toContain("No photo yet");
  });

  it("gives the venue sheet header the same pub sign", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ rows: [] }), { status: 200 })));
    const venue = {
      id: "nellie-dean", name: "The Nellie Dean", primaryBorough: "Westminster", locality: "Soho",
      kind: "pub", latitude: 51.51, longitude: -0.13, imageUrl: "",
    } as Venue;
    await render(<VenueInspectorHeader
      venue={venue} TABS={BASE_TABS} tab="overview"
      tabRefs={{ current: {} as Record<TabKey, HTMLButtonElement | null> }}
      selectTab={() => {}} onTabKeyDown={() => {}}
    />);
    await sign();
    expect(host.querySelector(".venueImage--header.venueImage--sign")).not.toBeNull();
    expect(host.querySelectorAll("[role='tab']")).toHaveLength(5);
  });

  it("gives a photo-less gallery card the same named sign without a photo credit", async () => {
    await render(<PubsGallery
      pubs={[{
        id: "nellie-dean", name: "The Nellie Dean", borough: "Soho", source: "other",
        sourceLabel: "Other", cheapestPrice: null, zone: null,
      }]}
      matchingPubs={1} filter="all" zone="all"
      counts={{ all: 1, other: 1, "greene-king.co.uk": 0, "nicholsonspubs.co.uk": 0, "youngs.co.uk": 0 }}
      zonesPresent={[]} page={1} totalPages={1} complete
    />);
    await sign();
    expect(host.querySelector(".pubsCardCredit")).toBeNull();
    expect(host.querySelector("a.pubsMapLink")?.getAttribute("href")).toContain("nellie-dean");
  });
});
