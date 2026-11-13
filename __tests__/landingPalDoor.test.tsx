// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import LandingAnswerCards from "@/components/landing/LandingAnswerCards";
import { tonightAnswer, todayAnswer } from "@/lib/landingAnswers";

// Site review, 18 Oct 2026: "Pub Pal is hiding. The feature called the
// differentiator lives at /pal with almost no path to it." The homepage now
// carries one door to it under the two answers. It names no figure and no day,
// because it is a door, not an answer.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const answers = {
  today: todayAnswer(null, "Sunday 18 October"),
  tonight: tonightAnswer({ unread: false, count: 0, hypedCount: 12 }, "Sunday 18 October"),
};

describe("the homepage door to Pub Pal", () => {
  it("links to /pal under the today and tonight answers", () => {
    const html = renderToStaticMarkup(<LandingAnswerCards answers={answers} />);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["/today", "/tonight", "/pal"]);
    expect(html).toContain("Plan it with your Pub Pal");
  });

  it("carries no figure and no day of its own", () => {
    const html = renderToStaticMarkup(<LandingAnswerCards answers={answers} />);
    const door = html.slice(html.indexOf('href="/pal"'));
    const text = door.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/£|\d/);
    expect(door).not.toContain("lpAnswerTileStamp");
  });
});

describe("held landing answers", () => {
  it("keeps both answer dates through hydration and midnight until their answers change", async () => {
    const held = {
      today: todayAnswer(null, "Thursday 12 November"),
      tonight: tonightAnswer({ unread: false, count: 3 }, "Thursday 12 November"),
    };
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-12T23:59:00Z") });
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<LandingAnswerCards answers={held} />);
    document.body.append(container);
    let root: Root | undefined;
    try {
      vi.setSystemTime(new Date("2026-11-13T00:12:00Z"));
      await act(async () => {
        root = hydrateRoot(container, <LandingAnswerCards answers={held} />);
      });
      for (const href of ["/today", "/tonight"]) {
        expect(container.querySelector(`a[href="${href}"]`)?.textContent).toContain("Thursday 12 November");
      }
      expect(container.querySelector('a[href="/tonight"]')?.textContent).toContain("3 pub events");

      vi.setSystemTime(new Date("2026-11-14T00:12:00Z"));
      await act(async () => root?.render(<LandingAnswerCards answers={held} />));
      for (const href of ["/today", "/tonight"]) {
        expect(container.querySelector(`a[href="${href}"]`)?.textContent).toContain("Thursday 12 November");
      }

      const fresh = {
        today: todayAnswer(null, "Saturday 14 November"),
        tonight: tonightAnswer({ unread: false, count: 1 }, "Saturday 14 November"),
      };
      await act(async () => root?.render(<LandingAnswerCards answers={fresh} />));
      for (const href of ["/today", "/tonight"]) {
        expect(container.querySelector(`a[href="${href}"]`)?.textContent).toContain("Saturday 14 November");
      }
      expect(container.querySelector('a[href="/tonight"]')?.textContent).toContain("1 pub event");
      expect(container.textContent).not.toContain("Thursday 12 November");
    } finally {
      await act(async () => root?.unmount());
      container.remove();
      vi.useRealTimers();
    }
  });
});
