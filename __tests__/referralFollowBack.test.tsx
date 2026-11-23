// @vitest-environment jsdom

// WP7 invite follow-back: a session-scoped inviter handle and the You-page card.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ accountRevision: 1 }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));

import ReferralFollowBack from "@/components/social/ReferralFollowBack";
import {
  REFERRAL_FOLLOW_HANDLE_KEY,
  clearReferralFollowHandle,
  readReferralFollowHandle,
  storeReferralFollowHandle,
} from "@/lib/referralFollowBack";
import { SocialFriendsLaunchProvider } from "@/lib/useSocialFriendsLaunch";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("referralFollowBack session key", () => {
  it("stores a normalized handle and clears it", () => {
    storeReferralFollowHandle("@Host_Mate");
    expect(readReferralFollowHandle()).toBe("host_mate");
    expect(sessionStorage.getItem(REFERRAL_FOLLOW_HANDLE_KEY)).toBe("host_mate");
    clearReferralFollowHandle();
    expect(readReferralFollowHandle()).toBeNull();
  });

  it("ignores empty junk", () => {
    storeReferralFollowHandle("@@@");
    expect(readReferralFollowHandle()).toBeNull();
  });
});

describe("ReferralFollowBack card", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function card(myHandle?: string): Promise<HTMLElement | null> {
    await act(async () => {
      root.render(<SocialFriendsLaunchProvider value={true}><ReferralFollowBack myHandle={myHandle} /></SocialFriendsLaunchProvider>);
    });
    return host.querySelector('[aria-label="Follow your inviter"]');
  }

  it("offers Follow through the inviter's add link, once, and clears it on the way", async () => {
    storeReferralFollowHandle("host_mate");
    const follow = (await card("new_drinker"))?.querySelector("a");
    expect(follow?.getAttribute("href")).toBe("/add/host_mate");
    expect(follow?.textContent).toBe("Follow @host_mate");
    await act(async () => follow?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(readReferralFollowHandle()).toBeNull();
  });

  it("goes away for good on Not now", async () => {
    storeReferralFollowHandle("host_mate");
    const notNow = [...((await card("new_drinker"))?.querySelectorAll("button") ?? [])]
      .find((button) => button.textContent === "Not now");
    await act(async () => notNow?.click());
    expect(host.querySelector('[aria-label="Follow your inviter"]')).toBeNull();
    expect(readReferralFollowHandle()).toBeNull();
  });

  it("never asks a drinker to follow themselves", async () => {
    storeReferralFollowHandle("host_mate");
    expect(await card("host_mate")).toBeNull();
  });
});
