// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import SheetStepProgress from "@/components/ui/sheetStepProgress";

function renderRail(steps: Parameters<typeof SheetStepProgress>[0]["steps"]): HTMLOListElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(SheetStepProgress, { steps }));
  return host.querySelector("ol")!;
}

describe("SheetStepProgress", () => {
  it("renders one segment per step with aria-current on the active one", () => {
    const rail = renderRail([
      { label: "Area", state: "settled" },
      { label: "Time", state: "settled" },
      { label: "Group", state: "settled" },
      { label: "Budget", state: "settled" },
      { label: "Access", state: "settled" },
      { label: "Extra", state: "current" },
    ]);
    const segments = [...rail.querySelectorAll("li")];
    expect(segments).toHaveLength(6);
    expect(segments.filter((segment) => segment.getAttribute("aria-current") === "step")).toEqual([
      segments[5],
    ]);
  });

  it("checks an answered step and keeps a skipped step's number and disclosure", () => {
    const rail = renderRail([
      { label: "Area", state: "skipped" },
      { label: "Time", state: "settled" },
      { label: "Group", state: "current" },
      { label: "Budget", state: "upcoming" },
    ]);
    const [area, time, group, budget] = [...rail.querySelectorAll("li")];

    expect(area!.dataset.state).toBe("skipped");
    expect(area!.querySelector(".sheetStepProgress__marker")!.textContent).toBe("1");
    expect(area!.querySelector(".sheetStepProgress__label")!.textContent).toBe("Area skipped");

    expect(time!.dataset.state).toBe("settled");
    expect(time!.querySelector(".sheetStepProgress__marker svg")).not.toBeNull();
    expect(time!.querySelector(".sheetStepProgress__label")!.textContent).toBe("Time");

    expect(group!.querySelector(".sheetStepProgress__marker")!.textContent).toBe("3");
    expect(budget!.dataset.state).toBe("upcoming");
    expect(budget!.querySelector(".sheetStepProgress__marker")!.textContent).toBe("4");
  });
});
