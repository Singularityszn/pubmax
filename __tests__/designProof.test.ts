// The design proof command (scripts/design-proof.mjs, `npm run proof:design`):
// one run shoots every named page at the phone and the desktop width, light
// and dark, and lays the shots out on one contact sheet. Design plan step 0.4:
// every design pull request attaches that sheet. These pins hold the plan the
// command runs, without a browser or an image library.

import { describe, expect, it } from "vitest";

import {
  contactSheetColumns,
  contactSheetLayout,
  designProofShots,
  DESIGN_PROOF_VIEWPORTS,
  parseDesignProofArgs,
  parseProofPage,
  proofShotFile,
  THEME_STORAGE_KEY,
} from "../scripts/lib/designProof.mjs";
import { THEME_STORAGE_KEY as APP_THEME_STORAGE_KEY } from "@/lib/themePreference";

describe("what one run shoots", () => {
  it("shoots the phone at 390x844 at two pixels per point, and the desktop at 1440x900", () => {
    expect(DESIGN_PROOF_VIEWPORTS.map(({ key, width, height, deviceScaleFactor, isMobile }) => ({
      key, width, height, deviceScaleFactor, isMobile,
    }))).toEqual([
      { key: "390", width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
      { key: "1440", width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
    ]);
  });

  it("chooses the theme the way a reader does, by the app's own stored preference", () => {
    expect(THEME_STORAGE_KEY).toBe(APP_THEME_STORAGE_KEY);
  });

  it("takes every page at both widths in both themes, one file each", () => {
    const shots = designProofShots([
      { name: "home", path: "/" },
      { name: "pub", path: "/pubs/venue-cbqtvi" },
    ]);
    expect(shots.map((shot) => shot.file)).toEqual([
      "home-390-light.png",
      "home-390-dark.png",
      "home-1440-light.png",
      "home-1440-dark.png",
      "pub-390-light.png",
      "pub-390-dark.png",
      "pub-1440-light.png",
      "pub-1440-dark.png",
    ]);
    expect(proofShotFile("tonight", "390", "dark")).toBe("tonight-390-dark.png");
  });
});

describe("the command line", () => {
  it("reads named pages, a running server and the folders", () => {
    expect(
      parseDesignProofArgs([
        "--base-url", "http://127.0.0.1:4438/",
        "--page", "home=/",
        "--page", "pub=/pubs/venue-cbqtvi?tab=prices",
        "--out", "artifacts/design-proof/after",
        "--before", "artifacts/design-proof/before",
        "--full-page",
      ]),
    ).toEqual({
      baseUrl: "http://127.0.0.1:4438",
      start: false,
      port: null,
      outDir: "artifacts/design-proof/after",
      before: "artifacts/design-proof/before",
      fullPage: true,
      settleMs: 500,
      pages: [
        { name: "home", path: "/" },
        { name: "pub", path: "/pubs/venue-cbqtvi?tab=prices" },
      ],
    });
  });

  it("can serve the build itself on a private port", () => {
    expect(parseDesignProofArgs(["--start", "--port", "4438", "--page", "home=/"])).toMatchObject({
      start: true,
      port: 4438,
      baseUrl: null,
    });
  });

  it("refuses a run it cannot do honestly, rather than guessing", () => {
    expect(() => parseDesignProofArgs(["--base-url", "http://127.0.0.1:4438"])).toThrow(/at least one --page/);
    expect(() => parseDesignProofArgs(["--page", "home=/"])).toThrow(/exactly one of --base-url and --start/);
    expect(() =>
      parseDesignProofArgs(["--start", "--base-url", "http://127.0.0.1:4438", "--page", "home=/"]),
    ).toThrow(/exactly one/);
    expect(() => parseDesignProofArgs(["--base-url", "http://127.0.0.1:4438", "--page", "a=/", "--page", "a=/x"]))
      .toThrow(/used twice/);
    expect(() => parseDesignProofArgs(["--base-url", "http://127.0.0.1:4438/map", "--page", "a=/"])).toThrow(/origin/);
    expect(() => parseDesignProofArgs(["--base-url", "http://x", "--port", "4438", "--page", "a=/"])).toThrow(/--start/);
    expect(() => parseDesignProofArgs(["--base-url", "http://x", "--page", "a=/", "--settle-ms", "-1"])).toThrow(/positive/);
    expect(() => parseDesignProofArgs(["--base-url", "http://x", "--page", "a=/", "--shoot-it-all"])).toThrow(/unknown option/);
    expect(() => parseDesignProofArgs(["--base-url", "http://x", "--page"])).toThrow(/needs a value/);
  });

  it("names a page by a short slug and a path on the server under proof", () => {
    expect(parseProofPage("pub-full=/pubs/venue-1")).toEqual({ name: "pub-full", path: "/pubs/venue-1" });
    expect(() => parseProofPage("/pubs/venue-1")).toThrow(/name=\/path/);
    expect(() => parseProofPage("Pub Page=/")).toThrow(/slug/);
    expect(() => parseProofPage("pub=https://example.com/")).toThrow(/path on the server/);
    expect(() => parseProofPage("pub=//example.com/")).toThrow(/path on the server/);
  });
});

describe("the contact sheet", () => {
  const phone = { width: 780, height: 1688 };
  const desktop = { width: 1440, height: 900 };

  it("has one column per width and theme, in shot order", () => {
    expect(contactSheetColumns().map((column) => [column.label, column.width])).toEqual([
      ["390 light", 390],
      ["390 dark", 390],
      ["1440 light", 720],
      ["1440 dark", 720],
    ]);
  });

  it("puts a before row above an after row, each tile scaled to its column", () => {
    const layout = contactSheetLayout([
      { label: "pub /pubs/x: before", tiles: [phone, phone, desktop, desktop] },
      { label: "pub /pubs/x: after", tiles: [phone, phone, desktop, desktop] },
    ]);
    expect(layout.width).toBe(16 + 390 + 16 + 390 + 16 + 720 + 16 + 720 + 16);
    const [before, after] = [layout.placements.slice(0, 4), layout.placements.slice(4)];
    expect(before.map(({ x, width, height }) => [x, width, height])).toEqual([
      [16, 390, 844],
      [422, 390, 844],
      [828, 720, 450],
      [1564, 720, 450],
    ]);
    // The after row starts below the tallest tile of the before row.
    expect(after[0]!.y).toBe(before[0]!.y + 844 + 16 + 36);
    expect(layout.labels.map((label) => label.text)).toEqual([
      "390 light",
      "390 dark",
      "1440 light",
      "1440 dark",
      "pub /pubs/x: before",
      "pub /pubs/x: after",
    ]);
  });

  it("cuts a long page at the tile ceiling and says so, and keeps a missing shot's cell empty", () => {
    const layout = contactSheetLayout(
      [{ label: "home /", tiles: [{ width: 780, height: 12_000 }, null, desktop, desktop] }],
      { maxTileHeight: 1800 },
    );
    expect(layout.placements.map(({ column, height, cropped }) => [column, height, cropped])).toEqual([
      [0, 1800, true],
      [2, 450, false],
      [3, 450, false],
    ]);
  });
});
