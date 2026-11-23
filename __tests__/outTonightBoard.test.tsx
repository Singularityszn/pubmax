// @vitest-environment jsdom

// The friends-only "who's out tonight" board on You (crew tonight slice 4).

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OutTonightBoard from "@/components/profile/OutTonightBoard";
import { SocialFriendsLaunchProvider } from "@/lib/useSocialFriendsLaunch";

let host: HTMLDivElement;
let root: Root;
let requested: string[];
let checkIns: unknown[];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  requested = [];
  checkIns = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return Response.json({ checkIns });
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function board(viewerHandle: string, launched = true): Promise<void> {
  await act(async () => {
    root.render(<SocialFriendsLaunchProvider value={launched}><OutTonightBoard viewerHandle={viewerHandle} /></SocialFriendsLaunchProvider>);
  });
  await act(async () => {});
}

describe("OutTonightBoard", () => {
  it("stays hidden and reads nothing without a viewer handle", async () => {
    await board("");
    expect(host.innerHTML).toBe("");
    expect(requested).toEqual([]);
  });

  it("stays hidden and reads nothing before the friends launch", async () => {
    await board("host_mate", false);
    expect(host.innerHTML).toBe("");
    expect(requested).toEqual([]);
  });

  it("asks only the viewer-scoped check-ins, never an area read", async () => {
    await board("@Host_Mate");
    expect(requested).toEqual(["/api/check-ins?viewer=host_mate"]);
  });

  it("links each mate who is out to their profile and says who can see it", async () => {
    checkIns = [
      { handle: "pal_one", areaSlug: "clapham", note: "Upstairs", createdAt: new Date().toISOString() },
      { handle: "", note: "no handle, no row" },
    ];
    await board("host_mate");
    const links = [...host.querySelectorAll<HTMLAnchorElement>(".beaconBoardList a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/u/pal_one"]);
    expect(links[0]?.textContent).toContain("@pal_one is out in Clapham");
    expect(host.textContent).toContain("Your lot tonight");
    expect(host.textContent).toContain("Mutual follows only.");
  });

  it("points a quiet night to Find your lot rather than a dead end", async () => {
    await board("host_mate");
    const findYourLot = host.querySelector<HTMLAnchorElement>('a[href="/social"]');
    expect(findYourLot?.textContent).toBe("Find your lot");
    expect(host.textContent).toContain("Mutual follows only.");
  });
});
