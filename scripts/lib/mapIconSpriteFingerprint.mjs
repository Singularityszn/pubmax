// The fingerprint of everything the pre-drawn map icon sprite is drawn FROM.
//
// `npm run build:map-icon-sprites` writes it into
// components/map/canvas/mapIconSprite.json, and __tests__/mapIconSprite.test.ts
// recomputes it from the tree. When they differ, an input changed and nobody
// redrew the sprite, so the map would ship yesterday's icons.
//
// It hashes the CODE, not the pixels, because a unit test cannot draw: the
// artwork (lib/mapIcons.ts), the colour recipe (components/map/canvas/tokens.ts)
// and the CSS custom properties those colours resolve from. Comments and
// formatting are not inputs: the TypeScript printer re-emits each declaration
// with comments removed, and a CSS comment is stripped before parsing.
//
// Plain ESM with a `.d.mts` sidecar, so both the plain-node build script and the
// TypeScript test read ONE implementation.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

/** Bump when the atlas packing or the PNG encoding changes. */
export const MAP_ICON_SPRITE_FORMAT = 1;

/**
 * The TypeScript the sprite is drawn from. `declarations: null` hashes the whole
 * file; otherwise only the named top-level declarations.
 */
export const MAP_ICON_SPRITE_SOURCES = [
  { file: "lib/mapIcons.ts", declarations: null },
  {
    file: "components/map/canvas/tokens.ts",
    declarations: [
      "CSS_SRGB",
      "MAPLIBRE_COLOR",
      "toMapLibreColor",
      "MAP_THEME_TOKEN_PROPERTIES",
      "readTokens",
      "venuePinEdgeTokens",
      "pricePillTokens",
      "withAlpha",
      "iconTokensFor",
      "MAP_ICON_PIXEL_RATIO",
    ],
  },
  { file: "lib/categoryColors.ts", declarations: ["CATEGORY_COLORS"] },
];

/** The stylesheets the theme tokens are declared in (`:root` and `html[data-theme="dark"]`). */
export const MAP_ICON_TOKEN_CSS_FILES = ["app/globals.css", "app/theme.css"];

/**
 * Each `Tokens` field `iconTokensFor` reads, and the CSS custom property it
 * resolves from. The fence test holds this table to what `iconTokensFor`
 * actually reads, so a new colour cannot reach the icons unhashed.
 */
export const MAP_ICON_TOKEN_CSS_PROPERTIES = {
  ink: "--ink",
  inkDeep: "--ink-deep",
  paper: "--paper",
  brass: "--brass",
  brassBright: "--brass-bright",
  river: "--river",
  riverBright: "--river-bright",
  pint: "--pint",
  amber: "--amber",
  brick: "--brick",
  muted: "--muted",
  panelRaised: "--panel-raised",
};

const printer = ts.createPrinter({ removeComments: true });

function declarationName(statement) {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map((d) => d.name.getText());
  }
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement)
  ) {
    return statement.name ? [statement.name.text] : [];
  }
  return [];
}

/** One TypeScript source, comments and formatting removed. */
export function printedTypeScript(repoRoot, file, declarations) {
  const text = readFileSync(join(repoRoot, file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (!declarations) return printer.printFile(source);
  const printed = [];
  for (const name of declarations) {
    const statement = source.statements.find((s) => declarationName(s).includes(name));
    if (!statement) throw new Error(`${file}: no top-level declaration named ${name}`);
    printed.push(printer.printNode(ts.EmitHint.Unspecified, statement, source));
  }
  return printed.join("\n");
}

/** Every custom-property declaration in a stylesheet, with the blocks it sits in. */
export function cssCustomProperties(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = [];
  const stack = [];
  let buffer = "";
  const flush = () => {
    const match = /^\s*(--[A-Za-z0-9_-]+)\s*:\s*([\s\S]*?)\s*$/.exec(buffer);
    if (match) {
      found.push({
        context: stack.join(" > "),
        name: match[1],
        value: match[2].replace(/\s+/g, " "),
      });
    }
    buffer = "";
  };
  for (const ch of text) {
    if (ch === "{") {
      stack.push(buffer.trim().replace(/\s+/g, " "));
      buffer = "";
    } else if (ch === "}") {
      flush();
      stack.pop();
    } else if (ch === ";") {
      flush();
    } else {
      buffer += ch;
    }
  }
  return found;
}

/**
 * The declarations behind the icon colours: every declaration of each root
 * property, then of every property those values read through `var()`, in both
 * theme stylesheets, in document order.
 */
export function iconTokenCssClosure(repoRoot) {
  const sheets = MAP_ICON_TOKEN_CSS_FILES.map((file) => ({
    file,
    declarations: cssCustomProperties(readFileSync(join(repoRoot, file), "utf8")),
  }));
  const wanted = new Set(Object.values(MAP_ICON_TOKEN_CSS_PROPERTIES));
  const queue = [...wanted];
  while (queue.length) {
    const name = queue.shift();
    for (const sheet of sheets) {
      for (const declaration of sheet.declarations) {
        if (declaration.name !== name) continue;
        for (const ref of declaration.value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
          if (!wanted.has(ref[1])) {
            wanted.add(ref[1]);
            queue.push(ref[1]);
          }
        }
      }
    }
  }
  const closure = [];
  for (const sheet of sheets) {
    for (const declaration of sheet.declarations) {
      if (wanted.has(declaration.name)) closure.push({ file: sheet.file, ...declaration });
    }
  }
  return closure;
}

/** The sprite's input fingerprint: a sha256 over the format, the code and the CSS. */
export function mapIconSpriteFingerprint(repoRoot) {
  const hash = createHash("sha256");
  hash.update(`format ${MAP_ICON_SPRITE_FORMAT}\n`);
  for (const { file, declarations } of MAP_ICON_SPRITE_SOURCES) {
    hash.update(`ts ${file}\n${printedTypeScript(repoRoot, file, declarations)}\n`);
  }
  for (const d of iconTokenCssClosure(repoRoot)) {
    hash.update(`css ${d.file} | ${d.context} | ${d.name}: ${d.value}\n`);
  }
  return hash.digest("hex");
}
