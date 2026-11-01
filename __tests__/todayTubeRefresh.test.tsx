// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { PatchDisruption } from "@/lib/tflDisruption";
import { afterEach, describe, expect, it, vi } from "vitest";

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/surfaceDataCache", () => ({ loadSurfaceJson: load }));
import TodayTubeCard from "@/app/today/TodayTubeCard";

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

const INITIAL_DISRUPTION: PatchDisruption = {
  patchId: "soho",
  patchLabel: "Soho",
  lineId: "northern",
  lineName: "Northern",
  kind: "severe_delays",
  line: "Northern line severe delays",
};

describe("Today Tube refresh", () => {
  it("includes the server's disruption in the first document", () => {
    const html = renderToStaticMarkup(
      <TodayTubeCard slot="afternoon" initialDisruption={INITIAL_DISRUPTION} />,
    );
    expect(html).toContain("Northern line severe delays");
    expect(html).toContain("near Soho");
    expect(load).not.toHaveBeenCalled();
  });

  it("keeps the server's disruption while refreshing and removes it on failure", async () => {
    let failRefresh!: (result: string) => void;
    load.mockImplementation(() => new Promise(resolve => { failRefresh = resolve; }));
    const target = document.createElement("div");
    document.body.append(target);
    root = createRoot(target);
    await act(async () => root!.render(
      <TodayTubeCard slot="afternoon" initialDisruption={INITIAL_DISRUPTION} />,
    ));
    expect(document.body.textContent).toContain("Northern line severe delays");
    await act(async () => failRefresh("failed"));
    expect(document.body.textContent).not.toContain("Northern line severe delays");
  });
  it("pauses hidden-tab polling, refreshes on return and clears its timer on unmount", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    load.mockResolvedValue("network");
    const target = document.createElement("div");
    document.body.append(target);
    root = createRoot(target);
    await act(async () => root!.render(<TodayTubeCard slot="afternoon" />));
    expect(load).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("hidden");
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    expect(load).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(load).toHaveBeenCalledTimes(2);
    act(() => root!.unmount());
    root = null;
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("refreshes an open card and removes an expired disruption when the fresh read fails", async () => {
    vi.useFakeTimers();
    load.mockImplementationOnce(async (_url, _options, apply) => {
      apply({ disruption: { patchLabel: "Soho", line: "Northern line severe delays" } });
      return "network";
    }).mockResolvedValue("failed");
    const target = document.createElement("div");
    document.body.append(target);
    root = createRoot(target);
    await act(async () => root!.render(<TodayTubeCard slot="afternoon" />));
    expect(document.body.textContent).toContain("Northern line severe delays");
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    expect(load).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain("Northern line severe delays");
  });
});
