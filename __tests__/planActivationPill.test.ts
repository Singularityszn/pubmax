import { describe, expect, it } from "vitest";

import { DESCRIBE_OUTING_LABEL, planActivationPill } from "@/lib/planActivationPill";

// verify-preview-4, J04 (5 Sep 2026): after ONE "Plan stop" the phone pill read
// "6-stop plan · Edit route", because the tap mapped the suggested six-stop
// route rather than the pub the reader had picked. The pill names what the
// reader has in hand, in this order: the crawl being built, then a mapped or
// tonight route, then the invitation.

describe("planActivationPill", () => {
  it("names the crawl being built ahead of any mapped route", () => {
    expect(planActivationPill({ planActive: false, planStopCount: 0, builtStopCount: 1 })).toEqual({
      active: true,
      strong: "1 stop picked",
      small: "Add stops",
      label: "Edit your crawl, 1 stop picked",
    });
    expect(planActivationPill({ planActive: true, planStopCount: 6, builtStopCount: 2 }).strong).toBe(
      "2 stops picked",
    );
  });

  it("names a mapped route or tonight's plan by its stop count", () => {
    expect(planActivationPill({ planActive: true, planStopCount: 3, builtStopCount: 0 })).toEqual({
      active: true,
      strong: "3-stop plan",
      small: "Edit route",
      label: "Edit active 3-stop plan",
    });
  });

  it("invites a description when nothing is in hand", () => {
    expect(planActivationPill({ planActive: false, planStopCount: 0, builtStopCount: 0 })).toEqual({
      active: false,
      strong: DESCRIBE_OUTING_LABEL,
      small: null,
      label: DESCRIBE_OUTING_LABEL,
    });
  });
});
