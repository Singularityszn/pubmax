// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_NIGHT_PROFILE_INPUT, type NightProfileInput } from "@/lib/nightProfile";
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
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  function render(drinkLane: "beer" | "wine", onShow = vi.fn()) {
    act(() => root.render(createElement(NearMeSavedDrink, { cityId: "london", drinkLane, noAlcoholView: false, onShow })));
    return onShow;
  }

  it("offers the saved drink and switches the map only when tapped", () => {
    profileState.current = { profile: profile({ drinkCategory: "wine" }), status: "ready" };
    const onShow = render("beer");
    expect(host.textContent).toContain("Your saved drink is Wine.");
    expect(onShow).not.toHaveBeenCalled();
    const button = [...host.querySelectorAll("button")].find((node) => node.textContent === "Show Wine on the map");
    act(() => button?.click());
    expect(onShow).toHaveBeenCalledWith({ kind: "lane", category: "wine", label: "Wine" });
  });

  it("shows nothing when the map already shows it, while loading, or when signed out", () => {
    owners.length = 0;
    profileState.current = { profile: profile({ drinkCategory: "wine" }), status: "ready" };
    render("wine");
    expect(host.textContent).toBe("");
    profileState.current = { profile: null, status: "loading" };
    render("beer");
    expect(host.textContent).toBe("");
    authState.current = { signedIn: false };
    profileState.current = { profile: profile({ drinkCategory: "wine" }), status: "ready" };
    render("beer");
    expect(host.textContent).toBe("");
    // A signed-out viewer never asks for a saved profile at all.
    expect(owners.at(-1)).toBeNull();
  });
});
