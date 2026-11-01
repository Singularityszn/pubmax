// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import PlanTemplateRow from "@/components/plan/PlanTemplateRow";
import { mergePlanTemplateFields } from "@/lib/planComposerChipFill";
import { inferNightContext, planDietaryNeeds } from "@/lib/nightPlanning";
import { planPriceLimits } from "@/lib/planPriceLimits";
import {
  christmasCrawlInSeason,
  PLAN_TEMPLATES,
  planTemplatesFor,
  type PlanTemplate,
} from "@/lib/planTemplates";

// THE CHRISTMAS CRAWL (launch plan week 3): a template that leads the row from
// 15 November to 24 December on the London calendar, is not offered outside
// that window, and asks only for what the planner can ground. It never says a
// pub has a Christmas event, decorations or a menu.

describe("the Christmas crawl's window", () => {
  it.each([
    ["2026-11-14T23:59:59Z", false, "the last second before the window, London on GMT"],
    ["2026-11-15T00:00:00Z", true, "the first day"],
    ["2026-12-01T19:30:00Z", true, "a December evening"],
    ["2026-12-24T23:59:59Z", true, "the last day, kept"],
    ["2026-12-25T00:00:00Z", false, "Christmas Day itself"],
    ["2027-01-01T12:00:00Z", false, "New Year's Day"],
    ["2026-07-15T12:00:00Z", false, "midsummer"],
    ["2027-11-20T12:00:00Z", true, "the next year's window"],
    // London's date decides, wherever the reader's device is.
    ["2026-11-14T20:00:00-05:00", true, "still the 14th in New York, already the 15th in London"],
    ["2026-12-24T20:00:00-08:00", false, "still the 24th in Los Angeles, already Christmas Day in London"],
  ])("%s is %s (%s)", (iso, expected) => {
    expect(christmasCrawlInSeason(new Date(iso))).toBe(expected);
  });

  it("is out of season for an instant that does not parse", () => {
    expect(christmasCrawlInSeason(new Date("not a date"))).toBe(false);
  });
});

function christmas(): PlanTemplate {
  const template = planTemplatesFor(true)[0];
  if (!template) throw new Error("Expected a template");
  return template;
}

describe("the Christmas crawl template", () => {
  it("leads the row in its window and is absent outside it", () => {
    expect(christmas()).toMatchObject({ id: "christmas-crawl", label: "Christmas crawl" });
    expect(planTemplatesFor(true).slice(1)).toEqual(PLAN_TEMPLATES);
    expect(planTemplatesFor(false)).toEqual(PLAN_TEMPLATES);
    expect(planTemplatesFor(false).some((template) => template.id === "christmas-crawl")).toBe(false);
  });

  it("asks only for what the planner can ground", () => {
    const { conciergeQuery } = christmas();
    const { context } = inferNightContext(conciergeQuery);
    expect(context).toMatchObject({
      nightArea: "victoria",
      groupSize: 8,
      budget: "value",
      zeroProof: false,
      transportConstraints: [],
      foodNeeds: [],
      accessibility: [],
    });
    expect(planDietaryNeeds(conciergeQuery)).toEqual([]);
    expect(planPriceLimits(conciergeQuery)).toMatchObject({ routeBudgetPence: null, pintCeiling: null });
  });

  it("claims no Christmas event, decoration or menu for any pub", () => {
    const template = christmas();
    for (const text of [template.label, template.title, template.conciergeQuery, template.blurb]) {
      expect(text, text).not.toMatch(
        /\b(?:decorat\w*|menus?|events?|lunch|dinner|part(?:y|ies)|mulled|carols?|santa|lights|trees?|festive|crackers?|turkey|booked)\b/i,
      );
      expect(text, text).not.toMatch(/—|!/);
    }
  });

  it("keeps an area the reader already chose", () => {
    const merged = mergePlanTemplateFields({
      title: "",
      conciergeQuery: "",
      conciergeNote: "",
      template: christmas(),
      hasAcceptedGeography: true,
    });
    expect(merged.title).toBe("Christmas crawl");
    expect(merged.conciergeQuery).not.toMatch(/Victoria/);
    expect(merged.conciergeQuery).toMatch(/roomy pubs with cheap pints/);
  });
});

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderRow(at: string, onPick: (template: PlanTemplate) => void = () => undefined): Promise<string[]> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(at));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(PlanTemplateRow, { onPick })));
  return [...host.querySelectorAll("button")].map((button) => button.textContent ?? "");
}

describe("the template row", () => {
  it("leads with the Christmas crawl in the window, and hands it to the composer", async () => {
    const onPick = vi.fn();
    const labels = await renderRow("2026-12-05T18:00:00Z", onPick);
    expect(labels[0]).toBe("Christmas crawl");
    expect(labels.slice(1)).toEqual(PLAN_TEMPLATES.map((template) => template.label));
    await act(async () => host!.querySelector("button")!.click());
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "christmas-crawl" }));
  });

  it("does not offer it outside the window", async () => {
    const labels = await renderRow("2026-11-01T18:00:00Z");
    expect(labels).toEqual(PLAN_TEMPLATES.map((template) => template.label));
  });

  it("paints the evergreen row on the server, so hydration never disagrees", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-05T18:00:00Z"));
    const paint = document.createElement("div");
    paint.innerHTML = renderToStaticMarkup(createElement(PlanTemplateRow, { onPick: () => undefined }));
    expect([...paint.querySelectorAll("button")].map((button) => button.textContent)).toEqual(
      PLAN_TEMPLATES.map((template) => template.label),
    );
  });
});
