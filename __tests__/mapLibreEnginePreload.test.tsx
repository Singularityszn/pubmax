// @vitest-environment jsdom
import { act, Component, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The map documents render this beside the shell so the engine's chunk is named
// in the prerendered head. In the browser it must stay inert: it renders
// nothing, and an engine fetch that fails on a dropped connection must not take
// the map page down through an error boundary.

// Next aliases next/dynamic to its App Router loader for app/ code. Vitest
// would otherwise resolve the pages-router loader, which hands a failure to the
// loading component instead of throwing it, so the boundary case below would
// pass whatever the component did.
vi.mock("next/dynamic", async () => await import("next/dist/api/app-dynamic"));

class Catch extends Component<{ children: ReactNode; onError: (error: unknown) => void }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetModules();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.doUnmock("maplibre-gl");
});

async function renderPreload(): Promise<unknown[]> {
  const { default: MapLibreEnginePreload } = await import(
    "@/components/map/MapLibreEnginePreload"
  );
  const errors: unknown[] = [];
  await act(async () => {
    root.render(
      <Catch onError={(error) => errors.push(error)}>
        <MapLibreEnginePreload />
      </Catch>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return errors;
}

describe("MapLibreEnginePreload", () => {
  it("loads the engine and renders nothing", async () => {
    const loaded = vi.fn();
    vi.doMock("maplibre-gl", () => {
      loaded();
      return { Map: class {} };
    });

    const errors = await renderPreload();

    expect(loaded).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
    expect(container.innerHTML).toBe("");
  });

  it("settles quietly when the engine fetch fails", async () => {
    vi.doMock("maplibre-gl", () => {
      throw new Error("Failed to load chunk");
    });

    const errors = await renderPreload();

    expect(errors).toEqual([]);
    expect(container.innerHTML).toBe("");
  });
});
