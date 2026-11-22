import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav"),
}));

vi.mock("@/components/plan/PlanComposer", () => ({
  default: () => createElement("form"),
}));

vi.mock("@/app/plan/planStarter.server", () => ({ prerenderedPlanStarter: async () => null }));

import NewPlanPage from "@/app/plan/page";

describe("new plan entry surface", () => {
  it("renders one planner entry owner", async () => {
    const markup = renderToStaticMarkup(await NewPlanPage());

    expect(markup.match(/<form(?:\s|>)/g) ?? []).toHaveLength(1);
  });
});
