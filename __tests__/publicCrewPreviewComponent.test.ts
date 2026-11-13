import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PublicCrewPreview from "@/components/social/PublicCrewPreview";

const preview = {
  kind: "public" as const,
  crewId: "50000000-0000-4000-8000-000000000001",
  title: "Friday in Camden",
  hostHandle: "host",
  startsAt: "2026-08-23T18:30:00.000Z",
  meetingPoint: {
    kind: "venue" as const,
    name: "Camden Arms",
    lat: 51.541,
    lng: -0.142,
  },
  area: null,
  placesLeft: null,
  spendBand: null,
};

describe("public Open Crew preview", () => {
  it("shows meeting point, host, start, and one join action", () => {
    const html = renderToStaticMarkup(
      createElement(PublicCrewPreview, {
        preview,
        joinState: "none",
        busy: false,
        problem: "",
        onAskToJoin: () => {},
      }),
    );

    expect(html).toContain("Friday in Camden");
    expect(html).toContain("@host");
    expect(html).toContain("Camden Arms");
    expect(html).toContain('>Ask to join<');
    expect(html).not.toContain("memberCount");
    expect(html).not.toContain("Who is in");
  });

  it("prints the area, places left and price band the link preview prints", () => {
    const html = renderToStaticMarkup(
      createElement(PublicCrewPreview, {
        preview: {
          ...preview,
          area: { name: "Camden Town", relation: "inside" as const },
          placesLeft: 3,
          spendBand: { minGbp: 4.5, maxGbp: 6.2, observedOn: "2026-11-03", sourceKind: "listed" },
        },
        joinState: "none",
        busy: false,
        problem: "",
        onAskToJoin: () => {},
      }),
    );

    expect(html).toContain("Camden Arms · in Camden Town");
    expect(html).toContain("3 places left · £4.50–£6.20 per pint, listed prices seen 3 Nov 2026");
  });

  it("replaces join action with deterministic request state", () => {
    const html = renderToStaticMarkup(
      createElement(PublicCrewPreview, {
        preview,
        joinState: "pending",
        busy: false,
        problem: "",
        onAskToJoin: () => {},
      }),
    );

    expect(html).toContain("Request sent. The host decides.");
    expect(html).not.toContain("Ask to join");
  });

  it("a one-pub night counts the rows it was given and asks I'll be there", () => {
    const html = renderToStaticMarkup(
      createElement(PublicCrewPreview, {
        preview: {
          ...preview,
          placesLeft: 3,
          spendBand: { minGbp: 4.5, maxGbp: 6.2, observedOn: "2026-11-03", sourceKind: "listed" },
          stillTrue: {
            saidYes: 2,
            markedHere: 1,
            listedPint: {
              drink: "Lager",
              priceGbp: 6.2,
              source: "pint-prices.com",
              readOn: "2026-08-20",
            },
          },
        },
        joinState: "none",
        busy: false,
        problem: "",
        onAskToJoin: () => {},
      }),
    );

    expect(html).toContain("I&#x27;ll be there");
    expect(html).toContain("2 said yes.");
    expect(html).toContain("1 marked here.");
    expect(html).toContain("Lager listed £6.20. pint-prices.com, read 20 August 2026.");
    expect(html).toContain("Buy your own. When the pint lands, log what you paid.");
    expect(html).not.toContain("Ask to join");
    expect(html).not.toContain("places left");
    expect(html).not.toContain("£4.50");
    expect(html.toLowerCase()).not.toContain("save me a seat");
    expect(html.toLowerCase()).not.toContain("confirmed");
  });

  it("an empty one-pub night says nobody has said yes, and writes no zero", () => {
    const html = renderToStaticMarkup(
      createElement(PublicCrewPreview, {
        preview: {
          ...preview,
          stillTrue: { saidYes: 0, markedHere: 0, listedPint: null },
        },
        joinState: "none",
        busy: false,
        problem: "",
        onAskToJoin: () => {},
      }),
    );

    expect(html).toContain("Nobody has said yes yet.");
    expect(html).not.toContain("You said yes. The host decides.");
    expect(html).not.toContain("0 said yes");
    expect(html).not.toContain("0 marked here");
    expect(html).not.toContain("Request sent. The host decides.");
  });
});
