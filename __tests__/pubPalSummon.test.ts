import { describe, expect, it } from "vitest";

import { palSummonOutsideLondon, shouldShowPubPalSummon } from "@/components/pubpal/PubPalSummon";
import { palVoiceCallMounted, readPalVoiceHost, requestPalVoiceStart, revokePalVoiceCall, setPalVoiceEngaged } from "@/lib/palVoiceHost";

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
  it("says voice talks about London on another city's map only", () => {
    expect(palSummonOutsideLondon("/map/manchester")).toBe(true);
    expect(palSummonOutsideLondon("/map")).toBe(false);
    expect(palSummonOutsideLondon("/map/london")).toBe(false);
    expect(palSummonOutsideLondon("/map/arrival")).toBe(false);
  });

  it("keeps a call it asked for mounted until the call is engaged, and on the call routes only", () => {
    revokePalVoiceCall();
    expect(palVoiceCallMounted(readPalVoiceHost(), "/map")).toBe(false);
    requestPalVoiceStart({ palName: "Ripley" });
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
    requestPalVoiceStart({ palName: "Ripley" });
    expect(readPalVoiceHost().startRequest).toBe(asked.startRequest + 1);
    revokePalVoiceCall();
  });
});
