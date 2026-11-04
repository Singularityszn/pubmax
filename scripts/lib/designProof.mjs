// The pure half of the design proof command (scripts/design-proof.mjs): what
// one run shoots, what each file is called, and where each shot sits on the
// contact sheet. No browser and no image library here, so the plan is tested
// without either (__tests__/designProof.test.ts).
//
// ONE MATRIX. Every named page is shot at the phone width (390x844 at two
// device pixels per point, the density a phone draws at) and the desktop width
// (1440x900), each in the light and the dark theme. The theme is chosen the
// way a reader chooses it: the stored preference (`pubmax-theme`, the key
// lib/themePreference.ts owns), never the clock, because with no stored choice
// the app goes dark from 21:30 London time and a proof taken in the evening
// would show the wrong theme.

/** The stored theme preference, the key lib/themePreference.ts reads. */
export const THEME_STORAGE_KEY = "pubmax-theme";

/** The two widths every design pull request shows, in sheet order. */
export const DESIGN_PROOF_VIEWPORTS = Object.freeze([
  Object.freeze({ key: "390", width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }),
  Object.freeze({ key: "1440", width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false }),
]);

/** Both themes, in sheet order. */
export const DESIGN_PROOF_THEMES = Object.freeze(["light", "dark"]);

/** How wide a tile is drawn on the sheet, in sheet pixels, per viewport. */
const TILE_WIDTH = Object.freeze({ 390: 390, 1440: 720 });

/** The sheet's own spacing. */
const GAP = 16;
const LABEL_BAND = 28;
const ROW_LABEL_BAND = 36;

const PAGE_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

function usage(message) {
  return new Error(
    `${message}\nUsage: npm run proof:design -- --page <name>=<path> [--page ...] ` +
      "(--base-url <url> | --start) [--port <n>] [--out <dir>] [--before <dir>] [--full-page] [--settle-ms <n>]",
  );
}

/**
 * One `--page` value: `name=/path`. The name becomes the file name, so it is a
 * short lower-case slug; the path is a path on the server under proof, never a
 * full URL, so a proof cannot be pointed at somebody else's site by a typo.
 */
export function parseProofPage(value) {
  const at = value.indexOf("=");
  if (at <= 0) throw usage(`--page needs name=/path, got "${value}"`);
  const name = value.slice(0, at);
  const path = value.slice(at + 1);
  if (!PAGE_NAME.test(name)) throw usage(`page name "${name}" must be a lower-case slug (a-z, 0-9, -)`);
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw usage(`page path "${path}" must be a path on the server, starting with one /`);
  }
  return { name, path };
}

function positiveInteger(flag, raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw usage(`${flag} needs a positive whole number, got "${raw}"`);
  return value;
}

/** Read the command line. Throws a usage error rather than guessing. */
export function parseDesignProofArgs(argv) {
  const options = {
    baseUrl: null,
    start: false,
    port: null,
    outDir: null,
    before: null,
    fullPage: false,
    settleMs: 500,
    pages: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw usage(`${flag} needs a value`);
      index += 1;
      return value;
    };
    switch (flag) {
      case "--page":
        options.pages.push(parseProofPage(next()));
        break;
      case "--base-url":
        options.baseUrl = next().replace(/\/+$/, "");
        break;
      case "--start":
        options.start = true;
        break;
      case "--port":
        options.port = positiveInteger(flag, next());
        break;
      case "--out":
        options.outDir = next();
        break;
      case "--before":
        options.before = next();
        break;
      case "--full-page":
        options.fullPage = true;
        break;
      case "--settle-ms":
        options.settleMs = positiveInteger(flag, next());
        break;
      default:
        throw usage(`unknown option "${flag}"`);
    }
  }
  if (options.pages.length === 0) throw usage("name at least one --page");
  const names = new Set();
  for (const page of options.pages) {
    if (names.has(page.name)) throw usage(`page name "${page.name}" is used twice`);
    names.add(page.name);
  }
  if (options.start === Boolean(options.baseUrl)) throw usage("pass exactly one of --base-url and --start");
  if (options.baseUrl && !/^https?:\/\/[^/]+$/.test(options.baseUrl)) {
    throw usage(`--base-url must be an origin such as http://127.0.0.1:4438, got "${options.baseUrl}"`);
  }
  if (options.port !== null && !options.start) throw usage("--port only applies with --start");
  return options;
}

/** The file one shot is written to: `<page>-<390|1440>-<light|dark>.png`. */
export function proofShotFile(pageName, viewportKey, theme) {
  return `${pageName}-${viewportKey}-${theme}.png`;
}

/** Every shot one run takes, page by page, then width, then theme. */
export function designProofShots(pages) {
  return pages.flatMap((page) =>
    DESIGN_PROOF_VIEWPORTS.flatMap((viewport) =>
      DESIGN_PROOF_THEMES.map((theme) => ({
        page,
        viewport,
        theme,
        file: proofShotFile(page.name, viewport.key, theme),
      })),
    ),
  );
}

/** The sheet's columns: each width in each theme, in shot order. */
export function contactSheetColumns() {
  return DESIGN_PROOF_VIEWPORTS.flatMap((viewport) =>
    DESIGN_PROOF_THEMES.map((theme) => ({
      viewportKey: viewport.key,
      theme,
      label: `${viewport.width} ${theme}`,
      width: TILE_WIDTH[viewport.key],
    })),
  );
}

/**
 * Where every tile sits on the contact sheet. One row per page, or two (before
 * and after) when a before folder is given; one column per width and theme.
 * Each tile is scaled to its column's width and cut at `maxTileHeight` sheet
 * pixels, so one long page cannot make the sheet unreadable. A missing shot
 * (`null`) keeps its cell empty rather than closing the gap.
 *
 * rows: [{ label, tiles: [{ width, height } | null] }], tiles in column order,
 * sizes in the shot's own pixels.
 */
export function contactSheetLayout(rows, { maxTileHeight = 1800 } = {}) {
  const columns = contactSheetColumns();
  const columnX = [];
  let x = GAP;
  for (const column of columns) {
    columnX.push(x);
    x += column.width + GAP;
  }
  const width = x;
  const placements = [];
  const labels = columns.map((column, index) => ({ text: column.label, x: columnX[index], y: GAP }));
  let y = GAP + LABEL_BAND;
  for (const row of rows) {
    labels.push({ text: row.label, x: GAP, y });
    y += ROW_LABEL_BAND;
    let rowHeight = 0;
    row.tiles.forEach((tile, index) => {
      if (!tile) return;
      const column = columns[index];
      const scale = column.width / tile.width;
      const fullHeight = Math.round(tile.height * scale);
      const height = Math.min(fullHeight, maxTileHeight);
      placements.push({
        x: columnX[index],
        y,
        width: column.width,
        height,
        cropped: fullHeight > maxTileHeight,
        rowLabel: row.label,
        column: index,
      });
      rowHeight = Math.max(rowHeight, height);
    });
    y += rowHeight + GAP;
  }
  return { width, height: y, placements, labels };
}
