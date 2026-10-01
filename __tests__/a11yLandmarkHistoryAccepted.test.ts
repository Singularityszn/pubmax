// @vitest-environment jsdom

import { afterEach, expect, it } from "vitest";
import { focusMainLandmark } from "@/lib/a11yLandmarks";

afterEach(() => { document.body.replaceChildren(); window.history.replaceState({}, "", "/"); });

it("keeps the existing Map checkpoint when skip navigation adds main", () => {
  const checkpoint = { pubmaxMapSurface: { version: 1, stack: [] }, route: "map" };
  window.history.replaceState(checkpoint, "", "/map?drink=wine");
  const main = document.createElement("main");
  main.id = "main";
  main.scrollIntoView = () => {};
  document.body.append(main);
  expect(focusMainLandmark()).toBe(true);
  expect(document.activeElement).toBe(main);
  expect(window.location.pathname + window.location.search + window.location.hash).toBe("/map?drink=wine#main");
  expect(window.history.state).toEqual(checkpoint);
});
