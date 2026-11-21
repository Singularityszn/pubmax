// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chunk = { release: () => {}, ready: null as Promise<void> | null };
vi.mock("next/navigation", () => ({ usePathname: () => "/map", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/mapSearchIndexLoader", () => ({ loadMapSearchIndex: vi.fn(async () => ({ cities: [], venues: [] })) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

type ProviderModule = typeof import("@/components/command/CommandPaletteProvider");
let CommandPaletteProvider: ProviderModule["default"];
let useCommandPalette: ProviderModule["useCommandPalette"];
let MapSearchSuggest: typeof import("@/components/map/MapSearchSuggest").default;
let PersonaLensPicker: typeof import("@/components/map/PersonaLensPicker").default;
let dispatchDismissKey: typeof import("@/lib/nativeBackGesture").dispatchDismissKey;

function State() { return <output>{String(useCommandPalette().isOpen)}</output>; }
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  chunk.ready = new Promise<void>((resolve) => { chunk.release = resolve; });
  // Each test owns a palette chunk that has not loaded yet.
  vi.resetModules();
  vi.doMock("@/components/command/CommandPalette", async (importOriginal) => {
    await chunk.ready;
    return importOriginal();
  });
  ({ default: CommandPaletteProvider, useCommandPalette } = await import("@/components/command/CommandPaletteProvider"));
  ({ default: MapSearchSuggest } = await import("@/components/map/MapSearchSuggest"));
  ({ default: PersonaLensPicker } = await import("@/components/map/PersonaLensPicker"));
  ({ dispatchDismissKey } = await import("@/lib/nativeBackGesture"));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoViewDescriptor);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

describe("pending palette cancellation from map inputs", () => {
  it.each(["toolbar", "overlay", "persona", "native"] as const)("cancels before the %s handler and stays cancelled after load", async (mode) => {
    const close = vi.fn();
    await act(async () => root.render(<CommandPaletteProvider><State />{mode === "persona"
      ? <PersonaLensPicker personaId={null} tonightCategory={null} onSelect={() => {}} />
      : <MapSearchSuggest id="pending-search" mode={mode === "overlay" ? "overlay" : "toolbar"} cityId="london" query="Camden" onQueryChange={() => {}} venues={[]} localities={[]} userLocation={null} mapCenter={[-0.13, 51.5]} placeholder="Search the map" onSelectVenue={() => {}} onFlyToArea={() => {}} onClose={close} />}</CommandPaletteProvider>));
    if (mode === "persona") await act(async () => host.querySelector<HTMLButtonElement>(".personaLensTrigger")!.click());
    const input = host.querySelector<HTMLInputElement>("input")!;
    await act(async () => input.focus());
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })));
    expect(host.querySelector("output")!.textContent).toBe("true");
    expect(host.querySelector(".cmdkPanel")).toBeNull();
    await act(async () => {
      if (mode === "native") expect(dispatchDismissKey()).toBe(true);
      else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(host.querySelector("output")!.textContent).toBe("false");
    expect(close).not.toHaveBeenCalled();
    expect(input.value).toBe(mode === "persona" ? "" : "Camden");
    if (mode === "persona") expect(host.querySelector(".personaLensPanel")).not.toBeNull();
    await act(async () => { chunk.release(); await import("@/components/command/CommandPalette"); });
    expect(host.querySelector(".cmdkPanel")).toBeNull();
    expect(document.activeElement).toBe(input);
  });
  it("cancels a mounted palette before its scheduled focus transfer", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const close = vi.fn();
    await act(async () => root.render(<CommandPaletteProvider><State /><MapSearchSuggest id="mounting-search" mode="toolbar" cityId="london" query="Camden" onQueryChange={() => {}} venues={[]} localities={[]} userLocation={null} mapCenter={[-0.13, 51.5]} placeholder="Search the map" onSelectVenue={() => {}} onFlyToArea={() => {}} onClose={close} /></CommandPaletteProvider>));
    const input = host.querySelector<HTMLInputElement>("input")!;
    await act(async () => input.focus());
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })));
    expect(host.querySelector(".cmdkPanel")).toBeNull();
    await act(async () => { chunk.release(); await import("@/components/command/CommandPalette"); });
    expect(host.querySelector(".cmdkPanel")).not.toBeNull();
    expect(document.activeElement).toBe(input);
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(host.querySelector("output")!.textContent).toBe("false");
    expect(host.querySelector(".cmdkPanel")).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(input.value).toBe("Camden");
    expect(document.activeElement).toBe(input);
  });

});
