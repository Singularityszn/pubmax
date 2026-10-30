// The /today greeting is ONE text node in the server HTML.
//
// Live build, 17 Oct 2026: the signed-out /today document was read as "Good
// morning ." with what looked like a blank name before the period. The name
// was never blank (`buildDayGreeting` answers a bare "Good morning" with no
// handle). The line was written as three JSX children, so the streamed server
// render put React's text separators between them:
//
//   Good morning<!-- -->. <!-- -->Saturday 17 October. ...
//
// A browser joins those, but anything reading the document's text by stripping
// markup (a crawler snippet, a link preview, a fetch-and-read agent) saw a
// space before the period. The salutation and the support line are one
// sentence pair, so they are composed as one string and ship as one node.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => null,
}));
vi.mock("@/components/nav/NowSegment", () => ({
  default: () => null,
}));
// Signed out: no handle, on the server and on the first client paint.
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => null,
}));

import TodayClient from "@/app/today/TodayClient";
import { TODAY_PINTS_DEFAULT_PATCH_ID } from "@/app/today/todayPints";
import { buildDayGreeting } from "@/lib/dayGreeting";

const MORNING = new Date("2026-10-17T08:00:00.000Z");
const DATE_LABEL = "Saturday 17 October";

function decode(markup: string): string {
  return markup.replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

function serverGreetingMarkup(): string {
  const html = renderToString(
    createElement(TodayClient, {
      dateLabel: DATE_LABEL,
      nowIso: MORNING.toISOString(),
      greeting: buildDayGreeting({
        now: MORNING,
        weather: null,
        dateLabel: DATE_LABEL,
        name: null,
      }),
      weather: null,
      weatherByArea: {},
      fact: null,
      pintsIndex: {
        [TODAY_PINTS_DEFAULT_PATCH_ID]: {
          patchId: TODAY_PINTS_DEFAULT_PATCH_ID,
          areaName: "Central London",
          rows: [],
        },
      },
      quietPint: null,
    }),
  );
  const match = html.match(/data-testid="today-greeting">([\s\S]*?)<\/span>/);
  expect(match, "the greeting line renders on the server").not.toBeNull();
  return decode(match?.[1] ?? "");
}

describe("/today signed-out greeting in the server HTML", () => {
  it("reads 'Good morning.' with no name, no separator and no space before the period", () => {
    const inner = serverGreetingMarkup();
    expect(inner).not.toContain("<!--");
    expect(inner.startsWith("Good morning. ")).toBe(true);
  });

  it("still reads as one sentence pair when the markup is stripped to text", () => {
    const stripped = serverGreetingMarkup().replace(/<[^>]*>/g, " ");
    expect(stripped).not.toMatch(/\s\./);
    expect(stripped).not.toMatch(/,\s*\./);
    expect(stripped).toContain(`Good morning. ${DATE_LABEL}.`);
  });
});
