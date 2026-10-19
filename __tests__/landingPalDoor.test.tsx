import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import LandingAnswerCards from "@/components/landing/LandingAnswerCards";
import { tonightAnswer, todayAnswer } from "@/lib/landingAnswers";

// Site review, 18 Oct 2026: "Pub Pal is hiding. The feature called the
// differentiator lives at /pal with almost no path to it." The homepage now
// carries one door to it under the two answers. It names no figure and no day,
// because it is a door, not an answer.

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
