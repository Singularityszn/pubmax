import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ANALYTICS_EVENTS, sanitizeEvent } from "@/lib/analyticsEvents";
import { buildClientErrorReport, redactClientErrorText } from "@/lib/clientErrorReport";
import {
  LOCATION_DISCLOSURES,
  LOCATION_MANUAL_OPEN_LABEL,
  LOCATION_MANUAL_PROMPT,
  LOCATION_ROUNDING_LABEL,
  locationAreaOriginLine,
  locationDisclosureLines,
  locationOverclaimFindings,
} from "@/lib/locationDisclosure";

// Astra F01 (6 Sep 2026): /today asked for a location under "It stays on this
// page and is never saved.", then sent a rounded point to our server, which
// passed it to Transport for London. /privacy described that in full. The
// prompt and the policy were describing two different products, and the prompt
// was the one the reader was answering.

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

/** Every surface that asks a reader for their location for transport. */
const ASKING_SURFACES = [
  "app/today/TodayGetThereStrip.tsx",
  "app/tonight/TonightClient.tsx",
] as const;

const SURFACES = ["today-last-train", "tonight-walk-and-last-train"] as const;

describe("the disclosure says what actually happens", () => {
  it("names the rounding, our server, TfL and the storage answer, in that order", () => {
    for (const surface of SURFACES) {
      const lines = locationDisclosureLines(surface);
      const joined = lines.join(" ");
      expect(joined).toContain(LOCATION_ROUNDING_LABEL);
      expect(joined).toContain("send it to our server");
      expect(joined).toContain("Transport for London");
      expect(joined).toContain("do not store");
      // The storage answer is last: it only means anything after the reader has
      // been told what was sent.
      expect(lines[lines.length - 1]).toBe(LOCATION_DISCLOSURES[surface].storage);
    }
  });

  it("keeps every sentence inside the plain-instruction length", () => {
    for (const surface of SURFACES) {
      for (const line of locationDisclosureLines(surface)) {
        expect(line.split(/\s+/).length, line).toBeLessThanOrEqual(20);
      }
    }
  });

  it("refuses the claim the audit found, and passes the sentences we now print", () => {
    expect(
      locationOverclaimFindings("It stays on this page and is never saved.").map(
        (finding) => finding.id,
      ),
    ).toEqual(["never-leaves", "never-saved"]);
    expect(
      locationOverclaimFindings(
        "your rough position is used once to check your nearest station and is never saved",
      ).map((finding) => finding.id),
    ).toEqual(["never-saved"]);
    for (const surface of SURFACES) {
      expect(
        locationOverclaimFindings(locationDisclosureLines(surface).join(" ")),
      ).toEqual([]);
    }
  });

  it("is the only place the asking surfaces get their words from", () => {
    for (const file of ASKING_SURFACES) {
      const source = read(file);
      expect(source, file).toContain("@/lib/locationDisclosure");
      // The retired claims may not come back as literals in a surface file.
      expect(source.replace(/^\/\/.*$/gm, ""), file).not.toMatch(/stays? on this page/i);
      expect(source.replace(/^\/\/.*$/gm, ""), file).not.toMatch(/is never saved/i);
    }
  });
});

describe("the prompt and the policy make one claim", () => {
  const privacy = read("app/privacy/page.tsx");

  it("the policy names the routes the prompt summarises, and the same processor", () => {
    expect(privacy).toContain("/api/last-train");
    expect(privacy).toContain("/api/tfl-disruption");
    expect(privacy).toContain("Transport for London");
    expect(privacy).toMatch(/three decimal places/);
  });

  it("the policy names the way out the prompt offers", () => {
    expect(privacy).toMatch(/falls back to picking an area/i);
    expect(LOCATION_MANUAL_PROMPT).toMatch(/pick an area/i);
  });
});

describe("no coordinate leaves through another door", () => {
  it("no analytics event may carry a coordinate prop", () => {
    for (const [name, props] of Object.entries(ANALYTICS_EVENTS)) {
      for (const prop of props as readonly string[]) {
        expect(
          /^(lat|lng|lon|longitude|latitude|coords?|coordinates|point)$/i.test(prop),
          `${name}.${prop}`,
        ).toBe(false);
      }
    }
  });

  it("the sanitiser drops a coordinate somebody attaches anyway", () => {
    const event = sanitizeEvent("tonight_screen_view", {
      lat: 51.5074,
      lng: -0.1278,
    });
    expect(event).not.toBeNull();
    expect(JSON.stringify(event)).not.toContain("51.5074");
  });

  it("an error report loses the query a coordinate rides in", () => {
    const message =
      "Failed to fetch https://pubmaxxing.com/api/last-train?lat=51.507&lng=-0.128";
    const redacted = redactClientErrorText(message, 300);
    expect(redacted).not.toContain("51.507");
    expect(redacted).not.toContain("lat=");
    const report = buildClientErrorReport({
      kind: "unhandled-rejection",
      name: "TypeError",
      message,
      path: "/today",
    });
    expect(JSON.stringify(report)).not.toContain("51.507");
  });

  it("the get-there card sends its point through the shared coarsening seam only", () => {
    const source = read("app/today/TodayGetThereStrip.tsx");
    expect(source).toMatch(/coarsenViewerPoint\s*\(/);
    // The fetch is built from the coarsened pair, never from the raw fix.
    expect(source).toContain("`/api/last-train?lat=${lat}&lng=${lng}`");
    expect(source).not.toMatch(/lat=\$\{origin\.lat\}/);
  });
});

describe("nothing is asked before the reader asks", () => {
  it("geolocation is read only from a handler, never on mount", () => {
    for (const file of ASKING_SURFACES) {
      const source = read(file);
      const asks = source.match(/getCurrentPosition/g) ?? [];
      expect(asks.length, file).toBeLessThanOrEqual(1);
      if (asks.length === 0) continue;
      // The one ask sits inside the callback the button is bound to.
      const before = source.slice(0, source.indexOf("getCurrentPosition"));
      expect(before, file).toMatch(/const requestLocation = useCallback\(/);
    }
  });

  it("watchPosition is never used: one ask, not a running feed", () => {
    for (const file of ASKING_SURFACES) {
      expect(read(file), file).not.toContain("watchPosition");
    }
  });
});

describe("a refused location is not a dead end", () => {
  const strip = read("app/today/TodayGetThereStrip.tsx");

  it("offers the area path from the start and opens it on a refusal", () => {
    expect(strip).toContain("LOCATION_MANUAL_PROMPT");
    expect(strip).toContain("LOCATION_MANUAL_OPEN_LABEL");
    expect(LOCATION_MANUAL_OPEN_LABEL).toMatch(/area/i);
    expect(strip).toMatch(/areaPickerAsked \|\| locationStatus === "unavailable"/);
  });

  it("words an area answer as the area's station, never the reader's", () => {
    expect(locationAreaOriginLine("Soho")).toBe("Nearest station to Soho.");
    expect(locationAreaOriginLine("Soho")).not.toMatch(/your/i);
    expect(strip).toContain("locationAreaOriginLine");
  });

  it("the area path asks the browser for nothing at all", () => {
    // The chips set an origin from the night-patch table, which is public data.
    expect(strip).toContain("MANUAL_AREAS");
    expect(strip).toMatch(/kind: "area"/);
  });
});
