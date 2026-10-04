import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { listedCategoryPrices } from "@/lib/listedCategoryPrices";
import { getNightArea } from "@/lib/nightAreas";
import { parseUkPriceBundleRows } from "@/lib/ukPriceBundle";
import {
  DISPOSABLE_MENU_FIXTURE,
  installDisposableMenuFixture,
  prepareDisposableMenuFixture,
} from "../scripts/e2e/disposable-menu-fixture.mjs";

const workspaces: string[] = [];
const originalBytes = Buffer.from(`[\n  ${JSON.stringify({
  venueId: "venue-baseline", name: "Baseline fixture pub", category: "beer", priceGbp: 6,
  lane: "site-harvest", standing: "listed", sourceUrl: "https://baseline.example/menu",
  publisher: "Baseline fixture", observedAt: "2026-09-21T10:00:00Z", basis: null, sampleSize: null,
})}\n]\n`);

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "pubmax-disposable-menu-"));
  workspaces.push(root);
  const data = join(root, "public/data");
  mkdirSync(join(data, "uk_prices"), { recursive: true });
  writeFileSync(join(data, "uk_prices/rows.json"), originalBytes);
  writeFileSync(join(data, "venues_slim.json"), JSON.stringify({ rows: [{
    id: DISPOSABLE_MENU_FIXTURE.venueId, name: DISPOSABLE_MENU_FIXTURE.venueName,
    lat: DISPOSABLE_MENU_FIXTURE.lat, lng: DISPOSABLE_MENU_FIXTURE.lng,
    filterHints: { canonical: true },
  }] }));
  return root;
}

function fixtureEnv(backup: ReturnType<typeof prepareDisposableMenuFixture>): NodeJS.ProcessEnv {
  return {
    PW_DISPOSABLE_PLAN_DB: "1", PW_DISPOSABLE_SUPABASE_URL: "http://127.0.0.1:3100",
    PW_DISPOSABLE_SERVICE_ROLE_KEY: "disposable-test-only",
    PW_SKIP_WEBSERVER: "0", PW_SKIP_KEYLESS_WEBSERVER: "1",
    PW_DISPOSABLE_MENU_BACKUP_DIR: backup.backupDir,
    PW_DISPOSABLE_MENU_OBSERVED_AT: backup.observedAt,
  };
}

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("installs a qualified named 125ml white quote and restores exact original bytes", () => {
  const root = workspace();
  const backup = prepareDisposableMenuFixture(root);
  const rowsPath = join(root, "public/data/uk_prices/rows.json");
  try {
    installDisposableMenuFixture(root, fixtureEnv(backup));
    const rows = parseUkPriceBundleRows(JSON.parse(readFileSync(rowsPath, "utf8")));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(JSON.parse(originalBytes.toString("utf8"))[0]);
    expect(rows[1]).toMatchObject({ venueId: "venue-yhodj6", name: "The Alexandra",
      publisher: "Disposable menu fixture", observedAt: backup.observedAt });
    expect(listedCategoryPrices(rows, Date.now(), {
      serving: "125ml", drinkSubtype: "wine-white",
      drinkLabel: DISPOSABLE_MENU_FIXTURE.drinkLabel,
    })).toEqual([{ source: "listed", category: "wine", priceGbp: 5.5,
      drinkLabel: "Disposable fixture Chardonnay", servingSize: "125ml",
      sourceUrl: DISPOSABLE_MENU_FIXTURE.sourceUrl, observedAt: backup.observedAt }]);
  } finally {
    backup.restore();
  }
  expect(readFileSync(rowsPath)).toEqual(originalBytes);
  expect(existsSync(backup.backupDir)).toBe(false);
  backup.restore();
  expect(readFileSync(rowsPath)).toEqual(originalBytes);
});

it("restores original bytes when the browser phase throws after installation", () => {
  const root = workspace();
  const backup = prepareDisposableMenuFixture(root);
  expect(() => {
    try {
      installDisposableMenuFixture(root, fixtureEnv(backup));
      throw new Error("Browser phase failed");
    } finally {
      backup.restore();
    }
  }).toThrow("Browser phase failed");
  expect(readFileSync(join(root, "public/data/uk_prices/rows.json"))).toEqual(originalBytes);
  expect(existsSync(backup.backupDir)).toBe(false);
});

it.each([
  { PW_DISPOSABLE_PLAN_DB: "0" },
  { PW_DISPOSABLE_SUPABASE_URL: "https://real-project.supabase.co" },
  { PW_SKIP_WEBSERVER: "1" },
  { PW_SKIP_KEYLESS_WEBSERVER: "0" },
])("refuses an unowned runtime profile %j before changing the bundle", (overrides) => {
  const root = workspace();
  const backup = prepareDisposableMenuFixture(root);
  try {
    expect(() => installDisposableMenuFixture(root, { ...fixtureEnv(backup), ...overrides }))
      .toThrow("runner-owned loopback DB and server profile");
    expect(readFileSync(join(root, "public/data/uk_prices/rows.json"))).toEqual(originalBytes);
  } finally {
    backup.restore();
  }
});

it("refuses a backup belonging to another checkout", () => {
  const root = workspace();
  const foreign = workspace();
  const backup = prepareDisposableMenuFixture(foreign);
  try {
    expect(() => installDisposableMenuFixture(root, fixtureEnv(backup))).toThrow("runner-owned backup");
    expect(readFileSync(join(root, "public/data/uk_prices/rows.json"))).toEqual(originalBytes);
  } finally {
    backup.restore();
  }
});

it("requires the restored build output to match the exact original backup", () => {
  const root = workspace();
  const backup = prepareDisposableMenuFixture(root);
  const rowsPath = join(root, "public/data/uk_prices/rows.json");
  const changed = Buffer.from("[ ]\n");
  writeFileSync(rowsPath, changed);
  try {
    expect(() => installDisposableMenuFixture(root, fixtureEnv(backup))).toThrow("exact backup");
    expect(readFileSync(rowsPath)).toEqual(changed);
  } finally {
    backup.restore();
  }
});

it("refuses a relocated or non-curated Alexandra", () => {
  const root = workspace();
  const backup = prepareDisposableMenuFixture(root);
  writeFileSync(join(root, "public/data/venues_slim.json"), JSON.stringify({ rows: [{
    id: DISPOSABLE_MENU_FIXTURE.venueId, name: DISPOSABLE_MENU_FIXTURE.venueName,
    lat: 51.48876, lng: -0.16951, filterHints: { canonical: false },
  }] }));
  try {
    expect(() => installDisposableMenuFixture(root, fixtureEnv(backup))).toThrow("real curated Alexandra");
    expect(readFileSync(join(root, "public/data/uk_prices/rows.json"))).toEqual(originalBytes);
  } finally {
    backup.restore();
  }
});

it("uses the committed Alexandra identity and coordinates inside Clapham", () => {
  const venues = JSON.parse(readFileSync("public/data/venues_slim.json", "utf8"));
  expect(venues.rows.find((row: { id: string }) => row.id === DISPOSABLE_MENU_FIXTURE.venueId))
    .toMatchObject({ name: DISPOSABLE_MENU_FIXTURE.venueName, lat: DISPOSABLE_MENU_FIXTURE.lat,
      lng: DISPOSABLE_MENU_FIXTURE.lng, filterHints: { canonical: true } });
  const clapham = getNightArea("clapham");
  const approximateKm = Math.hypot((DISPOSABLE_MENU_FIXTURE.lat - clapham.centre.lat) * 111,
    (DISPOSABLE_MENU_FIXTURE.lng - clapham.centre.lng) * 111 * Math.cos(clapham.centre.lat * Math.PI / 180));
  expect(approximateKm).toBeLessThan(clapham.radiusKm);
  expect(clapham.coverageStatus).toBe("route_ready");
});

async function playwrightConfig(disposable: boolean, skipWebserver = false) {
  for (const [name, value] of Object.entries({
    PW_PORT: "3100", PW_KEYLESS_PORT: "3101", PW_SCREENSHOTS: "", PUBMAX_E2E_LOGIN: "0",
    PW_SKIP_WEBSERVER: skipWebserver ? "1" : "0", PW_SKIP_KEYLESS_WEBSERVER: "1",
    PW_DISPOSABLE_PLAN_DB: disposable ? "1" : "0",
    PW_DISPOSABLE_SUPABASE_URL: "http://127.0.0.1:3102",
    PW_DISPOSABLE_SERVICE_ROLE_KEY: "disposable-test-only",
  })) vi.stubEnv(name, value);
  vi.resetModules();
  return (await import("../playwright.config")).default;
}

it("installs only after the restored build and before the owned disposable server starts", async () => {
  const config = await playwrightConfig(true);
  const servers = config.webServer as { command: string; reuseExistingServer: boolean }[];
  expect(servers).toHaveLength(1);
  expect(servers[0].command).toBe("node scripts/run-with-restored-next-env.mjs npm run build && node scripts/e2e/run-disposable-plan-browser.mjs --install-menu-fixture && npm run start -- --port 3100 --hostname 127.0.0.1");
  expect(servers[0].reuseExistingServer).toBe(false);
});

it("preserves the normal build command and refusal to reuse a server in the disposable profile", async () => {
  const config = await playwrightConfig(false);
  const servers = config.webServer as { command: string }[];
  expect(servers[0].command).toBe("node scripts/run-with-restored-next-env.mjs npm run build && npm run start -- --port 3100");
  await expect(playwrightConfig(true, true)).rejects.toThrow("owned Playwright server only");
});
