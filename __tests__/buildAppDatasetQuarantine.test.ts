import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const BUILD_SCRIPT = join(ROOT, "scripts", "build_app_dataset.py");
const QUARANTINED_IDS = [
  "app_price_000263",
  "app_price_000274",
  "app_price_000339",
  "app_price_000719",
  "app_price_000977",
  "app_price_001220",
  "app_price_001614",
  "app_price_002037",
  "app_price_002038",
  "app_price_002312",
  "app_price_002483",
  "app_price_002908",
];
const tempDirs: string[] = [];

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  const [headers = [], ...values] = rows;
  return values.map((cells) =>
    Object.fromEntries(
      headers.map((header, index) => [header, cells[index] ?? ""]),
    ),
  );
}

function setupScratch(): string {
  const scratchRoot = mkdtempSync(join(tmpdir(), "app-dataset-build-test-"));
  tempDirs.push(scratchRoot);
  const scratchData = join(scratchRoot, "data");
  const scratchOsm = join(scratchData, "osm", "uk");
  mkdirSync(scratchOsm, { recursive: true });

  for (const file of [
    "pint_prices_canonical_enriched.csv",
    "borough_embedded_pint_prices.csv",
    "pub_page_pint_prices.csv",
    "summary.json",
    "postcode_coordinate_exceptions.json",
    "postcode_coordinate_quarantine.json",
  ]) {
    cpSync(join(ROOT, "data", file), join(scratchData, file));
  }

  const corrections = join(ROOT, "data", "postcode_coordinate_corrections.json");
  if (existsSync(corrections)) {
    cpSync(corrections, join(scratchData, "postcode_coordinate_corrections.json"));
  } else {
    writeFileSync(
      join(scratchData, "postcode_coordinate_corrections.json"),
      JSON.stringify({ corrections: [] }),
      "utf8",
    );
  }

  cpSync(
    join(ROOT, "data", "osm", "uk", "uk_osm_pubs.json"),
    join(scratchOsm, "uk_osm_pubs.json"),
  );
  return scratchRoot;
}

function runBuilder(scratchRoot: string) {
  return spawnSync("python3", [BUILD_SCRIPT], {
    cwd: scratchRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("build_app_dataset.py postcode-coordinate decisions", () => {
  it(
    "prints and skips every exact quarantine row while preserving corrections",
    () => {
      const scratchRoot = setupScratch();
      const result = runBuilder(scratchRoot);

      expect(result.status, result.stderr).toBe(0);
      const rows = parseCsv(
        readFileSync(
          join(scratchRoot, "data", "pint_prices_app_dataset.csv"),
          "utf8",
        ),
      );
      const shippedIds = new Set(rows.map((row) => row.app_price_id));

      for (const appPriceId of QUARANTINED_IDS) {
        expect(shippedIds.has(appPriceId), appPriceId).toBe(false);
        expect(result.stdout).toContain(
          `[postcode-coordinate quarantine] ${appPriceId}`,
        );
      }
      expect(
        result.stdout.match(/\[postcode-coordinate quarantine\]/g),
      ).toHaveLength(QUARANTINED_IDS.length);

      const sirMichaelRows = rows.filter(
        (row) =>
          row.pub_name === "The Sir Michael Balcon - JD Wetherspoon",
      );
      expect(sirMichaelRows).toHaveLength(10);
      for (const row of sirMichaelRows) {
        expect(row.address).toBe("46-47 The Mall, London W5 3TJ, UK");
        expect(row.latitude).toBe("51.5136177");
        expect(row.longitude).toBe("-0.2988011");
        expect(row.primary_borough).toBe("Ealing");
        expect(row.data_quality_notes).toContain(
          "postcode_coordinate_corrected_from_osm",
        );
      }
    },
    30_000,
  );

  it(
    "fails instead of ignoring a deliberately stale quarantine id",
    () => {
      const scratchRoot = setupScratch();
      const registryPath = join(
        scratchRoot,
        "data",
        "postcode_coordinate_quarantine.json",
      );
      const registry = JSON.parse(readFileSync(registryPath, "utf8"));
      registry.rows[0] = {
        ...registry.rows[0],
        appPriceId: "app_price_999999",
      };
      writeFileSync(registryPath, JSON.stringify(registry), "utf8");

      const result = runBuilder(scratchRoot);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "app_price_999999 is not in the pre-publication dataset",
      );
    },
    30_000,
  );
});
