import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import TonightMapPointer from "@/components/discovery/TonightMapPointer";
import MatchGroupPrefs from "@/components/plan/MatchGroupPrefs";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));

describe("UX-01 user-facing copy", () => {
  it("describes Tonight by what a reader can find", () => {
    const markup = renderToStaticMarkup(createElement(TonightMapPointer));

    expect(markup).toContain("Browse pub quizzes, sport on screens, deals and live music across London.");
    expect(markup).not.toContain("/api/whats-on");
  });

  it("names the crew-planning purpose without its internal phase label", () => {
    const markup = renderToStaticMarkup(createElement(MatchGroupPrefs, {
      planId: "plan-1",
      memberId: "member-1",
      memberToken: "member-token",
      isHost: true,
    }));

    expect(markup).toContain("Plan together");
    expect(markup).not.toContain("Sort My Night P1");
  });
});
