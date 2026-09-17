// @vitest-environment jsdom

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import YourContributionsCard from "@/components/profile/YourContributionsCard";
import type { ContributionSummary } from "@/lib/pintContributions";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => createElement("a", { href, ...props }, children),
}));

const ROOT = join(__dirname, "..");

// The account Astra ended the 5 Sep battle test with: one price logged, on one
// day, in one borough. This is the exact shape that printed "1-day mapping
// streak" on the You card.
const ONE_NIGHT: ContributionSummary = {
  handle: "astrascout83327",
  pintsMapped: 1,
  total: 1,
  streak: { current: 1, longest: 1, activeDays: 1, lastDay: "2026-09-06" },
  byBorough: [{ borough: "City of London", count: 1 }],
};

let host: HTMLElement;
let root: Root;

function mountCard(claimNudge = false): Promise<void> {
  return act(async () => {
    root.render(
      createElement(YourContributionsCard, { handle: ONE_NIGHT.handle, claimNudge }),
    );
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ stats: ONE_NIGHT }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the You card counts what you mapped, never days running", () => {
  it("prints no streak over an account that logged one price", async () => {
    await mountCard();

    // What the reader saw on 6 Sep 2026, and may not see again.
    expect(host.textContent).not.toMatch(/streak/i);
    expect(host.textContent).not.toContain("1-day mapping");
    expect(host.querySelector(".contribStreak")).toBeNull();
    expect(host.querySelector(".contribStreakLabel")).toBeNull();
  });

  it("keeps the counts the card is for", async () => {
    await mountCard();

    expect(host.textContent).toContain("Your contributions");
    expect(host.textContent).toContain("pint mapped");
    expect(host.textContent).toContain("borough");
    expect(host.textContent).toContain("City of London");
    expect(host.querySelector(".contribRecordLink")).not.toBeNull();
  });

  it("offers the account without naming a streak to keep", async () => {
    await mountCard(true);

    const nudge = host.querySelector(".contribNudge");
    expect(nudge?.textContent).toContain("Claim your @handle");
    expect(nudge?.textContent).not.toMatch(/streak/i);
  });

  it("leaves no streak wording in the card or its stylesheet", () => {
    // A rendered absence proves this run; the source fence proves the next
    // person cannot put the block back without reading this test.
    for (const file of [
      "components/profile/YourContributionsCard.tsx",
      "components/profile/yourContributionsCard.module.css",
    ]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      // The word survives only in the comments that say why it is gone, so
      // both comment forms come out before the sweep.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toMatch(/streakLabel|contribStreak|mapping streak|day streak/);
    }
  });
});
