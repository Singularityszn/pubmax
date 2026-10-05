// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => createElement("img", props),
}));
vi.mock("@/components/drink-wall/DrinkWallComposer", () => ({ default: () => null }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "user-alice" }, handle: "alice", configured: true }),
}));

type Pending = { url: URL; init?: RequestInit; resolve: (response: Response) => void };
const net = vi.hoisted(() => ({ pending: [] as Pending[] }));

function send(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise((resolve) => {
    net.pending.push({ url: new URL(String(input), "http://localhost"), init, resolve });
  });
}

vi.mock("@/lib/venuesSlim", () => ({
  loadSlimVenues: async () => [
    { id: "venue-far", name: "Far", lat: 51.6, lng: -0.3, cheapestPrice: null, borough: "Barnet" },
    { id: "venue-near", name: "Near", lat: 51.5081, lng: -0.0981, cheapestPrice: null, borough: "Southwark" },
  ],
}));

vi.mock("@/lib/authedFetch", () => ({
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => send(input, init),
  authedActionFetch: (input: RequestInfo | URL, init?: RequestInit) => send(input, init),
}));

import DrinkWall from "@/components/drink-wall/DrinkWall";
import type { DrinkWallPhotoDTO } from "@/lib/drinkWall";
import { defined } from "@/__tests__/helpers/defined";

function photo(overrides: Partial<DrinkWallPhotoDTO> = {}): DrinkWallPhotoDTO {
  return {
    id: "photo-1",
    venueId: null,
    venueName: null,
    wallCategory: "london",
    placeLabel: null,
    url: "/api/drink-wall-photo/photo-1",
    drinkCategory: null,
    caption: "",
    width: 1080,
    height: 1350,
    createdAt: "2026-09-26T18:00:00.000Z",
    author: { handle: "bob" },
    ownedByViewer: false,
    ...overrides,
  };
}

function page(photos: DrinkWallPhotoDTO[]): Response {
  return new Response(JSON.stringify({ status: "ready", photos, nextCursor: null }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let host: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function take(match: (request: Pending) => boolean): Pending {
  const index = net.pending.findIndex(match);
  if (index < 0) throw new Error("no matching request is pending");
  return defined(net.pending.splice(index, 1)[0]);
}

function wallRead(category: string | null): (request: Pending) => boolean {
  return (request) =>
    request.url.pathname === "/api/drink-wall" && request.url.searchParams.get("category") === category;
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!found) throw new Error(`no ${label} button`);
  return found as HTMLButtonElement;
}

beforeEach(async () => {
  net.pending = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(DrinkWall));
  });
  await flush();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("the Drink Wall before its first read lands", () => {
  it("says it is loading, never that the wall is empty", () => {
    const markup = renderToStaticMarkup(createElement(DrinkWall));
    expect(markup).toContain("Loading the wall");
    expect(markup).not.toContain("No photos on the wall yet");
  });
});

describe("a filter change on a slow connection", () => {
  it("keeps the newer filter's photos when the older read lands last", async () => {
    const first = take(wallRead(null));
    await act(async () => button("Pint").click());
    await flush();
    const second = take(wallRead("pint"));

    await act(async () => second.resolve(page([photo({ id: "pint-1", wallCategory: "pint", caption: "Stout" })])));
    await flush();
    await act(async () => first.resolve(page([photo({ id: "city-1", caption: "Skyline" })])));
    await flush();

    const captions = [...host.querySelectorAll(".drinkWallCaption")].map((node) => node.textContent);
    expect(captions).toEqual(["Stout"]);
  });
});

describe("Near me while the location is still coming", () => {
  it("drops the All London read that lands after the switch", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: () => {} },
    });
    try {
      const first = take(wallRead(null));
      await act(async () => button("Near me").click());
      await flush();
      await act(async () => first.resolve(page([photo({ id: "city-1", caption: "Skyline" })])));
      await flush();

      expect(host.querySelectorAll(".drinkWallTile")).toHaveLength(0);
      expect(host.querySelector(".drinkWallStatus")?.textContent).toBe("Loading the wall");
      expect(net.pending).toHaveLength(0);
    } finally {
      Reflect.deleteProperty(navigator, "geolocation");
    }
  });
});

describe("Near me with the location granted", () => {
  it("reads the wall for the pubs nearest the reader, nearest first", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: 51.508, longitude: -0.098 } } as GeolocationPosition),
      },
    });
    try {
      take(wallRead(null)).resolve(page([]));
      await flush();
      await act(async () => button("Near me").click());
      await flush();

      const near = take((request) => request.url.searchParams.get("scope") === "near");
      expect(near.url.searchParams.get("nearVenueIds")).toBe("venue-near,venue-far");
    } finally {
      Reflect.deleteProperty(navigator, "geolocation");
    }
  });
});

describe("a tile", () => {
  it("shows the caption and the pub name, or the author's place when no pub is linked", async () => {
    take(wallRead(null)).resolve(
      page([
        photo({ id: "a", caption: "Evening", venueId: "venue-abc", venueName: "The Anchor", placeLabel: "Bankside" }),
        photo({ id: "b", placeLabel: "St Paul's from the river" }),
      ]),
    );
    await flush();
    const places = [...host.querySelectorAll(".drinkWallPlace")].map((node) => node.textContent);
    expect(places).toEqual(["The Anchor", "St Paul's from the river"]);
    expect(host.querySelector(".drinkWallCaption")?.textContent).toBe("Evening");
  });

  it("lets its author remove it through the venue-photos delete action", async () => {
    take(wallRead(null)).resolve(
      page([photo({ id: "mine", ownedByViewer: true }), photo({ id: "theirs" })]),
    );
    await flush();
    expect(host.querySelectorAll(".drinkWallRemove")).toHaveLength(1);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    await act(async () => button("Remove").click());
    expect(confirm).toHaveBeenCalledWith("Delete this photo for good? It comes off the Drink Wall.");
    const deletion = take((request) => request.url.pathname === "/api/venue-photos");
    expect(JSON.parse(String(deletion.init?.body))).toEqual({ action: "delete", id: "mine" });
    await act(async () =>
      deletion.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    await flush();

    expect(host.querySelectorAll(".drinkWallTile")).toHaveLength(1);
    expect(host.querySelector(".drinkWallRemove")).toBeNull();
  });

  it("warns its author that a pub-linked photo also leaves that pub's wall", async () => {
    take(wallRead(null)).resolve(
      page([photo({ id: "mine", venueId: "v-anchor", venueName: "The Anchor", ownedByViewer: true })]),
    );
    await flush();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await act(async () => button("Remove").click());

    expect(confirm).toHaveBeenCalledWith(
      "Delete this photo for good? It comes off the Drink Wall and its pub wall.",
    );
    expect(net.pending.some((request) => request.url.pathname === "/api/venue-photos")).toBe(false);
    expect(host.querySelectorAll(".drinkWallTile")).toHaveLength(1);
  });
});
