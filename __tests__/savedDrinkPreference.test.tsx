// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_NIGHT_PROFILE_INPUT, type NightProfileInput } from "@/lib/nightProfile";
import { mirrorAccountNightProfileToDevice, readDeviceNightDrink, readDeviceNightProfile, writeDeviceNightContext, writeDeviceNightProfile } from "@/lib/nightProfileClient";
import { bindDeviceAccountOwner, clearDeviceAccountArtifacts, releaseDeviceAccountOwner } from "@/lib/deviceAccountIdentity";
import { savedDrinkFromProfile, savedDrinkIsShowing } from "@/lib/savedDrinkPreference";

const { profileState, authState, owners } = vi.hoisted(() => ({
  profileState: { current: { profile: null as unknown, status: "signed-out" as string } },
  authState: { current: { signedIn: true } },
  owners: [] as Array<string | null>,
}));
vi.mock("@/lib/useSavedNightProfile", () => ({
  useSavedNightProfile: (owner: string | null) => {
    owners.push(owner);
    return owner ? profileState.current : { profile: null, status: "signed-out" };
  },
}));
vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({
    user: authState.current.signedIn ? { id: "11111111-1111-4111-8111-111111111111" } : null,
    session: null,
    identityResolved: true,
    providerAuthState: authState.current.signedIn ? "authenticated" : "signed-out",
    accountRevision: 1,
  }),
}));

import NearMeSavedDrink from "@/components/nearme/NearMeSavedDrink";

function profile(context: Partial<NightProfileInput["context"]>, cityId: NightProfileInput["cityId"] = "london") {
  return { ...DEFAULT_NIGHT_PROFILE_INPUT, cityId, context: { ...DEFAULT_NIGHT_PROFILE_INPUT.context, ...context } };
}

describe("savedDrinkFromProfile", () => {
  it("offers a saved non-pint lane and a saved zero-proof choice", () => {
    expect(savedDrinkFromProfile(profile({ drinkCategory: "wine" }), "london")).toEqual({ kind: "lane", category: "wine", label: "Wine" });
    expect(savedDrinkFromProfile(profile({ zeroProof: true, drinkCategory: "wine" }), "london")).toEqual({ kind: "zero-proof", label: "Alcohol-free" });
  });

  it("asks for nothing for the default pint lane, no saved drink, another city or no profile", () => {
    expect(savedDrinkFromProfile(profile({ drinkCategory: "beer" }), "london")).toBeNull();
    expect(savedDrinkFromProfile(profile({ drinkCategory: null }), "london")).toBeNull();
    expect(savedDrinkFromProfile(profile({ drinkCategory: "wine" }, "manchester"), "london")).toBeNull();
    expect(savedDrinkFromProfile(null, "london")).toBeNull();
  });

  it("knows when the map already shows the saved drink", () => {
    const wine = { kind: "lane", category: "wine", label: "Wine" } as const;
    expect(savedDrinkIsShowing(wine, { drinkLane: "wine", noAlcoholView: false })).toBe(true);
    expect(savedDrinkIsShowing(wine, { drinkLane: "beer", noAlcoholView: false })).toBe(false);
    expect(savedDrinkIsShowing(wine, { drinkLane: "wine", noAlcoholView: true })).toBe(false);
    const zero = { kind: "zero-proof", label: "Alcohol-free" } as const;
    expect(savedDrinkIsShowing(zero, { drinkLane: "beer", noAlcoholView: true })).toBe(true);
  });
});

describe("NearMeSavedDrink", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    authState.current = { signedIn: true };
    profileState.current = { profile: null, status: "signed-out" };
    localStorage.clear();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  function render(drinkLane: "beer" | "wine", onShow = vi.fn()) {
    act(() => root.render(createElement(NearMeSavedDrink, { cityId: "london", drinkLane, noAlcoholView: false, onShow })));
    return onShow;
  }

  it("offers the saved drink and switches the map only when tapped", () => {
    writeDeviceNightContext(profile({ drinkCategory: "wine" }).context, "london");
    profileState.current = { profile: profile({}), status: "ready" };
    const onShow = render("beer");
    expect(host.textContent).toContain("Your saved drink is Wine.");
    expect(onShow).not.toHaveBeenCalled();
    const button = [...host.querySelectorAll("button")].find((node) => node.textContent === "Show Wine on the map");
    act(() => button?.click());
    expect(onShow).toHaveBeenCalledWith({ kind: "lane", category: "wine", label: "Wine" });
  });

  it.each(["device", undefined])("offers Wine from a legacy device profile with source=%s", (source) => {
    localStorage.setItem("pubmaxx.night-profile.v1:device", JSON.stringify({
      version: 1,
      source,
      profile: profile({ drinkCategory: "wine" }),
    }));
    authState.current = { signedIn: false };
    render("beer");
    expect(host.textContent).toContain("Your saved drink is Wine.");
  });

  it.each([
    { version: 1, source: "account", profile: profile({ drinkCategory: "wine" }) },
    { version: 2, source: "device", profile: profile({ drinkCategory: "wine" }) },
    { version: 1, source: "device", profile: { ...profile({ drinkCategory: "wine" }), cityId: "unknown" } },
    { version: 1, source: "device", profile: { ...profile({}), context: { ...profile({}).context, drinkCategory: "unknown" } } },
    { version: 1, source: "device", profile: null },
  ])("does not offer an account-owned or invalid legacy drink: %j", (envelope) => {
    localStorage.setItem("pubmaxx.night-profile.v1:device", JSON.stringify(envelope));
    render("beer");
    expect(host.textContent).toBe("");
  });

  it("keeps the separate device drink ahead of the legacy choice", () => {
    writeDeviceNightContext(profile({ drinkCategory: "beer" }).context, "london");
    writeDeviceNightProfile(profile({ drinkCategory: "wine" }));
    render("beer");
    expect(host.textContent).toBe("");
  });

  it("preserves only the legacy drink before an account mirror replaces the profile", () => {
    localStorage.setItem("pubmaxx.night-profile.v1:device", JSON.stringify({
      version: 1,
      source: "device",
      profile: {
        ...profile({ drinkCategory: "wine", budget: "value" }),
        pubPalId: "11111111-1111-4111-8111-111111111111",
        voicePreference: "ptt",
        briefingPreferences: { muteAll: true, mutedAreas: [], mutedTopics: ["music"] },
      },
    }));
    mirrorAccountNightProfileToDevice({
      ...profile({ budget: "treat" }),
      createdAt: "2026-11-06T12:00:00Z",
      updatedAt: "2026-11-06T12:01:00Z",
    });
    expect(readDeviceNightProfile()?.context.budget).toBe("treat");
    releaseDeviceAccountOwner(localStorage, sessionStorage);
    expect(readDeviceNightProfile()).toBeNull();
    expect(readDeviceNightDrink()).toMatchObject({
      context: { drinkCategory: "wine", budget: "standard" },
      pubPalId: null,
      voicePreference: "off",
      briefingPreferences: { muteAll: false, mutedAreas: [], mutedTopics: [] },
    });
    authState.current = { signedIn: false };
    render("beer");
    expect(host.textContent).toContain("Your saved drink is Wine.");
  });

  it("shows nothing without a device choice or when the map already shows it", () => {
    owners.length = 0;
    profileState.current = { profile: profile({ drinkCategory: "wine" }), status: "ready" };
    render("beer");
    expect(host.textContent).toBe("");
    act(() => { writeDeviceNightContext(profile({ drinkCategory: "wine" }).context, "london"); });
    render("wine");
    expect(host.textContent).toBe("");
    localStorage.clear();
    profileState.current = { profile: null, status: "loading" };
    render("beer");
    expect(host.textContent).toBe("");
    authState.current = { signedIn: false };
    profileState.current = { profile: profile({ drinkCategory: "wine" }), status: "ready" };
    render("beer");
    expect(host.textContent).toBe("");
    expect(owners.at(-1)).toBeNull();
  });

  it.each([true, false])("offers this device's choice with signedIn=%s", (signedIn) => {
    authState.current = { signedIn };
    writeDeviceNightContext(profile({ drinkCategory: "wine" }).context, "london");
    profileState.current = { profile: null, status: "unavailable" };
    render("beer");
    expect(host.textContent).toContain("Your saved drink is Wine.");
    profileState.current = { profile: null, status: "loading" };
    render("beer");
    expect(host.textContent).toContain("Your saved drink is Wine.");
  });

  it("updates the offer when Plan changes the device choice", () => {
    render("beer");
    expect(host.textContent).toBe("");
    act(() => { writeDeviceNightContext(profile({ drinkCategory: "wine" }).context, "london"); });
    expect(host.textContent).toContain("Your saved drink is Wine.");
    act(() => { writeDeviceNightContext(profile({ drinkCategory: "gin" }).context, "london"); });
    expect(host.textContent).toContain("Your saved drink is Gin.");
    act(() => { writeDeviceNightContext(profile({ drinkCategory: "other" }).context, "london"); });
    expect(host.textContent).toBe("");
    act(() => { writeDeviceNightContext(profile({ drinkCategory: "beer" }).context, "london"); });
    expect(host.textContent).toBe("");
    act(() => { writeDeviceNightContext(profile({ drinkCategory: "wine" }).context, "manchester"); });
    expect(host.textContent).toBe("");
  });

  it("keeps the account's alcohol-free choice ahead of the device category", () => {
    writeDeviceNightContext(profile({ drinkCategory: "wine" }).context, "london");
    profileState.current = { profile: profile({ zeroProof: true }), status: "ready" };
    const onShow = render("beer");
    expect(host.textContent).toContain("Your saved drink is Alcohol-free.");
    act(() => host.querySelector("button")?.click());
    expect(onShow).toHaveBeenCalledWith({ kind: "zero-proof", label: "Alcohol-free" });
    authState.current = { signedIn: false };
    render("beer");
    expect(host.textContent).toContain("Your saved drink is Wine.");
  });

  it("retains a device category after an account import and sign-out", () => {
    writeDeviceNightContext(profile({ drinkCategory: "wine" }).context, "london");
    const account = { ...profile({}), createdAt: "2026-11-06T12:00:00Z", updatedAt: "2026-11-06T12:00:00Z" };
    mirrorAccountNightProfileToDevice(account);
    profileState.current = { profile: account, status: "ready" };
    render("beer");
    expect(host.textContent).toContain("Your saved drink is Wine.");
    clearDeviceAccountArtifacts(localStorage, sessionStorage);
    authState.current = { signedIn: false };
    render("beer");
    expect(host.textContent).toContain("Your saved drink is Wine.");
  });

  it.each(["sign-out", "account switch"])("removes copied account fields after a local drink edit and %s", (transition) => {
    bindDeviceAccountOwner("account-a", localStorage, sessionStorage);
    mirrorAccountNightProfileToDevice({
      ...profile({ budget: "treat" }),
      pubPalId: "11111111-1111-4111-8111-111111111111",
      voicePreference: "ptt",
      briefingPreferences: { muteAll: true, mutedAreas: [], mutedTopics: ["music"] },
      createdAt: "2026-11-06T12:00:00Z",
      updatedAt: "2026-11-06T12:00:00Z",
    });
    writeDeviceNightContext(profile({ drinkCategory: "wine" }).context, "london");
    expect(readDeviceNightProfile()).toMatchObject({
      pubPalId: "11111111-1111-4111-8111-111111111111",
      voicePreference: "ptt",
      briefingPreferences: { muteAll: true, mutedAreas: [], mutedTopics: ["music"] },
    });
    if (transition === "sign-out") releaseDeviceAccountOwner(localStorage, sessionStorage);
    else bindDeviceAccountOwner("account-b", localStorage, sessionStorage);
    expect(readDeviceNightProfile()).toBeNull();
    expect(readDeviceNightDrink()).toMatchObject({
      pubPalId: null,
      voicePreference: "off",
      briefingPreferences: { muteAll: false, mutedAreas: [], mutedTopics: [] },
    });
    authState.current = { signedIn: transition !== "sign-out" };
    render("beer");
    expect(host.textContent).toContain("Your saved drink is Wine.");
  });

  it("refreshes the saved account budget while keeping the device Wine offer", () => {
    writeDeviceNightContext(profile({ drinkCategory: "wine", budget: "value" }).context, "london");
    const saved = mirrorAccountNightProfileToDevice({
      ...profile({ budget: "treat" }),
      createdAt: "2026-11-06T12:00:00Z",
      updatedAt: "2026-11-06T12:01:00Z",
    });
    expect(saved?.context.budget).toBe("treat");
    expect(readDeviceNightProfile()?.context.budget).toBe("treat");
    render("beer");
    expect(host.textContent).toContain("Your saved drink is Wine.");
  });

  it.each([false, true])("keeps Wine through an unrelated context save with legacy=%s", (legacy) => {
    writeDeviceNightProfile(profile({ drinkCategory: "wine" }));
    if (!legacy) {
      mirrorAccountNightProfileToDevice({
        ...profile({}),
        createdAt: "2026-11-06T12:00:00Z",
        updatedAt: "2026-11-06T12:00:00Z",
      });
      releaseDeviceAccountOwner(localStorage, sessionStorage);
    }
    const loaded = profile({}).context;
    writeDeviceNightContext({ ...loaded, budget: "treat" }, "london", undefined, loaded);
    expect(readDeviceNightProfile()?.context.budget).toBe("treat");
    expect(readDeviceNightDrink()?.context.drinkCategory).toBe("wine");
    authState.current = { signedIn: false };
    render("beer");
    expect(host.textContent).toContain("Your saved drink is Wine.");
  });

  it("saves category clearing and both alcohol-free transitions against the caller's context", () => {
    const wine = profile({ drinkCategory: "wine" }).context;
    writeDeviceNightContext(wine, "london");
    const dryWine = { ...wine, zeroProof: true };
    writeDeviceNightContext(dryWine, "london", undefined, wine);
    expect(readDeviceNightDrink()?.context).toMatchObject({ drinkCategory: "wine", zeroProof: true });
    writeDeviceNightContext(wine, "london", undefined, dryWine);
    expect(readDeviceNightDrink()?.context).toMatchObject({ drinkCategory: "wine", zeroProof: false });
    writeDeviceNightContext({ ...wine, drinkCategory: null }, "london", undefined, wine);
    expect(readDeviceNightDrink()?.context.drinkCategory).toBeNull();
    render("beer");
    expect(host.textContent).toBe("");
  });

  it("does not retain an account mirror after the account changes", () => {
    writeDeviceNightProfile(profile({ zeroProof: true }), undefined, "account");
    profileState.current = { profile: profile({ zeroProof: true }), status: "ready" };
    render("beer");
    expect(host.textContent).toContain("Your saved drink is Alcohol-free.");
    clearDeviceAccountArtifacts(localStorage, sessionStorage);
    authState.current = { signedIn: false };
    render("beer");
    expect(host.textContent).toBe("");
  });
});
