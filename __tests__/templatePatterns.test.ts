import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// THE TEMPLATE-PATTERN BAN  (docs/VOICE.md · "Template patterns")
//
// Captain, 3 Sep 2026: "I don't want AI slop; remove anything that looks AI
// generated." The tells are structural, not a matter of taste, so this fence
// reads the SOURCE of every component and fails on nine shapes a template
// generator reaches for and a person at the bar never asked for:
//
//   orbit-or-scanline      decorative rings and hairlines drifting behind copy
//   glass-blur             backdrop-filter blur outside sheet and floating chrome
//   dot-grid               a blueprint dot grid painted under a section
//   numbered-icon-triplet  01 / 02 / 03 with an icon each
//   hedge-copy             "whether you're", "we believe", "look no further"
//   emoji-bullet           a line that opens with an emoji, the star rating
//                          glyph excepted: it is the rating, not a bullet
//   card-in-card           a card whose child is another card
//   three-column-grid      repeat(3, ...) or 1fr 1fr 1fr of identical cells
//   gamified-level         Level N, mastery points, XP
//
// CSS is read as text with comments stripped. TSX and TS are read through the
// TypeScript AST: copy is a string literal, a template literal or JSX text,
// never a comment, never a className, never a module specifier. So a comment
// ABOUT a banned phrase is not an offence, and the regex that blocks one is
// not an offence either.
//
// PENDING_REMOVAL is the documented backlog: every entry names the file, the
// pattern and the PR that owns the removal. The list may only shrink. A stale
// entry, one whose offence is gone, fails too, so nobody can leave a door
// propped open by accident.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const SCOPE = join(ROOT, "components");

type Pattern =
  | "orbit-or-scanline"
  | "glass-blur"
  | "dot-grid"
  | "numbered-icon-triplet"
  | "hedge-copy"
  | "emoji-bullet"
  | "card-in-card"
  | "three-column-grid"
  | "gamified-level";

type Finding = { file: string; pattern: Pattern; detail: string };

/**
 * Translucency has one functional home: the sheet material over the map and
 * the narrow floating chrome docs/DESIGN_SYSTEM.md "Sheet material" names.
 * Those lanes may blur; a marketing section may not.
 */
const FUNCTIONAL_TRANSLUCENCY = [
  "components/map/",
  "components/mobile/",
  "components/nav/",
  "components/ui/sheet",
  "components/ui/surfaceNav",
  // Overlays and floating chrome, each inspected: the blur sits on a backdrop
  // or a control that floats over content, never on a section of the page.
  "components/auth/arrivalWelcome.css", // polite live region floating over the page
  "components/command/commandPalette.css", // palette backdrop
  "components/feed/cheersButton.css", // a control on a photo scrim
  "components/identity/accountOnboarding.css", // dialog backdrop
  "components/identity/contributionGate.css", // dialog backdrop
  "components/pal/palChat.css", // floating composer bar
  "components/plan/planTuneSheet.css", // the Plan result's settings sheet: the sheet material
  "components/pubpal/pubPal.css", // the Pal summon control floating over the map
  "components/pubs/pubsGallery.css", // lightbox chrome over a photo
];

/**
 * A three-column row of BUTTONS, CHIPS, PHOTOS or FIGURES is a control or a
 * gallery, not three identical content cells with an icon, a title and a
 * sentence each. Each file here was read; each row is one of those.
 */
const THREE_COLUMN_CONTROLS = [
  "components/drink-wall/drinkWall.css", // photo grid
  "components/map/mapExperienceLens.css", // lens option buttons
  "components/mobile/mobileMapShell.css", // drink shape chips
  "components/moment/moment.css", // decorator action buttons
  "components/night/routeEndingCard.css", // three ending choices
  "components/venue/venuePhotoWall.css", // photo grid
  "components/visits/visitReports.css", // observation chips
  "components/zones/zonePintIndex.css", // a stat row
];

const HEDGE_PHRASES = [
  "whether you're",
  "whether you are",
  "look no further",
  "we believe",
  "our mission",
  "on a mission",
  "we're passionate",
  "passionate about",
  "designed to help",
  "more than just",
  "not just a",
  "in today's",
  "at its core",
  "next level",
  "game-changer",
  "game changer",
  "seamless",
  "effortless",
  "elevate",
];

/**
 * The backlog. Each row is a file, the pattern it still carries, and the PR
 * that takes it out. Delete the row in that PR.
 */
const PENDING_REMOVAL: ReadonlyArray<{ file: string; pattern: Pattern; owner: string }> = [
];

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.(?:tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

export function cssFindings(rel: string, raw: string): Finding[] {
  const css = stripCssComments(raw);
  const out: Finding[] = [];
  const hit = (pattern: Pattern, re: RegExp) => {
    const m = css.match(re);
    if (m) out.push({ file: rel, pattern, detail: m[0].slice(0, 60) });
  };
  hit("orbit-or-scanline", /orbit|scanline/i);
  if (!FUNCTIONAL_TRANSLUCENCY.some((lane) => rel.startsWith(lane))) {
    hit("glass-blur", /backdrop-filter\s*:\s*[^;]*blur\(/i);
  }
  hit("dot-grid", /radial-gradient\(\s*circle\s+at\s+[\d.]+px\s+[\d.]+px/i);
  if (!THREE_COLUMN_CONTROLS.includes(rel)) {
    hit(
      "three-column-grid",
      /grid-template-columns\s*:\s*(?:repeat\(\s*3\s*,\s*(?:1fr|minmax\([^)]*\))\s*\)|1fr\s+1fr\s+1fr)\s*[;}]/,
    );
  }
  return out;
}

// Attributes whose value a reader sees. Every other attribute is plumbing.
const COPY_ATTRIBUTES = new Set(["alt", "aria-label", "aria-description", "title", "placeholder", "label"]);

function isModuleSpecifier(node: ts.StringLiteralLike): boolean {
  const p = node.parent;
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return p.moduleSpecifier === node;
  if (ts.isCallExpression(p) && p.arguments[0] === node) {
    const ex = p.expression;
    return (
      (ts.isIdentifier(ex) && ex.text === "require") ||
      ex.kind === ts.SyntaxKind.ImportKeyword
    );
  }
  return false;
}

/** A string sitting in a JSX attribute a reader never sees, or a plumbing property. */
function isPlumbingString(node: ts.Node): boolean {
  let p: ts.Node | undefined = node.parent;
  if (p && ts.isJsxExpression(p)) p = p.parent;
  if (p && ts.isJsxAttribute(p)) {
    const name = p.name.getText();
    return !COPY_ATTRIBUTES.has(name);
  }
  if (p && ts.isPropertyAssignment(p)) {
    const keyName = p.name.getText().replace(/["']/g, "");
    return /^(className|class|href|src|id|key|to|path|route|kind|status|variant|tone|icon|name|type|value)$/.test(keyName);
  }
  return false;
}

type Copy = { text: string; line: number };

function collectCopy(source: ts.SourceFile): Copy[] {
  const out: Copy[] = [];
  const push = (node: ts.Node, text: string) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    out.push({ text, line });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      if (node.text.trim()) push(node, node.text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isModuleSpecifier(node) && !isPlumbingString(node)) push(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      if (!isPlumbingString(node)) {
        push(node, [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" "));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function classNameOf(element: ts.JsxOpeningLikeElement): string | null {
  for (const attr of element.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || attr.name.getText() !== "className" || !attr.initializer) continue;
    if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
    if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      const ex = attr.initializer.expression;
      if (ts.isStringLiteral(ex) || ts.isNoSubstitutionTemplateLiteral(ex)) return ex.text;
      if (ts.isTemplateExpression(ex)) return ex.head.text + ex.templateSpans.map((s) => s.literal.text).join(" ");
    }
    return null;
  }
  return null;
}

/**
 * A class token that NAMES a card: `dropStripCard`, `feedCard`, `card`. A part
 * of a card (`nightCard__head`, `feedCardActions`) is not a second card, so
 * the token has to end in "card".
 */
function namesCard(className: string): boolean {
  return className.split(/\s+/).some((token) => /(?:^|[a-z0-9_-])[Cc]ard$/.test(token) || token === "card");
}

/** A card element (by class name) with a card element somewhere inside it. */
function cardInCard(source: ts.SourceFile): Copy[] {
  const out: Copy[] = [];
  const visit = (node: ts.Node, insideCard: string | null) => {
    let here = insideCard;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const cls = classNameOf(opening);
      if (cls && namesCard(cls)) {
        if (insideCard) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          out.push({ text: `${insideCard} > ${cls}`, line });
        }
        here = cls;
      }
    }
    ts.forEachChild(node, (child) => visit(child, here));
  };
  visit(source, null);
  return out;
}

const EMOJI_BULLET = /^\s*\p{Extended_Pictographic}/u;
/**
 * A RATING GLYPH IS NOT A BULLET.
 *
 * U+2605 BLACK STAR is Extended_Pictographic, so the drink star rating
 * (components/ratings) and the garden card's rating readout both opened a copy
 * string with one and read as emoji bullets. They are neither decoration nor a
 * list marker: they ARE the rating, drawn as glyphs, and the same star is the
 * one ios/AGENTS.md already names as out of the store-review fence's way. A
 * string whose only non-space characters are stars is that glyph; an emoji
 * followed by words is still an offence.
 */
const RATING_GLYPH = /^[\s★☆]+$/u;
// A dated copyright notice is legal copy, not a decorative bullet.
const COPYRIGHT_NOTICE = /^\s*\u00a9\s+\d{4}\b/u;
const GAMIFIED = /\bLevel\s+\d|^\s*Level\s*$|\bmastery points?\b|\bXP\b|\blevel up\b/i;
const NUMBERED_INDEX = /\b0\$?\{\s*(?:index|idx|i)\s*\+\s*1\s*\}/;

export function sourceFindings(rel: string, raw: string): Finding[] {
  const out: Finding[] = [];
  const source = ts.createSourceFile(rel, raw, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const copy = collectCopy(source);
  const texts = copy.map((c) => c.text.trim());

  if ((["01", "02", "03"] as const).every((n) => texts.includes(n)) || NUMBERED_INDEX.test(raw)) {
    out.push({ file: rel, pattern: "numbered-icon-triplet", detail: "01 / 02 / 03 or 0{index + 1}" });
  }
  for (const c of copy) {
    const lower = c.text.toLowerCase();
    const hedge = HEDGE_PHRASES.find((phrase) => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower));
    if (hedge) out.push({ file: rel, pattern: "hedge-copy", detail: `${c.line}: "${hedge}"` });
    if (EMOJI_BULLET.test(c.text) && !RATING_GLYPH.test(c.text) && !COPYRIGHT_NOTICE.test(c.text)) {
      out.push({ file: rel, pattern: "emoji-bullet", detail: `${c.line}: ${c.text.trim().slice(0, 30)}` });
    }
    if (GAMIFIED.test(c.text)) out.push({ file: rel, pattern: "gamified-level", detail: `${c.line}: ${c.text.trim().slice(0, 30)}` });
  }
  if (rel.endsWith(".tsx")) {
    for (const hit of cardInCard(source)) out.push({ file: rel, pattern: "card-in-card", detail: `${hit.line}: ${hit.text}` });
    if (/\bgrid-cols-3\b/.test(raw)) out.push({ file: rel, pattern: "three-column-grid", detail: "grid-cols-3" });
    const code = raw.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
    if (/className="[^"]*\b\w*(?:orbit|scanline)\w*\b/i.test(code)) {
      out.push({ file: rel, pattern: "orbit-or-scanline", detail: "orbit or scanline element" });
    }
  }
  return out;
}

function collectFindings(): Finding[] {
  const files: string[] = [];
  walk(SCOPE, files);
  const findings: Finding[] = [];
  for (const file of files.sort()) {
    const rel = relative(ROOT, file);
    const raw = readFileSync(file, "utf8");
    findings.push(...(file.endsWith(".css") ? cssFindings(rel, raw) : sourceFindings(rel, raw)));
  }
  return findings;
}

function keyOf(file: string, pattern: Pattern): string {
  return `${file} :: ${pattern}`;
}

describe("template-pattern ban (docs/VOICE.md)", () => {
  const findings = collectFindings();
  const pending = new Set(PENDING_REMOVAL.map((row) => keyOf(row.file, row.pattern)));

  it("finds no template pattern outside the documented backlog", () => {
    const offences = findings
      .filter((f) => !pending.has(keyOf(f.file, f.pattern)))
      .map((f) => `${f.file} [${f.pattern}] ${f.detail}`);
    expect(offences).toEqual([]);
  });

  it("keeps the backlog honest: every pending row still names a live offence", () => {
    const live = new Set(findings.map((f) => keyOf(f.file, f.pattern)));
    const stale = PENDING_REMOVAL.filter((row) => !live.has(keyOf(row.file, row.pattern))).map((row) => keyOf(row.file, row.pattern));
    expect(stale, "delete these rows: the offence is gone").toEqual([]);
  });

  it("documents every banned pattern in docs/VOICE.md", () => {
    const voice = readFileSync(join(ROOT, "docs/VOICE.md"), "utf8");
    const start = voice.indexOf("## Template patterns");
    expect(start, "docs/VOICE.md has a '## Template patterns' section").toBeGreaterThan(-1);
    const section = voice.slice(start);
    const named: Pattern[] = [
      "orbit-or-scanline", "glass-blur", "dot-grid", "numbered-icon-triplet", "hedge-copy",
      "emoji-bullet", "card-in-card", "three-column-grid", "gamified-level",
    ];
    for (const pattern of named) expect(section, pattern).toContain(`\`${pattern}\``);
  });

  it("does not read comments or class names as copy", () => {
    const rel = "components/probe.tsx";
    const raw = `// whether you're reading this: a comment\nexport const X = () => <p className="levelCard">Fine</p>;\n`;
    expect(sourceFindings(rel, raw)).toEqual([]);
  });

  it("accepts dated copyright notices without exempting decorative copyright bullets", () => {
    const rel = "components/probe.tsx";
    expect(sourceFindings(rel, 'export const X = () => <p>\u00a9 2026 PUBMAXX / Karan Manoharan</p>;')).toEqual([]);
    expect(sourceFindings(rel, 'export const X = () => <p>\u00a9 Cheap pints</p>;').map((finding) => finding.pattern)).toEqual(["emoji-bullet"]);
  });

  it("catches each pattern in a synthetic component", () => {
    const rel = "components/probe.tsx";
    const raw = [
      "export const X = () => (",
      '  <div className="outerCard">',
      '    <div className="innerCard">',
      "      <p>Whether you're out or in, look no further.</p>",
      "      <p>🍺 Cheap pints</p>",
      "      <span>Level {n}</span>",
      '      <span>{"01"}{"02"}{"03"}</span>',
      "    </div>",
      "  </div>",
      ");",
    ].join("\n");
    const patterns = new Set(sourceFindings(rel, raw).map((f) => f.pattern));
    expect([...patterns].sort()).toEqual(
      ["card-in-card", "emoji-bullet", "gamified-level", "hedge-copy", "numbered-icon-triplet"].sort(),
    );
    const css = ".lpOrbit { border-radius: 50% } .nav { backdrop-filter: blur(14px) } .s { background-image: radial-gradient(circle at 1px 1px, red .6px, transparent .8px) } .g { grid-template-columns: repeat(3, 1fr); }";
    expect(cssFindings("components/probe.css", css).map((f) => f.pattern).sort()).toEqual(
      ["dot-grid", "glass-blur", "orbit-or-scanline", "three-column-grid"].sort(),
    );
  });
});
