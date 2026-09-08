// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NearbyStoryPub } from "@/lib/landmarkVenueProximity";
import { landmarkById } from "@/lib/landmarks";
import type { Venue } from "@/lib/venues";

vi.mock("@/components/LandmarkHeroPhoto", () => ({ default: () => null }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => createElement("span", null, children) }));
import LandmarkStoryBody from "@/components/map/LandmarkStoryBody";

let host: HTMLDivElement;
let root: Root;
const open = vi.fn();
const crawl = vi.fn();
const ask = vi.fn();
const row = (id: string): NearbyStoryPub => ({ venue: { id, name: id } as Venue, km: 0.1 });
function render(nearby: NearbyStoryPub[], landmarkId = "covent-garden") {
  act(() => root.render(createElement(LandmarkStoryBody, {
    landmark: landmarkById(landmarkId)!, areaLine: null, nearby,
    onOpenVenue: open, onStartCrawl: crawl, onAskPubmaxxer: ask,
  })));
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("keeps a displayed pub button and its destination when late shards re-rank nearby pubs", () => {
  render([row("Lamb and Flag"), row("White Swan")]);
  const button = host.querySelector<HTMLButtonElement>(".landmarkStoryPubs button")!;
  button.focus();
  act(() => button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  render([row("The White Lion"), row("The Old Bell")]);
  expect(button.isConnected).toBe(true);
  expect(document.activeElement).toBe(button);
  act(() => button.click());
  expect(open).toHaveBeenCalledExactlyOnceWith("Lamb and Flag");
  const actions = host.querySelectorAll<HTMLButtonElement>(".landmarkStoryActions button");
  act(() => actions[0].click());
  act(() => actions[1].click());
  expect(crawl).toHaveBeenCalledExactlyOnceWith(["Lamb and Flag", "White Swan"]);
  expect(ask).toHaveBeenCalledExactlyOnceWith("Lamb and Flag");
});

it("accepts the first available rows and replaces them for a different landmark", () => {
  render([]);
  expect(host.querySelector(".landmarkStoryPubs")).toBeNull();
  render([row("The White Lion")]);
  expect(host.querySelector(".landmarkStoryPubName")?.textContent).toBe("The White Lion");
  render([row("The Anchor")], "tower-bridge");
  expect(host.querySelector(".landmarkStoryPubName")?.textContent).toBe("The Anchor");
});
