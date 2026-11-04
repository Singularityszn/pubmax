// Contrast sweep for the launch CSS that rounds 1 to 3 added, plus micro-fix 11.
// Run: node docs/design-explorations/2026-10-30-phone-mockups/contrast.mjs
//
// It reads the token VALUES from app/globals.css and app/theme.css on every
// run, so a figure here moves when a token moves. It resolves var() and
// color-mix(in srgb, ...) the way a browser computes a custom property: a
// token declared at :root is computed on <html> with the values <html> holds,
// and the body remap (light: --paper, --panel-raised, --line; dark: --line)
// only changes what a rule under <body> reads for those names directly.
// The venue sheet is translucent over the map; it is measured as its solid
// twin (--sheet-material-solid), which is what reduced transparency paints.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const globals = readFileSync(resolve(repo, "app/globals.css"), "utf8");
const theme = readFileSync(resolve(repo, "app/theme.css"), "utf8");

function block(css, selector) {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`No block for ${selector}`);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`Unclosed block for ${selector}`);
}

function declarations(body) {
  const out = {};
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of clean.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[match[1]] = match[2].trim().replace(/\s+/g, " ");
  }
  return out;
}

const rootDecls = declarations(block(globals, ":root"));
const lightBody = declarations(block(globals, 'html:not([data-theme="dark"]) body'));
const darkRoot = { ...rootDecls, ...declarations(block(theme, 'html[data-theme="dark"]')) };
const darkBody = declarations(block(theme, 'html[data-theme="dark"] body'));

function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

// A scope is the declarations on one element plus the scope it inherits from.
function makeScope(decls, parent) {
  const cache = new Map();
  const scope = {
    get(name) {
      if (cache.has(name)) return cache.get(name);
      let value;
      if (name in decls) value = evaluate(decls[name], scope);
      else if (parent) value = parent.get(name);
      else throw new Error(`Unknown token ${name}`);
      cache.set(name, value);
      return value;
    },
  };
  return scope;
}

function splitArgs(s) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

// Returns { rgb, alpha } for a colour expression.
function evaluate(expr, scope) {
  const e = expr.trim();
  if (e.startsWith("#")) return { rgb: hexToRgb(e), alpha: 1 };
  if (e === "transparent") return { rgb: [0, 0, 0], alpha: 0 };
  let m = e.match(/^var\((--[a-z0-9-]+)\)$/);
  if (m) return scope.get(m[1]);
  m = e.match(/^rgba?\((.*)\)$/);
  if (m) {
    const [r, g, b, a = "1"] = m[1].split(",").map((x) => x.trim());
    return { rgb: [Number(r), Number(g), Number(b)], alpha: Number(a) };
  }
  m = e.match(/^color-mix\(in srgb,(.*)\)$/);
  if (m) {
    const [a, b] = splitArgs(m[1]);
    const parse = (part) => {
      const pm = part.match(/^(.*?)(?:\s+(\d+(?:\.\d+)?)%)?$/);
      return { color: evaluate(pm[1], scope), pct: pm[2] === undefined ? null : Number(pm[2]) };
    };
    const pa = parse(a);
    const pb = parse(b);
    let wa = pa.pct;
    let wb = pb.pct;
    if (wa === null && wb === null) {
      wa = 50;
      wb = 50;
    }
    if (wa === null) wa = 100 - wb;
    if (wb === null) wb = 100 - wa;
    const total = wa + wb;
    const fa = wa / total;
    const fb = wb / total;
    const alpha = pa.color.alpha * fa + pb.color.alpha * fb;
    const rgb = [0, 1, 2].map((i) =>
      alpha === 0 ? 0 : (pa.color.rgb[i] * pa.color.alpha * fa + pb.color.rgb[i] * pb.color.alpha * fb) / alpha,
    );
    // A mix whose weights sum under 100% scales the alpha down (CSS Color 5).
    return { rgb, alpha: alpha * Math.min(1, total / 100) };
  }
  throw new Error(`Cannot evaluate ${expr}`);
}

const themes = {
  light: makeScope(lightBody, makeScope(rootDecls)),
  dark: makeScope(darkBody, makeScope(darkRoot)),
};

// The price band classes declare their own hue, ink and surface on the element.
function bandScope(base, band) {
  return makeScope(
    {
      "--price-band-hue": `var(--price-band-${band})`,
      "--price-band-ink": `var(--price-band-${band}-ink)`,
      "--price-band-surface": "color-mix(in srgb, var(--price-band-hue) 14%, var(--panel-raised))",
    },
    base,
  );
}

function over(top, bottom) {
  const a = top.alpha;
  return { rgb: top.rgb.map((v, i) => v * a + bottom.rgb[i] * (1 - a)), alpha: 1 };
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(fgExpr, bgExpr, themeName, extra = {}) {
  let scope = themes[themeName];
  if (extra.band) scope = bandScope(scope, extra.band);
  const page = scope.get("--paper");
  const bg = over(evaluate(bgExpr, scope), page);
  const fg = over(evaluate(fgExpr, scope), bg);
  const [l1, l2] = [luminance(fg.rgb), luminance(bg.rgb)].sort((x, y) => y - x);
  return { ratio: (l1 + 0.05) / (l2 + 0.05), fg: toHex(fg.rgb), bg: toHex(bg.rgb) };
}

// Each pair: the file, the rule, the text token, the surface under it, and
// options. `large` means large text (3:1); everything else is body (4.5:1).
// A row marked BEFORE is the pair a fix replaced; it is shown, never counted.
const SHEET = "var(--sheet-material-solid)";
const LIST_PANEL = "color-mix(in srgb, var(--surface-tint-river) 30%, var(--panel-raised))";
export const PAIRS = [
  // Micro-fix 11: the map peek card and the list it opens, under a drink lens.
  ["mobileMapShell.css", ".mapPeekHush (lens quiet line)", "var(--color-text-muted)", "var(--color-surface-raised)"],
  ["mobileMapShell.css", ".mapPeekEyebrow", "var(--color-text-muted)", "var(--color-surface-raised)"],
  ["mapVenueList.css", ".mapVenueListItemMeta (lens finding) BEFORE", "var(--muted)", LIST_PANEL],
  ["mapVenueList.css", ".mapVenueListItemMeta (lens finding)", "var(--color-text-muted)", LIST_PANEL],
  ["mapVenueList.css", ".mapVenueListPriceProvenance", "var(--muted)", LIST_PANEL],
  // cityPubsOnlyNote.css
  ["cityPubsOnlyNote.css", ".cityPubsOnlyNote", "var(--ink)", "var(--panel-raised)"],
  // rankAfterVisit.css
  ["rankAfterVisit.css", ".rankAfterVisit", "var(--ink)", "var(--panel-raised)"],
  ["rankAfterVisit.css", ".rankAfterVisit__notice", "var(--ink-soft)", "var(--panel-raised)"],
  ["rankAfterVisit.css", ".rankAfterVisit__pair button", "var(--ink)", "var(--panel)"],
  ["rankAfterVisit.css", ".rankAfterVisit__pair span", "var(--ink-soft)", "var(--panel)"],
  ["rankAfterVisit.css", ".rankAfterVisit__quiet", "var(--river)", "var(--panel-raised)"],
  ["rankAfterVisit.css", ".rankAfterVisit__lot small", "var(--ink-soft)", "var(--panel-raised)"],
  // withTagField.css (the composer, inside the venue sheet)
  ["withTagField.css", ".withTagHint, .withTagMatches p", "var(--muted)", SHEET],
  ["withTagField.css", ".withTagMatch", "var(--ink)", "var(--panel)"],
  ["withTagField.css", ".withTagMatch span", "var(--muted)", "var(--panel)"],
  // passportBook.css (the profile page)
  ["passportBook.css", "dt, .passportQuiet, .passportRowMeta, .passportPlace, .passportFactDate", "var(--color-text-muted)", "var(--paper)"],
  ["passportBook.css", "dd, .passportRowName, .passportSectionTitle, .passportTopTenName", "var(--color-text)", "var(--paper)"],
  ["passportBook.css", ".passportBandPlaque (cheap)", "var(--price-band-ink)", "var(--price-band-surface)", { band: "cheap" }],
  ["passportBook.css", ".passportBandPlaque (average)", "var(--price-band-ink)", "var(--price-band-surface)", { band: "average" }],
  ["passportBook.css", ".passportBandPlaque (expensive)", "var(--price-band-ink)", "var(--price-band-surface)", { band: "expensive" }],
  // tonightAnswers.css (the Tonight page)
  ["tonightAnswers.css", ".tonightAnswerTitle, .tonightAnswerMeta, .tonightAnswerSource", "var(--color-text-muted)", "var(--paper)"],
  ["tonightAnswers.css", ".tonightAnswerLead, .tonightRegularTitle, .tonightPlanCardAsk", "var(--ink)", "var(--paper)"],
  // addRegularNight.css
  ["addRegularNight.css", ".addRegularNightField, .addRegularNightLine", "var(--muted)", "var(--paper)"],
  ["addRegularNight.css", ".addRegularNightField select", "var(--ink)", "var(--panel-raised)"],
  ["addRegularNight.css", ".addRegularNightSend", "var(--ink)", "var(--control-secondary-surface)"],
  // plan.css (the plan card)
  ["plan.css", ".planCard__when", "var(--color-text-muted)", "var(--panel-raised)"],
  ["plan.css", ".planCard__title (large)", "var(--color-text)", "var(--panel-raised)", { large: true }],
  ["plan.css", ".planCard__firstStop", "var(--color-text)", "var(--paper)"],
  ["plan.css", ".planCard__handle", "var(--badge-ink)", "var(--badge-surface)"],
  // venueSheet.css (the five Overview folds, on the sheet)
  ["venueSheet.css", ".venueOverviewFoldLabel", "var(--ink)", SHEET],
  ["venueSheet.css", ".venueOverviewFoldHint", "var(--muted)", SHEET],
  ["venueSheet.css", ".venueOverviewFoldSummary::after (glyph, large)", "var(--muted)", SHEET, { large: true }],
  // savedListCover.css
  ["savedListCover.css", ".savedListCover__caption", "var(--ink)", "var(--paper)"],
  // diary.css (the log panel in the sheet, the list on the profile)
  ["diary.css", ".diaryRatingLabel", "var(--color-text)", SHEET],
  ["diary.css", ".diaryRatingValue, .diaryRatingClear, .diaryLotToggle small", "var(--color-text-muted)", SHEET],
  ["diary.css", ".diaryPanel__empty", "var(--color-text-muted)", "var(--paper)"],
  ["diary.css", ".diaryRow__venue, .diaryRow__review, .diaryRow__action", "var(--color-text)", "var(--color-surface-raised)"],
  ["diary.css", ".diaryRow__date, .diaryRow__usual", "var(--color-text-muted)", "var(--color-surface-raised)"],
  ["diary.css", ".diaryRow__action--primary (coral fill)", "var(--color-on-accent)", "var(--brass)"],
  ["diary.css", ".diaryRow__error", "var(--brick)", "var(--color-surface-raised)"],
  ["diary.css", ".diaryUsualInput", "var(--color-text)", "var(--color-surface)"],
  // Landed from main on 30 October: the Sun Chaser and the Pint compass.
  ["sunChaser.css", ".sunChaserScrubber, .sunChaserStatus", "var(--ink)", SHEET],
  ["sunChaser.css", ".sunChaserVenueLine", "var(--ink-soft)", SHEET],
  ["pintCompass.css", ".pcExplainer, .pcNote, .pcWalkMeta, .pcCount", "var(--color-text-soft)", "var(--paper)"],
  ["pintCompass.css", ".pcWalkLabel", "var(--color-text-muted)", "var(--paper)"],
  ["pintCompass.css", ".pcDirection", "var(--color-text)", "var(--panel-raised)"],
  ["pintCompass.css", ".pcDirectionAligned BEFORE (--color-positive)", "var(--color-positive)", "var(--panel-raised)"],
  ["pintCompass.css", ".pcDirectionAligned (--tint-ink-positive)", "var(--tint-ink-positive)", "var(--panel-raised)"],
  ["pintCompass.css", ".pcWalkMeta (card)", "var(--color-text-soft)", "var(--panel-raised)"],
  ["pintCompass.css", ".pcCaption (card)", "var(--color-text-muted)", "var(--panel-raised)"],
];

const rows = PAIRS.map(([file, rule, fg, bg, extra = {}]) => {
  const min = extra.large ? 3 : 4.5;
  const light = ratio(fg, bg, "light", extra);
  const dark = ratio(fg, bg, "dark", extra);
  return { file, rule, fg, bg, min, light, dark, pass: light.ratio >= min && dark.ratio >= min };
});

const fmt = (n) => n.toFixed(2);
const strip = (s) => s.replace(/var\((--[a-z0-9-]+)\)/g, "$1");
console.log("| File | Rule | Text on surface | Light | Dark | Bar | Result |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const r of rows) {
  console.log(
    `| ${r.file} | ${r.rule} | ${strip(r.fg)} on ${strip(r.bg)} | ${fmt(r.light.ratio)} | ${fmt(r.dark.ratio)} | ${r.min}:1 | ${r.pass ? "pass" : "under"} |`,
  );
}
const live = rows.filter((r) => !/BEFORE/.test(r.rule));
const under = live.filter((r) => !r.pass);
console.log(`\n${rows.length} pairs measured. ${under.length} live pair(s) under their bar.`);
if (process.argv.includes("--hex")) {
  for (const r of rows) console.log(`${r.rule}: light ${r.light.fg} on ${r.light.bg}; dark ${r.dark.fg} on ${r.dark.bg}`);
}
process.exitCode = under.length > 0 ? 1 : 0;
