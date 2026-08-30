import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { tonightEmptyLead } from "@/lib/tonightOutListings";

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

// A control's text is read on its own, with nothing to explain it. A bare
// numeral there names no thing, so a reader takes it for broken formatting
// rather than a label: "0.0 options" beside "Step-free" shipped to production
// and read as a formatting fault. A figure earns its place in control text only
// when a unit or a currency symbol says what it counts.
//
// A dropdown row is read the same way, so the scan covers `option` as well as
// the button shapes. The chip fix alone left the desktop planner's own drinks
// dropdown still offering "0.0 options": one surface fixed, its sibling missed,
// because the fence could not see it.
//
// The scan reads the SOURCE of every app and component surface and takes the
// static text child that sits immediately before a control-shaped closing tag.
// Interpolated labels ({...}) are out of reach here and stay the owning
// surface's own fence.
const CONTROL_TAGS = ["button", "Button", "Chip", "IconButton", "option"] as const;
const CONTROL_TEXT = new RegExp(
  String.raw`>([^<>{}\n]+)</(${CONTROL_TAGS.join("|")})>`,
  "g",
);
// A decimal with no currency symbol and no leading digit in front of it.
const BARE_DECIMAL = /(?<![£$€\d])\d+\.\d+/u;
const NUMERAL_ONLY = /^[\d.,]+$/u;
const ZERO_POINT_ZERO = /(?<!\d)0[.,]0%?(?!\d)/u;
const READER_COPY_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "aria-roledescription",
  "label",
  "placeholder",
  "title",
]);

type ReaderFacingCopy = {
  text: string;
  line: number;
};

function tsxFilesIn(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      tsxFilesIn(path, found);
    } else if (path.endsWith(".tsx")) {
      found.push(path);
    }
  }
  return found;
}

function controlTextLabels(source: string): string[] {
  const labels: string[] = [];
  for (const match of source.matchAll(CONTROL_TEXT)) {
    const text = match[1].trim();
    if (text) labels.push(text);
  }
  return labels;
}

function readerFacingStaticCopy(source: string): ReaderFacingCopy[] {
  const sourceFile = ts.createSourceFile(
    "surface.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const copy: ReaderFacingCopy[] = [];
  const record = (text: string, node: ts.Node) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    copy.push({
      text: trimmed,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        .line + 1,
    });
  };

  const walk = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      record(node.getText(sourceFile), node);
    } else if (
      ts.isStringLiteralLike(node) &&
      ts.isJsxExpression(node.parent) &&
      !ts.isJsxAttribute(node.parent.parent)
    ) {
      record(node.text, node);
    } else if (
      ts.isJsxAttribute(node) &&
      READER_COPY_ATTRIBUTES.has(node.name.getText(sourceFile))
    ) {
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer)) {
        record(initializer.text, initializer);
      } else if (
        initializer &&
        ts.isJsxExpression(initializer) &&
        initializer.expression &&
        ts.isStringLiteralLike(initializer.expression)
      ) {
        record(initializer.expression.text, initializer.expression);
      }
    }
    ts.forEachChild(node, walk);
  };

  walk(sourceFile);
  return copy;
}

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
    const source = read("app/tonight/TonightListingsNotice.tsx");
    expect(source).toContain("tonightStatusLink");
    // The sentence beside that exit is the lane-scoped one, so it is asked for
    // rather than read off this file: a night both lanes answered says the city
    // is quiet, and a lane nobody asked narrows the claim to what was read.
    expect(
      tonightEmptyLead("empty", { body: { status: "ready", events: [] }, failed: false, pending: false }),
    ).toContain("quiet one tonight");
  });

  it("Today's empty picks card hands the user an exit to the map", () => {
    const source = read("app/today/TodayClient.tsx");
    expect(source).toContain("Meanwhile, the map knows the cheap pints");
  });

  it("no button or dropdown row prints a bare numeral as its label", () => {
    const offenders: string[] = [];
    for (const file of [...tsxFilesIn("app"), ...tsxFilesIn("components")]) {
      for (const label of controlTextLabels(read(file))) {
        if (NUMERAL_ONLY.test(label) || BARE_DECIMAL.test(label)) {
          offenders.push(`${file}: "${label}"`);
        }
      }
    }
    expect(offenders, "a control label must name a thing, not print a figure").toEqual([]);
  });

  it("no static reader-facing copy uses 0.0 vocabulary", () => {
    const offenders: string[] = [];
    for (const file of [...tsxFilesIn("app"), ...tsxFilesIn("components")]) {
      for (const copy of readerFacingStaticCopy(read(file))) {
        if (ZERO_POINT_ZERO.test(copy.text)) {
          offenders.push(`${file}:${copy.line}: "${copy.text}"`);
        }
      }
    }
    expect(
      offenders,
      "reader-facing copy must name alcohol-free choices in words",
    ).toEqual([]);
  });

  it("the 0.0 fence reaches accessible attributes and nested visible text", () => {
    const shipped = readerFacingStaticCopy(`
      <Link aria-label="Explore 0.0 drinks">
        <Amenity label={"0.0% beer"} />
        <span><strong>0.0</strong></span>
      </Link>
    `).map(({ text }) => text);
    expect(shipped).toEqual([
      "Explore 0.0 drinks",
      "0.0% beer",
      "0.0",
    ]);
    expect(shipped.every((text) => ZERO_POINT_ZERO.test(text))).toBe(true);
  });

  it("the bare-numeral fence catches the shape that shipped", () => {
    const shipped = controlTextLabels(
      '<Chip aria-pressed={zeroProof} onClick={toggle}>0.0 options</Chip>',
    );
    expect(shipped).toEqual(["0.0 options"]);
    expect(BARE_DECIMAL.test(shipped[0])).toBe(true);
    // A price is a figure with a unit, so it stays allowed.
    expect(BARE_DECIMAL.test("£6.00")).toBe(false);
    expect(NUMERAL_ONLY.test("Build 3-stop route")).toBe(false);
  });

  it("the fence reaches the dropdown row the chip fix missed", () => {
    const shipped = controlTextLabels(
      '<option value="zero-proof">0.0 options</option>',
    );
    expect(shipped).toEqual(["0.0 options"]);
    expect(BARE_DECIMAL.test(shipped[0])).toBe(true);
  });

  // The drinks control asks one question on two surfaces. The phone asks it with
  // a chip and the desktop planner with a dropdown row, so both have to name the
  // drink the same way or the same reader meets two answers.
  it("the phone chip and the desktop drinks row name the same drink", () => {
    const chip = read("components/plan/MobilePlanActivation.tsx");
    const composer = read("components/plan/PlanComposer.tsx");
    const account = read("components/profile/PubmaxxAccountHub.tsx");
    expect(controlTextLabels(chip)).toContain("Alcohol-free");
    expect(controlTextLabels(composer)).toContain("Alcohol-free");
    expect(controlTextLabels(account)).toContain("Prefer alcohol-free");
    for (const source of [chip, composer, account]) {
      expect(source).not.toMatch(/>0\.0 options</);
    }
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

// docs/VOICE.md house law: "No begging. No 'please try again', no 'check back
// later', no 'don't miss out'." The friction fence above holds eight named
// surfaces to that register. The 2026-08-30 voice pass swept the surfaces the
// partial audit never inspected and found two lines outside those eight: a
// shared API fallback that said "Please try again" and a price-log refusal that
// said "Try again later". Both are fixed, so the register is now held
// TREE-WIDE rather than per surface, and a reintroduction anywhere under app/,
// components/ or lib/ fails here.
//
// The scan is AST-based for the reason the em-dash law is: a comment explaining
// why we do not beg is not begging, and a regular-expression literal that
// BLOCKS a banned phrase (lib/stepOutNudge.ts, lib/cheapPintPing.ts) is the
// fence rather than the offence. Only string literals, template literals and
// JSX text are judged. The bare imperative "Try again." stays allowed: it hands
// the reader an action rather than a closed door.
const BEGGING_PHRASES = [
  "please try again",
  "check back later",
  "try again later",
  "come back later",
  "don't miss out",
  "don\u2019t miss out",
] as const;

function sourceFilesIn(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      sourceFilesIn(path, found);
    } else if (
      /\.tsx?$/.test(path) &&
      !/\.test\.tsx?$/.test(path) &&
      !/\.d\.ts$/.test(path)
    ) {
      found.push(path);
    }
  }
  return found;
}

function copyLiterals(file: string): ReaderFacingCopy[] {
  const sourceFile = ts.createSourceFile(
    file,
    read(file),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const copy: ReaderFacingCopy[] = [];
  const record = (text: string, node: ts.Node) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    copy.push({
      text: trimmed,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
    });
  };
  const walk = (node: ts.Node): void => {
    if (ts.isJsxText(node)) record(node.getText(sourceFile), node);
    else if (ts.isStringLiteralLike(node)) record(node.text, node);
    else if (ts.isTemplateExpression(node)) {
      record(node.head.text, node);
      for (const span of node.templateSpans) record(span.literal.text, node);
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return copy;
}

describe("the no-begging law (docs/VOICE.md house law)", () => {
  const files = [
    ...sourceFilesIn("app"),
    ...sourceFilesIn("components"),
    ...sourceFilesIn("lib"),
  ];

  it("scans a real spread of surfaces", () => {
    expect(files.length).toBeGreaterThan(400);
    expect(files).toContain(join("lib", "apiErrorMessage.ts"));
    expect(files).toContain(join("app", "api", "price-submit", "route.ts"));
  });

  it("no reader-facing copy begs the reader to come back or say please", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const copy of copyLiterals(file)) {
        const lowered = copy.text.toLowerCase();
        for (const phrase of BEGGING_PHRASES) {
          if (lowered.includes(phrase)) {
            offenders.push(`${file}:${copy.line}: "${copy.text}"`);
          }
        }
      }
    }
    expect(
      offenders,
      "a friction line hands the reader an action, never a closed door",
    ).toEqual([]);
  });

  it("the fence catches the two shapes that shipped", () => {
    const shipped = copyLiterals("lib/apiErrorMessage.ts").map((c) => c.text);
    expect(shipped).toContain("Something went wrong. Try again.");
    for (const text of [
      "Something went wrong. Please try again.",
      "Could not finish that price log. Try again later.",
    ]) {
      expect(
        BEGGING_PHRASES.some((phrase) => text.toLowerCase().includes(phrase)),
      ).toBe(true);
    }
    // The bare imperative is the sanctioned replacement, not an offence.
    expect(
      BEGGING_PHRASES.some((phrase) =>
        "Could not finish that price log. Try again.".toLowerCase().includes(phrase),
      ),
    ).toBe(false);
  });
});
