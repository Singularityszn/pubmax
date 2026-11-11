// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SpringDrawer from "@/components/map/SpringDrawer";
import { useSheetDrag } from "@/components/map/useSheetDrag";
import { publishMapSheetClearance, releaseMapSheetClearance } from "@/lib/mapSheetClearance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const inertDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "inert");
let host: HTMLDivElement;
let root: Root;
let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  // jsdom needs the browser's reflected inert property for owner behavior.
  Object.defineProperty(HTMLElement.prototype, "inert", {
    configurable: true,
    get() { return this.hasAttribute("inert"); },
    set(value: boolean) { this.toggleAttribute("inert", value); },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.style.removeProperty("--sheet-top-reserve");
  vi.restoreAllMocks();
  if (inertDescriptor) Object.defineProperty(HTMLElement.prototype, "inert", inertDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "inert");
  vi.unstubAllGlobals();
});

function offsetY(drawer: HTMLElement): number {
  return Number(drawer.style.transform.match(/translate3d\(0, ([-\d.e]+)px, 0\)/)?.[1] ?? 0);
}

function tabletLayout(): void {
  vi.stubGlobal("innerWidth", 768);
  vi.stubGlobal("innerHeight", 900);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 768px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = computedStyle(element);
    if (element.classList.contains("mapDrawer")) {
      style.bottom = "58px";
      style.setProperty("--sheet-top-reserve", document.body.style.getPropertyValue("--sheet-top-reserve") || "0px");
    }
    return style;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, offsetY(this) - 58, 768, window.innerHeight);
  });
  vi.stubGlobal("DOMMatrixReadOnly", class {
    m42: number;
    constructor(transform: string) {
      this.m42 = Number(transform.match(/translate3d\(0, ([-\d.e]+)px, 0\)/)?.[1] ?? 0);
    }
  });
}

function settle(): void {
  frame(0);
  frame(5_000);
}

describe("tablet voice clearance", () => {
  it.each(["story", "planner", "venue"])("recaps the %s drawer when the bar changes without new drawer props", async (kind) => {
    tabletLayout();
    act(() => root.render(
      <SpringDrawer open side={kind === "venue" ? "right" : "left"} snap="full"
        className="mapDrawer" dragOffsetY={null} releaseVelocityY={0}>
        <button>Close</button>
      </SpringDrawer>,
    ));
    const drawer = host.firstElementChild as HTMLElement;
    expect(offsetY(drawer)).toBeCloseTo(72);

    await act(async () => { document.body.style.setProperty("--sheet-top-reserve", "44px"); });
    settle();
    expect(drawer.getBoundingClientRect().top).toBeCloseTo(44);

    await act(async () => { document.body.style.setProperty("--sheet-top-reserve", "144px"); });
    settle();
    expect(drawer.getBoundingClientRect().top).toBeCloseTo(144);

    await act(async () => { document.body.style.removeProperty("--sheet-top-reserve"); });
    settle();
    expect(offsetY(drawer)).toBeCloseTo(72);

    act(() => {
      vi.stubGlobal("innerHeight", 1_000);
      window.dispatchEvent(new Event("resize"));
    });
    settle();
    expect(offsetY(drawer)).toBeCloseTo(80);
  });

  it.each([
    ["story", "venue"], ["planner", "venue"], ["venue", "planner"], ["venue", "story"],
    ["story", "planner"], ["planner", "story"],
  ])("keeps %s's closing spring from clearing %s's clearance", (outgoing, incoming) => {
    tabletLayout();
    const render = (handoff: boolean) => act(() => root.render(<>
      {handoff ? <SpringDrawer key="incoming" open side={incoming === "venue" ? "right" : "left"}
        snap="half" className="mapDrawer" dragOffsetY={null} releaseVelocityY={0}>
        <button>{incoming}</button>
      </SpringDrawer> : null}
      <SpringDrawer key="outgoing" open={!handoff} side={outgoing === "venue" ? "right" : "left"}
        snap="full" className="mapDrawer" dragOffsetY={null} releaseVelocityY={0}>
        <button>{outgoing}</button>
      </SpringDrawer>
    </>));
    render(false);
    render(true);
    settle();
    const clearance = Number.parseFloat(document.documentElement.style.getPropertyValue("--map-sheet-clearance-h"));
    expect(clearance).toBeGreaterThanOrEqual(553);
    expect(clearance).toBeLessThanOrEqual(554);
  });

  it.each([["div", "section"], ["section", "div"]])("keeps %s's clearance when the outgoing %s releases ownership", (incomingTag, outgoingTag) => {
    const outgoing = document.createElement(outgoingTag);
    const incoming = document.createElement(incomingTag);
    publishMapSheetClearance(outgoing, 300);
    publishMapSheetClearance(incoming, 500);
    publishMapSheetClearance(outgoing, 100, false);
    releaseMapSheetClearance(outgoing);
    expect(document.documentElement.style.getPropertyValue("--map-sheet-clearance-h")).toBe("500px");
    releaseMapSheetClearance(incoming);
    expect(document.documentElement.style.getPropertyValue("--map-sheet-clearance-h")).toBe("");
  });

  it("tracks the last sheet's closing spring until it releases ownership", () => {
    const sheet = document.createElement("div");
    publishMapSheetClearance(sheet, 500);
    publishMapSheetClearance(sheet, 100, false);
    expect(document.documentElement.style.getPropertyValue("--map-sheet-clearance-h")).toBe("100px");
    releaseMapSheetClearance(sheet);
    expect(document.documentElement.style.getPropertyValue("--map-sheet-clearance-h")).toBe("");
  });
});

function DraggableDrawer({ side }: { side: "left" | "right" }) {
  const drag = useSheetDrag(() => {});
  return <SpringDrawer open side={side} snap={drag.sheetSnap} className="mapDrawer"
    dragOffsetY={drag.sheetDragY} releaseVelocityY={drag.sheetReleaseVelocity}>
    <button onClick={() => drag.setSheetSnap("full")}>Expand</button>
    <header onPointerDown={drag.onSheetDragStart} onPointerMove={drag.onSheetDragMove}
      onPointerUp={drag.onSheetDragEnd}>Drag</header>
  </SpringDrawer>;
}

describe.each(["left", "right"] as const)("%s reserved tablet drag", (side) => {
  function pointer(header: HTMLElement, type: string, clientY: number): void {
    act(() => header.dispatchEvent(new MouseEvent(type, { bubbles: true, clientY })));
  }

  function mountDrag(reserve: number) {
    tabletLayout();
    document.body.style.setProperty("--sheet-top-reserve", `${reserve}px`);
    act(() => root.render(<DraggableDrawer side={side} />));
    const drawer = host.firstElementChild as HTMLElement;
    const header = drawer.querySelector("header")!;
    header.setPointerCapture = vi.fn();
    header.releasePointerCapture = vi.fn();
    return { drawer, header };
  }

  it("grabs without a jump and resists above the reserved full bound", () => {
    const { drawer, header } = mountDrag(44);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    act(() => drawer.querySelector("button")!.click());
    settle();
    expect(offsetY(drawer)).toBe(102);
    pointer(header, "pointerdown", 200);
    expect(offsetY(drawer)).toBe(102);
    now = 100;
    pointer(header, "pointermove", 180);
    expect(offsetY(drawer)).toBeGreaterThan(82);
    expect(offsetY(drawer)).toBeLessThan(102);
    now = 200;
    pointer(header, "pointerup", 180);
    settle();
    expect(offsetY(drawer)).toBe(102);
  });

  it("ranks release against the reserved full position", () => {
    const { drawer, header } = mountDrag(242);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    pointer(header, "pointerdown", 500);
    now = 100;
    pointer(header, "pointermove", 420);
    expect(offsetY(drawer)).toBeCloseTo(325);
    now = 200;
    pointer(header, "pointerup", 420);
    settle();
    expect(drawer.classList.contains("sheet-full")).toBe(true);
    expect(offsetY(drawer)).toBe(300);
  });
});

function frame(timestamp: number): void {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(timestamp)));
}

describe.each([700, 768, 769, 900])("drawer at %ipx", (width) => {
  for (const side of ["left", "right"] as const) {
    for (const keepMounted of [false, true]) {
      it(`${side} retains closing content and ${keepMounted ? "keeps" : "removes"} it at rest`, () => {
        vi.stubGlobal("matchMedia", (query: string) => ({
          matches: query.includes("max-width") && width <= Number(query.match(/\d+/)?.[0]),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }));
        const render = (open: boolean, text: string) => act(() => root.render(
          <SpringDrawer
            open={open}
            side={side}
            snap="half"
            dragOffsetY={null}
            releaseVelocityY={0}
            keepMounted={keepMounted}
          >
            {open ? <button>{text}</button> : null}
          </SpringDrawer>,
        ));

        render(true, "First pub");
        const drawer = host.firstElementChild!;
        expect(drawer.hasAttribute("inert")).toBe(false);
        render(true, "Latest pub");
        render(false, "");
        expect(drawer.hasAttribute("inert")).toBe(true);
        expect(drawer.textContent).toBe("Latest pub");

        frame(0);
        expect(drawer.textContent).toBe("Latest pub");
        frame(5_000);
        expect(drawer.textContent).toBe(keepMounted ? "Latest pub" : "");
        expect(drawer.hasAttribute("inert")).toBe(true);

        render(true, "Next pub");
        expect(drawer.hasAttribute("inert")).toBe(false);
        expect(drawer.textContent).toBe("Next pub");
      });
    }
  }
});
