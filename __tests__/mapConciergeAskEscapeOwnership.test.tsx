// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapConciergeAsk from "@/components/map/MapConciergeAsk";
import { useMapKeyboardShortcuts } from "@/components/map/pubmap/useMapKeyboardShortcuts";
import { dispatchDismissKey } from "@/lib/nativeBackGesture";
import { useDismissOnEscape } from "@/lib/useDismissOnEscape";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null, session: null }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const noop = () => undefined;
type Surface = "planning" | "detail";

function Journey({ surface }: { surface: Surface }) {
  const [surfaceOpen, setSurfaceOpen] = useState(false);
  useMapKeyboardShortcuts({
    mobileViewport: false,
    planningOpen: surfaceOpen && surface === "planning",
    selectedVenueId: surfaceOpen && surface === "detail" ? "held-pub" : "",
    onBack: () => setSurfaceOpen(false),
    onInterruptReveal: noop,
    logIntentFallbackVisible: false,
    dismissLogIntent: noop,
  });
  return (
    <div className={`appShell${surfaceOpen ? ` ${surface}-open` : ""}`}>
      <button type="button" onClick={() => setSurfaceOpen(true)}>Open surface</button>
      <MapConciergeAsk cityId="london" onSelectVenue={noop} />
      {surfaceOpen ? <aside aria-label="Current map surface">Current map surface</aside> : null}
    </div>
  );
}

function PendingPopup() {
  const [open, setOpen] = useState(true);
  const pendingRef = useRef<HTMLDivElement>(null);
  useDismissOnEscape(open, () => setOpen(false), pendingRef);
  return <output aria-label="Pending popup">{String(open)}</output>;
}

let host: HTMLDivElement;
let root: Root;
let stylesheet: HTMLStyleElement;

beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  stylesheet = document.head.appendChild(document.createElement("style"));
  // Load the product's actual CSS. Layout rectangles in jsdom are always empty.
  stylesheet.textContent = readFileSync("components/map/mapConciergeAsk.css", "utf8");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  stylesheet.remove();
});

function control<T extends HTMLElement>(selector: string): T {
  const element = host.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}

function leave(method: "keyboard" | "native", target: HTMLElement) {
  let consumed = false;
  act(() => {
    if (method === "native") consumed = dispatchDismissKey();
    else {
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      consumed = event.defaultPrevented;
    }
  });
  expect(consumed).toBe(true);
}

describe("hidden Ask leaves Back to the current map surface", () => {
  it.each((["planning", "detail"] as const).flatMap((surface) =>
    (["keyboard", "native"] as const).map((method) => ({ surface, method })),
  ))("$method Back leaves $surface while retaining the hidden Ask", ({ surface, method }) => {
    act(() => root.render(<Journey surface={surface} />));
    act(() => control<HTMLButtonElement>(".mapConciergeAskPill").click());
    const ask = control<HTMLDivElement>(".mapConciergeAsk--open");
    expect(getComputedStyle(ask).display).not.toBe("none");
    const opener = control<HTMLButtonElement>(".appShell > button");
    act(() => { opener.focus(); opener.click(); });
    expect(getComputedStyle(ask).display).toBe("none");

    leave(method, opener);

    expect(host.querySelector('[aria-label="Current map surface"]')).toBeNull();
    expect(host.querySelector(".mapConciergeAsk--open")).toBe(ask);
    expect(getComputedStyle(ask).display).not.toBe("none");
    leave(method, control<HTMLInputElement>(".mapConciergeAskInput"));
    expect(host.querySelector(".mapConciergeAsk--open")).toBeNull();
  });

  it("keeps native Back ownership while a lazy popup has no mounted container", () => {
    act(() => root.render(<PendingPopup />));
    leave("native", control<HTMLOutputElement>("output"));
    expect(control<HTMLOutputElement>("output").textContent).toBe("false");
  });
});
