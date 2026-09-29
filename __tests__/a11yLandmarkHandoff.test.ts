// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { focusMainLandmark, restoreMainLandmarkFocus } from "@/lib/a11yLandmarks";

beforeEach(() => {
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/map");
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("skip-link navigation", () => {
  it("preserves the map history checkpoint when adding the main fragment", () => {
    const heldState = {
      pubmaxMapSurface: { version: 1, stack: [] },
      route: "map",
    };
    window.history.replaceState(heldState, "", "/map?drink=wine");
    const main = document.createElement("main");
    main.id = "main";
    main.scrollIntoView = () => {};
    document.body.append(main);

    expect(focusMainLandmark()).toBe(true);

    expect(document.activeElement).toBe(main);
    expect(window.location.pathname + window.location.search + window.location.hash)
      .toBe("/map?drink=wine#main");
    expect(window.history.state).toEqual(heldState);
  });

  it("carries focus from a removed loading main onto its replacement", () => {
    const loadingMain = document.createElement("main");
    loadingMain.id = "main";
    loadingMain.scrollIntoView = () => {};
    document.body.append(loadingMain);
    focusMainLandmark();
    expect(document.activeElement).toBe(loadingMain);
    loadingMain.remove();

    const liveMain = document.createElement("main");
    liveMain.id = "main";
    liveMain.scrollIntoView = () => {};
    document.body.append(liveMain);
    restoreMainLandmarkFocus();

    expect(document.activeElement).toBe(liveMain);
  });

  it("keeps focus that the reader has moved to another control", () => {
    window.history.replaceState({}, "", "/map#main");
    const main = document.createElement("main");
    main.id = "main";
    const input = document.createElement("input");
    main.append(input);
    document.body.append(main);
    input.focus();

    restoreMainLandmarkFocus();

    expect(document.activeElement).toBe(input);
  });

  it("does not move focus for an arrival without the main fragment", () => {
    const main = document.createElement("main");
    main.id = "main";
    document.body.append(main);

    restoreMainLandmarkFocus();

    expect(document.activeElement).toBe(document.body);
  });
});
