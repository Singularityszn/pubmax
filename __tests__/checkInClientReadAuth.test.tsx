// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => "verified-reader-token" }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({
  accountRevision: 0,
  user: { id: "account-a" },
  contributionAuth: { userId: "account-a", accessToken: "verified-reader-token" },
  identityResolved: true,
  identityUnavailable: false,
  invalidateContributionAuth: vi.fn(),
}) }));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => "alice" }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => ({ signedIn: true, signedOut: false }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/lib/nativeHaptics", () => ({ haptic: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({ useSocialFriendsLaunch: () => true }));

import OutTonightBoard from "@/components/profile/OutTonightBoard";
import OutTonightCrewLine from "@/components/profile/OutTonightCrewLine";
import OutTonightToggle from "@/components/profile/OutTonightToggle";
import WeAreOutClient from "@/app/we-are-out/WeAreOutClient";
import { publishAuthActionState } from "@/lib/authedFetch";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  // GET /api/check-ins permits private rows only for a bearer-authenticated
  // reader. An anonymous 200 is intentionally empty, even with ?viewer=.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const authorised = new Headers(init?.headers).get("authorization") === "Bearer verified-reader-token";
    const checkIn = {
      handle: "alice",
      areaSlug: "piccadilly-soho",
      note: "Meeting the crew",
      createdAt: new Date().toISOString(),
    };
    return String(input) === "/api/check-ins?mine=1"
      ? Response.json({ mine: authorised ? checkIn : null })
      : Response.json({ checkIns: authorised ? [checkIn] : [] });
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

  it("does not offer Turn on when owned status is unknown", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ retryable: true }, { status: 503 }));
    await act(async () => root.render(createElement(OutTonightToggle, { handle: "alice" })));
    expect(container.querySelector(".beaconButton")).toBeNull();
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


describe.each(["toggle", "composer"] as const)("%s age continuation", (surface) => {
  it.each(["adult_check_required", "adult_check_failed"])("uses the server age answer %s", async (status) => {
    let asserted = false;
    const writes: unknown[] = [];
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/identity/adult-assertion") {
        asserted = true;
        return Response.json({ ok: true });
      }
      if (init?.method !== "POST") return Response.json({ mine: null, checkIns: [] });
      writes.push(JSON.parse(String(init.body)));
      return asserted
        ? Response.json({ checkIn: { areaSlug: "piccadilly-soho" } }, { status: 201 })
        : Response.json({ code: "ADULT_REQUIRED", status }, { status: 403 });
    });
    vi.stubGlobal("fetch", request);
    await act(async () => root.render(surface === "toggle"
      ? createElement(OutTonightToggle, { handle: "alice" })
      : createElement(WeAreOutClient)));
    await act(async () => {
      const area = container.querySelector("select")!;
      area.value = "piccadilly-soho";
      area.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(surface === "toggle" ? ".beaconButton" : ".weAreOutSubmit")!.click();
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const confirm = Array.from(dialog!.querySelectorAll("button")).find((button) => button.textContent?.includes("18"));
    if (status === "adult_check_failed") {
      expect(confirm).toBeUndefined();
      expect(writes).toHaveLength(1);
      expect(asserted).toBe(false);
      return;
    }
    expect(confirm).toBeDefined();
    await act(async () => { confirm!.click(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(surface === "toggle" ? ".beaconOnLine" : ".weAreOutDone")).not.toBeNull();
    const expected = surface === "toggle"
      ? { handle: "alice", areaSlug: "piccadilly-soho" }
      : { handle: "alice", areaSlug: "piccadilly-soho", note: "", visibility: "friends" };
    expect(writes).toEqual([expected, expected]);
    expect(asserted).toBe(true);
  });
});
