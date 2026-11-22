// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => "verified-reader-token" }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ accountRevision: 0 }) }));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({ useSocialFriendsLaunch: () => true }));

import OutTonightBoard from "@/components/profile/OutTonightBoard";
import OutTonightCrewLine from "@/components/profile/OutTonightCrewLine";
import OutTonightToggle from "@/components/profile/OutTonightToggle";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  // GET /api/check-ins permits private rows only for a bearer-authenticated
  // reader. An anonymous 200 is intentionally empty, even with ?viewer=.
  vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    const authorised = new Headers(init?.headers).get("authorization") === "Bearer verified-reader-token";
    return Response.json({ checkIns: authorised ? [{
      handle: "alice",
      areaSlug: "piccadilly-soho",
      note: "Meeting the crew",
      createdAt: new Date().toISOString(),
    }] : [] });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("private check-in client reads", () => {
  it("restores the signed-in owner's active mark instead of offering to turn it on again", async () => {
    await act(async () => root.render(createElement(OutTonightToggle, { handle: "alice" })));
    expect(container.querySelector(".beaconOnLine")?.textContent).toContain("You're out tonight");
    expect(container.textContent).not.toContain("Turn on out tonight");
  });

  it("shows the verified reader's mate board rather than a false empty state", async () => {
    await act(async () => root.render(createElement(OutTonightBoard, { viewerHandle: "ben" })));
    expect(container.querySelector('a[href="/u/alice"]')).not.toBeNull();
    expect(container.textContent).toContain("Meeting the crew");
  });

  it("shows a mate's current mark on their profile", async () => {
    await act(async () => root.render(createElement(OutTonightCrewLine, { ownerHandle: "alice", viewerHandle: "ben" })));
    expect(container.textContent).toContain("Piccadilly & Soho");
  });
});
