/** Synthetic menu evidence, confined to the owned disposable Plan server. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export const DISPOSABLE_MENU_FIXTURE = Object.freeze({
  venueId: "venue-yhodj6",
  venueName: "The Alexandra",
  lat: 51.4613,
  lng: -0.138196,
  drinkLabel: "Disposable fixture Chardonnay",
  servingSize: "125ml",
  sourceUrl: "https://pubmaxx-e2e.example/disposable-menu/the-alexandra",
  priceGbp: 5.5,
});

const BACKUP_PREFIX = "disposable-plan-menu-";

function rowsPath(root) {
  return join(root, "public/data/uk_prices/rows.json");
}

/** The parent runner owns restoration, including build and browser failures. */
export function prepareDisposableMenuFixture(root) {
  root = realpathSync(root);
  const original = readFileSync(rowsPath(root));
  const rows = JSON.parse(original.toString("utf8"));
  if (!Array.isArray(rows) || rows.some((row) => row.sourceUrl === DISPOSABLE_MENU_FIXTURE.sourceUrl)) {
    throw new Error("Disposable menu backup requires an unmodified price bundle");
  }
  const auditDir = join(root, ".audit");
  mkdirSync(auditDir, { recursive: true });
  const backupDir = mkdtempSync(join(auditDir, BACKUP_PREFIX));
  const observedAt = new Date().toISOString();
  try {
    writeFileSync(join(backupDir, "rows.json"), original);
    writeFileSync(join(backupDir, "owner.json"), JSON.stringify({ pid: process.pid, observedAt }));
  } catch (error) {
    rmSync(backupDir, { recursive: true, force: true });
    throw error;
  }
  let restored = false;
  return {
    backupDir, observedAt,
    restore() {
      if (restored) return;
      writeFileSync(rowsPath(root), original);
      rmSync(backupDir, { recursive: true, force: true });
      restored = true;
    },
  };
}

/** Called only between the restored build and the disposable server's first read. */
export function installDisposableMenuFixture(root, env = process.env) {
  root = realpathSync(root);
  const url = env.PW_DISPOSABLE_SUPABASE_URL && new URL(env.PW_DISPOSABLE_SUPABASE_URL);
  if (env.PW_DISPOSABLE_PLAN_DB !== "1" || !url || url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" || url.pathname !== "/" || url.search || url.hash ||
      url.username || url.password || !env.PW_DISPOSABLE_SERVICE_ROLE_KEY ||
      env.PW_SKIP_WEBSERVER !== "0" || env.PW_SKIP_KEYLESS_WEBSERVER !== "1" ||
      env.PW_SCREENSHOTS || env.PUBMAX_E2E_LOGIN === "1") {
    throw new Error("Disposable menu fixture requires the runner-owned loopback DB and server profile");
  }
  const backupDir = env.PW_DISPOSABLE_MENU_BACKUP_DIR && resolve(env.PW_DISPOSABLE_MENU_BACKUP_DIR);
  if (!backupDir || dirname(backupDir) !== resolve(root, ".audit") ||
      !basename(backupDir).startsWith(BACKUP_PREFIX) || realpathSync(backupDir) !== backupDir) {
    throw new Error("Disposable menu fixture requires its runner-owned backup");
  }
  const owner = JSON.parse(readFileSync(join(backupDir, "owner.json"), "utf8"));
  if (!Number.isInteger(owner.pid) || owner.pid <= 0 ||
      owner.observedAt !== env.PW_DISPOSABLE_MENU_OBSERVED_AT ||
      !Number.isFinite(Date.parse(owner.observedAt))) {
    throw new Error("Disposable menu fixture cannot verify its backup owner");
  }
  process.kill(owner.pid, 0);
  const original = readFileSync(join(backupDir, "rows.json"));
  if (!readFileSync(rowsPath(root)).equals(original)) {
    throw new Error("Disposable menu fixture requires the restored bundle to match its exact backup");
  }
  const venues = JSON.parse(readFileSync(join(root, "public/data/venues_slim.json"), "utf8"));
  const venue = venues.rows.find((row) => row.id === DISPOSABLE_MENU_FIXTURE.venueId);
  if (!venue || venue.name !== DISPOSABLE_MENU_FIXTURE.venueName ||
      venue.lat !== DISPOSABLE_MENU_FIXTURE.lat || venue.lng !== DISPOSABLE_MENU_FIXTURE.lng ||
      venue.filterHints?.canonical !== true) {
    throw new Error("Disposable menu fixture requires the real curated Alexandra identity and coordinates");
  }
  const row = {
    venueId: venue.id, name: venue.name, category: "wine", priceGbp: DISPOSABLE_MENU_FIXTURE.priceGbp,
    lane: "site-harvest", standing: "listed", sourceUrl: DISPOSABLE_MENU_FIXTURE.sourceUrl,
    publisher: "Disposable menu fixture", observedAt: owner.observedAt, basis: null, sampleSize: null,
    drinkLabel: DISPOSABLE_MENU_FIXTURE.drinkLabel, servingSize: DISPOSABLE_MENU_FIXTURE.servingSize,
    drinkSubtype: "wine-white",
  };
  writeFileSync(rowsPath(root), `${JSON.stringify([...JSON.parse(original.toString("utf8")), row])}\n`);
  return row;
}
