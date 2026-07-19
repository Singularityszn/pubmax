import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Friction-state voice fence (2026-07-19 taste sweep). Empty, denied, and
// error states are where love is won or lost (voice spec rule 5); they must
// never leak the plumbing (rule 2), slam the door ("Check back later"), or
// praise our own epistemology instead of handing the user somewhere to go.
// This reads the SOURCE of the swept surfaces so a regression fails loudly.

const SURFACES = [
  "app/tonight/TonightClient.tsx",
  "app/today/TodayClient.tsx",
  "components/PubMap.tsx",
  // Friction tail (follow-ups to the 07-19 sweep): gamer register and
  // Night-Area/Crawl-Route plumbing scrubbed from these surfaces.
  "app/og.png/route.tsx",
  "components/moment/MomentCapture.tsx",
  "components/profile/NightMemoryStudio.tsx",
  "components/pal/PalPortrait.tsx",
  "components/map/LastTrainCard.tsx",
] as const;

// Plumbing strings scrubbed from specific files by the friction tail; each is
// pinned to its file because "Night Area" legitimately survives in code
// comments elsewhere (the fence reads raw source, comments included).
const SCRUBBED: ReadonlyArray<{ file: string; phrase: string }> = [
  { file: "components/plan/PlanComposer.tsx", phrase: "this Night Area" },
  { file: "components/plan/PlanComposer.tsx", phrase: "Crawl Route" },
  { file: "components/plan/PlanComposer.tsx", phrase: "Night Area coverage" },
  { file: "components/plan/MobilePlanActivation.tsx", phrase: "<label>Night Area" },
  { file: "components/night/NightAreaCoverage.tsx", phrase: "evidence gate is live" },
  { file: "components/night/NightModeCard.tsx", phrase: "this Night Area still need review" },
];

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

describe("friction-state voice fence", () => {
  // Registers that must never return to these surfaces. "the upstream" is the
  // voice spec's own named offender (word-pair #5); the rest are the door-slam
  // and navel-gazing lines the 07-19 sweep removed.
  const banned = [
    "the upstream",
    "Grant access and try again",
    "Check back later",
    "rather show nothing",
    "fresh enough to trust",
    // Voice spec rule 3's named gamer register (word-pair #7), scrubbed
    // tree-wide by the friction tail.
    "side quest",
    "Side quest",
  ];

  for (const file of SURFACES) {
    it(`${file} carries no banned friction register`, () => {
      const source = read(file);
      for (const phrase of banned) {
        expect(source.includes(phrase), `"${phrase}" found in ${file}`).toBe(false);
      }
    });
  }

  for (const { file, phrase } of SCRUBBED) {
    it(`${file} no longer carries "${phrase}"`, () => {
      expect(read(file).includes(phrase), `"${phrase}" returned to ${file}`).toBe(false);
    });
  }

  it("Tonight's empty night hands the user an exit to the map", () => {
    const source = read("app/tonight/TonightClient.tsx");
    expect(source).toContain("tonightStatusLink");
    expect(source.includes("quiet one tonight")).toBe(true);
  });

  it("Today's empty picks card hands the user an exit to the map", () => {
    const source = read("app/today/TodayClient.tsx");
    expect(source).toContain("Meanwhile, the map knows the cheap pints");
  });

  it("the swept replacement copy stays em-dash free", () => {
    for (const file of SURFACES) {
      const source = read(file);
      const strings = source.match(/"[^"\n]*"/g) ?? [];
      for (const literal of strings) {
        expect(literal.includes("—"), `em dash in ${file} literal ${literal}`).toBe(false);
      }
    }
  });
});
