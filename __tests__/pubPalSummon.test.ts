import { describe, expect, it, vi } from "vitest";

import { palSummonOutsideLondon, shouldShowPubPalSummon } from "@/components/pubpal/PubPalSummon";
import { cancelPalVoiceStart, palVoiceCallMounted, readPalVoiceHost, requestPalVoiceStart, revokePalVoiceCall, setPalVoiceEngaged } from "@/lib/palVoiceHost";

describe("shouldShowPubPalSummon", () => {
  it("appears on the adaptive home, city maps, and plan surfaces", () => {
    expect(shouldShowPubPalSummon("/")).toBe(true);
    expect(shouldShowPubPalSummon("/map")).toBe(true);
    expect(shouldShowPubPalSummon("/map/manchester")).toBe(true);
    expect(shouldShowPubPalSummon("/plan")).toBe(true);
    expect(shouldShowPubPalSummon("/plan/abc123")).toBe(true);
  });

  it("stays out of reading and account-management surfaces", () => {
    expect(shouldShowPubPalSummon("/feed")).toBe(false);
    expect(shouldShowPubPalSummon("/pal")).toBe(false);
    expect(shouldShowPubPalSummon("/u/night_owl")).toBe(false);
  });
});

describe("the map chip", () => {
  it.each([
    ["/profile", "owner-a", false],
    ["/map", "owner-b", false],
    ["/map", "owner-a", true],
  ] as const)("stops pending feedback on cancellation at %s for %s (hidden: %s)", (path, owner, hidden) => {
    revokePalVoiceCall();
    const stop = vi.fn();
    requestPalVoiceStart("owner-a", {}, stop);
    cancelPalVoiceStart("/map", "owner-a");
    expect(stop).not.toHaveBeenCalled();
    cancelPalVoiceStart(path, owner, hidden);
    expect(stop).toHaveBeenCalledOnce();
    revokePalVoiceCall();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("stops replaced and revoked feedback without retaining either handle", () => {
    revokePalVoiceCall();
    const first = vi.fn();
    const second = vi.fn();
    requestPalVoiceStart("owner-a", {}, first);
    requestPalVoiceStart("owner-a", {}, second);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    revokePalVoiceCall();
    revokePalVoiceCall();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("says voice talks about London on another city's map only", () => {
    expect(palSummonOutsideLondon("/map/manchester")).toBe(true);
    expect(palSummonOutsideLondon("/map")).toBe(false);
    expect(palSummonOutsideLondon("/map/london")).toBe(false);
    expect(palSummonOutsideLondon("/map/arrival")).toBe(false);
  });

  it("keeps a call it asked for mounted until the call is engaged, and on the call routes only", () => {
    revokePalVoiceCall();
    expect(palVoiceCallMounted(readPalVoiceHost(), "/map")).toBe(false);
    requestPalVoiceStart("owner-a", { palName: "Ripley" });
    const asked = readPalVoiceHost();
    expect(asked).toMatchObject({ startPending: true, props: { palName: "Ripley" } });
    expect(palVoiceCallMounted(asked, "/map")).toBe(true);
    expect(palVoiceCallMounted(asked, "/profile")).toBe(false);
    // The first render is not engaged yet; the ask still holds the call.
    setPalVoiceEngaged(false);
    expect(palVoiceCallMounted(readPalVoiceHost(), "/map")).toBe(true);
    setPalVoiceEngaged(true);
    expect(readPalVoiceHost().startPending).toBe(false);
    setPalVoiceEngaged(false);
    expect(palVoiceCallMounted(readPalVoiceHost(), "/map")).toBe(false);
    requestPalVoiceStart("owner-a", { palName: "Ripley" });
    expect(readPalVoiceHost().startRequest).toBe(asked.startRequest + 1);
    revokePalVoiceCall();
  });

  it("drops an ask no call has taken when the person leaves the call's pages or the account changes", () => {
    revokePalVoiceCall();
    requestPalVoiceStart("owner-a", { palName: "Ripley" });
    cancelPalVoiceStart("/map/manchester", "owner-a");
    expect(readPalVoiceHost()).toMatchObject({ startPending: true, startOwner: "owner-a" });
    cancelPalVoiceStart("/profile", "owner-a");
    expect(readPalVoiceHost()).toMatchObject({ startPending: false, startOwner: null });
    expect(palVoiceCallMounted(readPalVoiceHost(), "/map")).toBe(false);

    requestPalVoiceStart("owner-a", { palName: "Ripley" });
    cancelPalVoiceStart("/map", "owner-b");
    expect(readPalVoiceHost().startPending).toBe(false);

    // A page put in the background drops the ask, even on the map for the same account.
    requestPalVoiceStart("owner-a", { palName: "Ripley" });
    cancelPalVoiceStart("/map", "owner-a", true);
    expect(readPalVoiceHost()).toMatchObject({ startPending: false, startOwner: null });
    revokePalVoiceCall();
  });
});
