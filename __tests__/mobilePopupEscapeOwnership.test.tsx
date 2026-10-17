// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapLayersControl from "@/components/map/MapLayersControl";
import ZonePicker from "@/components/map/ZonePicker";
import MobileSharedSheet from "@/components/mobile/MobileSharedSheet";
import { dispatchDismissKey } from "@/lib/nativeBackGesture";
import { POI_CATEGORIES, type PoiCategory } from "@/lib/pois";
import { computeZonePintIndex } from "@/lib/zones";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const noop = () => undefined;
const poiHidden = Object.fromEntries(
  POI_CATEGORIES.map((category) => [category, true]),
) as Record<PoiCategory, boolean>;
const wentHome = vi.fn();
const wentBack = vi.fn();

function PhoneJourney({ content }: { content: "zone" | "layers" }) {
  const [atParent, setAtParent] = useState(false);
  const [zone, setZone] = useState("2");
  return (
    <>
      <output aria-label="Selected fare zone">{zone}</output>
      <MobileSharedSheet
        kind={atParent ? "venue" : content === "zone" ? "filters" : "layers"}
        title={atParent ? "Selected pub" : content === "zone" ? "Prices and places" : "Map controls"}
        initialSnap="half"
        backLabel={atParent ? null : "Selected pub"}
        onBack={atParent ? undefined : () => { wentBack(); setAtParent(true); }}
        onClose={wentHome}
      >
        {atParent ? <p>Preserved venue detail</p> : content === "zone" ? (
          // PubMap's phone Filters caller uses the default toolbar variant.
          <ZonePicker zone={zone} onZoneChange={setZone} index={computeZonePintIndex([])} />
        ) : (
          // The production phone Layers caller omits onRequestClose. This
          // content cannot become an independent dismiss owner.
          <MapLayersControl embedded poiHidden={poiHidden} onPoiHiddenChange={noop} />
        )}
      </MobileSharedSheet>
    </>
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  wentHome.mockClear();
  wentBack.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function control<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}

async function renderJourney(content: "zone" | "layers") {
  await act(async () => root.render(<PhoneJourney content={content} />));
  // Let the sheet's real entrance focus occur before opening the child.
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

function pressEscape(target: HTMLElement) {
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Escape", bubbles: true, cancelable: true,
  })));
}

function nativeBack() {
  let consumed = false;
  act(() => { consumed = dispatchDismissKey(); });
  expect(consumed).toBe(true);
}

function expectParent() {
  expect(wentBack).toHaveBeenCalledTimes(1);
  expect(wentHome).not.toHaveBeenCalled();
  expect(document.querySelector('.mobileSheetPortal[data-sheet-kind="venue"]')).not.toBeNull();
  expect(document.querySelector(".mobileSharedSheet")?.textContent).toContain("Preserved venue detail");
  expect(control<HTMLOutputElement>('[aria-label="Selected fare zone"]').textContent).toBe("2");
}

describe("phone popup Escape preserves the sheet trail", () => {
  it.each(["keyboard", "native"] as const)("%s Back closes Zone before returning to the parent sheet", async (method) => {
    await renderJourney("zone");
    const trigger = control<HTMLButtonElement>(".zonePickerBtn");
    act(() => { trigger.focus(); trigger.click(); });
    expect(document.querySelector(".zonePickerPanel")).not.toBeNull();
    if (method === "native") nativeBack();
    else pressEscape(trigger);

    expect(document.querySelector(".zonePickerPanel")).toBeNull();
    expect(document.querySelector('.mobileSheetPortal[data-sheet-kind="filters"]')).not.toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(wentBack).not.toHaveBeenCalled();
    expect(wentHome).not.toHaveBeenCalled();
    expect(control<HTMLOutputElement>('[aria-label="Selected fare zone"]').textContent).toBe("2");

    if (method === "native") nativeBack();
    else pressEscape(trigger);
    expectParent();
  });

  it.each(["keyboard", "native"] as const)("%s Back leaves embedded Layers through sheet history", async (method) => {
    await renderJourney("layers");
    expect(document.querySelector(".mapLayersPanel")).not.toBeNull();
    expect(document.querySelector(".mapLayersFab")).toBeNull();
    const layerButton = control<HTMLButtonElement>(".mapLayersPanel button");
    act(() => layerButton.focus());
    if (method === "native") nativeBack();
    else pressEscape(layerButton);
    expectParent();
  });
});
