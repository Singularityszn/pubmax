import { beforeEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => [] as string[]);
vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.resetModules();
  loaded.length = 0;
  vi.doMock("@/app/plan/plan.css", () => { loaded.push("entry"); return {}; });
  vi.doMock("@/app/plan/planFull.css", () => { loaded.push("full"); return {}; });
});

describe("executed Plan stylesheet imports", () => {
  it("loads only shared styling when the fresh entry module opens", async () => {
    const page = await import("@/app/plan/page");
    expect(typeof page.default).toBe("function");
    expect(loaded).toEqual(["entry"]);
  });

  it("loads full styling with the intent-loaded composer", async () => {
    const composer = await import("@/components/plan/PlanComposer");
    expect(typeof composer.default).toBe("function");
    expect(loaded).toEqual(["full"]);
  });

  it.each([
    () => import("@/app/plan/[id]/page"),
    () => import("@/app/plan/[id]/not-found"),
    () => import("@/app/plan/[id]/recap/page"),
    () => import("@/app/recap/[storyId]/page"),
  ])("loads the canonical full styling for result consumer %$", async (load) => {
    const page = await load();
    expect(typeof page.default).toBe("function");
    expect(loaded).toEqual(["full"]);
  });
});
