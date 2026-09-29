// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useLogIntent } from "@/components/map/pubmap/useLogIntent";

type IntentProps = Parameters<typeof useLogIntent>[0];

function Harness(props: IntentProps) {
  useLogIntent(props);
  return null;
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it.each([false, true])("keeps search open until venue selection, category intent: %s", async (category) => {
  const props: IntentProps = {
    hasLogIntent: !category,
    hasCategoryPriceIntent: category,
    loaded: false,
    firstFilteredVenueId: "first",
    firstRouteId: "first",
    selectedVenueId: "",
    selectedVenueResolvable: false,
    selectedVenueIsPub: false,
    selectVenue: vi.fn(),
    openComposerForLog: vi.fn(),
    setFallbackVisible: vi.fn(),
  };
  const render = async (changes: Partial<IntentProps>) => {
    Object.assign(props, changes);
    await act(async () => root.render(createElement(Harness, { ...props })));
  };

  await render({});
  expect(props.setFallbackVisible).not.toHaveBeenCalled();
  await render({ loaded: true });
  expect(props.setFallbackVisible).toHaveBeenCalledExactlyOnceWith(true);
  vi.mocked(props.setFallbackVisible).mockClear();

  await render({ firstFilteredVenueId: "second", firstRouteId: "second" });
  await render({ firstFilteredVenueId: "", firstRouteId: "" });
  await render({ selectedVenueId: "chosen" });
  expect(props.setFallbackVisible).not.toHaveBeenCalled();
  expect(props.openComposerForLog).not.toHaveBeenCalled();

  await render({ selectedVenueResolvable: true, selectedVenueIsPub: true });
  expect(props.setFallbackVisible).toHaveBeenCalledExactlyOnceWith(false);
  expect(props.openComposerForLog).toHaveBeenCalledTimes(category ? 0 : 1);
  expect(props.selectVenue).toHaveBeenCalledTimes(category ? 0 : 1);
  if (!category) expect(props.selectVenue).toHaveBeenCalledWith("chosen");

  await render({ firstFilteredVenueId: "third" });
  expect(props.openComposerForLog).toHaveBeenCalledTimes(category ? 0 : 1);
  await render({ hasLogIntent: false, hasCategoryPriceIntent: false });
  vi.mocked(props.setFallbackVisible).mockClear();
  await render({
    hasLogIntent: !category,
    hasCategoryPriceIntent: category,
    selectedVenueId: "",
    selectedVenueResolvable: false,
    selectedVenueIsPub: false,
  });
  expect(props.setFallbackVisible).toHaveBeenCalledExactlyOnceWith(true);
});
