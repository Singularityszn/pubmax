// Run only in the assigned local runtime window. This file starts no services.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
import { attachSpillBill, BILL_FIXTURE } from "../../e2e/helpers/priceBill.ts";

const run = promisify(execFile);
const sha = value => createHash("sha256").update(value).digest("hex");
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const venueId = "venue-1vle947";
const bucket = "pint-drops";
let stage = "validate inputs";
let browser;
let output;
const evidence = { status: "not completed", stages: [], uploads: [], replies: [], sql: [] };

async function protectedFile(path) {
  assert(isAbsolute(path));
  const info = await lstat(path);
  assert(info.isFile() && info.uid === process.getuid() && (info.mode & 0o077) === 0);
  return info;
}

async function loopback(value, database = false) {
  const url = new URL(value);
  assert((database ? ["postgres:", "postgresql:"] : ["http:", "https:"]).includes(url.protocol));
  assert(["127.0.0.1", "[::1]", "localhost"].includes(url.hostname));
  assert(!url.search && !url.hash);
  assert(database || (!url.username && !url.password && url.pathname === "/"));
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true });
  assert(addresses.length && addresses.every(({ address }) => address === "::1" || address.startsWith("127.")));
  return url;
}

async function main() {
  assert.equal(process.argv.length, 3);
  assert(!process.env.DEBUG && !process.env.PWDEBUG && !process.env.NODE_USE_ENV_PROXY);
  await protectedFile(process.argv[2]);
  const cfg = JSON.parse(await readFile(process.argv[2], "utf8"));
  const app = await loopback(cfg.appUrl);
  const api = await loopback(cfg.apiUrl);
  const db = await loopback(cfg.databaseUrl, true);
  assert(/^[a-z0-9_]{3,30}$/.test(cfg.handle));
  assert(typeof cfg.password === "string" && cfg.password.length >= 8);
  assert(typeof cfg.anonKey === "string" && cfg.anonKey.length > 20);
  assert(typeof cfg.serviceRoleKey === "string" && cfg.serviceRoleKey.length > 20);
  assert(/^[0-9a-f]{40}$/.test(cfg.expectedCommit));
  assert(typeof cfg.bypassCSP === "boolean");
  assert(!cfg.bypassCSP || (typeof cfg.cspException === "string" && cfg.cspException.length > 10));
  assert(isAbsolute(cfg.outputDirectory));
  const storageInfo = await protectedFile(cfg.storageLogFile);
  await mkdir(cfg.outputDirectory, { mode: 0o700 }); // Refuse reuse of an old proof directory.
  output = cfg.outputDirectory;
  evidence.localOnly = { app: app.origin, api: api.origin, databaseHost: db.hostname, databasePort: db.port };
  evidence.csp = cfg.bypassCSP ? "Local transport exception: bypassCSP enabled; production CSP is not proved." : "CSP enforced";
  evidence.source = JSON.parse((await run("git", ["log", "-1", "--format={\"commit\":\"%H\"}"])).stdout);
  evidence.bill = { path: "e2e/fixtures/bill.jpg", sha256: sha(await readFile(BILL_FIXTURE)) };

  const pgEnv = {
    PATH: process.env.PATH, LC_ALL: "C", PGHOST: db.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: db.port || "5432", PGDATABASE: decodeURIComponent(db.pathname.slice(1)),
    PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password),
    PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable", PGAPPNAME: "receipt-lost-response-proof",
    PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=10000",
  };
  assert(pgEnv.PGDATABASE && pgEnv.PGUSER && pgEnv.PGPASSWORD);
  let previousStorageText = "";
  async function sql(query) {
    // SQL uses stdin. Neither credentials nor query values enter command arguments.
    return new Promise((resolve, reject) => {
      const child = execFile("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--no-password"],
        { env: pgEnv, timeout: 15_000, maxBuffer: 256_000 }, (error, stdout) => {
          if (error) return reject(new Error("Independent SQL read failed"));
          try { resolve(JSON.parse(stdout.trim())); } catch { reject(new Error("Invalid SQL result")); }
        });
      child.stdin.end(query);
    });
  }
  async function localFetch(url, options = {}) {
    assert([app.origin, api.origin].includes(new URL(url).origin));
    return fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(15_000) });
  }
  async function version() {
    const response = await localFetch(new URL("/api/version", app));
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.gitCommitSha, cfg.expectedCommit);
    assert(value.builtAt && value.gitCommitShaSource);
    return value;
  }
  async function storageLog() {
    const info = await protectedFile(cfg.storageLogFile);
    assert.equal(info.ino, storageInfo.ino);
    assert(info.size >= storageInfo.size && info.size < 16 * 1024 * 1024);
    // Read complete JSON lines only. Raw headers, tokens, and messages never leave this process.
    const text = await readFile(cfg.storageLogFile, "utf8");
    assert(text.startsWith(previousStorageText)); // Refuse log rotation, truncation, or replacement.
    previousStorageText = text;
    const lines = text.split("\n").slice(0, -1);
    return lines.flatMap(line => {
      let row;
      try { row = JSON.parse(line); } catch { return []; }
      if (!row.req?.method || !row.req?.url || !Number.isInteger(row.res?.statusCode)) return [];
      const url = new URL(row.req.url, api);
      const path = url.pathname.replace(/^\/storage\/v1/, "");
      if (!path.includes(`/${bucket}/`) && !path.endsWith(`/${bucket}`)) return [];
      const download = url.searchParams.get("download");
      const phase = ["receipt-before-abort.jpg", "receipt-after-retry.jpg"].includes(download) ? download : null;
      return [{ method: row.req.method, path, status: row.res.statusCode, phase }];
    });
  }
  // Signing and listing are real POST reads. They do not upload object bytes.
  const writes = rows => rows.filter(row => ["POST", "PUT", "PATCH", "DELETE"].includes(row.method)
    && !row.path.startsWith("/object/sign/") && !row.path.startsWith("/object/list/"));
  async function photos(keys, phase) {
    const result = [];
    for (const key of keys) {
      assert(key.startsWith(`${venueId}/`) && !key.includes(".."));
      const url = new URL(`/storage/v1/object/authenticated/${bucket}/${key}`, api);
      // Storage's download filename labels each read barrier without changing stored bytes.
      url.searchParams.set("download", phase);
      const response = await localFetch(url, {
        headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}` },
      });
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert(bytes.length > 0 && bytes.length < 10 * 1024 * 1024);
      const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      assert(decoded.info.width > 0 && decoded.info.height > 0);
      result.push({ key, bytes: bytes.length, sha256: sha(bytes), width: decoded.info.width, height: decoded.info.height });
    }
    return result;
  }

  stage = "local version and clean account";
  evidence.version = await version();
  const owner = await sql(`select json_build_object('userId', p.user_id,
    'drops', (select count(*) from public.pint_drops where handle = p.handle))
    from public.profiles p join auth.users u on u.id = p.user_id where p.handle = ${literal(cfg.handle)};`);
  assert(/^[0-9a-f-]{36}$/.test(owner.userId));
  assert.equal(owner.drops, 0); // Use a fresh owned account; never clean another run's rows.
  evidence.accountHash = sha(owner.userId);
  browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: cfg.bypassCSP });
  // No tracing, HAR, video, storageState, console forwarding, or fake auth handlers.
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    // Same non-identity tour dismissals as the original full-composer fixture.
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    const captured = [];
    const identities = new WeakMap();
    let nextIdentity = 0;
    window.receiptProofUploads = captured;
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.origin === location.origin && url.pathname === "/api/pint-drops" && init?.method === "POST" && init.body instanceof FormData) {
        const fields = [];
        const files = [];
        for (const [name, value] of init.body.entries()) {
          if (!(value instanceof File)) { fields.push([name, value]); continue; }
          if (!identities.has(value)) identities.set(value, ++nextIdentity);
          files.push({ field: name, identity: identities.get(value), name: value.name, type: value.type,
            size: value.size, lastModified: value.lastModified, bytes: Array.from(new Uint8Array(await value.arrayBuffer())) });
        }
        captured.push({ key: new Headers(init.headers).get("Idempotency-Key"), fields, files });
      }
      return originalFetch.call(window, input, init);
    };
  });

  stage = "real handle-password sign-in";
  await page.goto(new URL("/login?mode=signin", app).href);
  await page.getByRole("button", { name: "Sign in with handle and password", exact: true }).click();
  const login = page.getByRole("form", { name: "Sign in with handle and password" });
  await login.getByLabel("Handle", { exact: true }).fill(cfg.handle);
  await login.getByLabel("Password", { exact: true }).fill(cfg.password);
  const signIn = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/handle-password" && response.request().method() === "POST");
  await login.getByRole("button", { name: "Sign in", exact: true }).click();
  const signInResponse = await signIn;
  assert.equal(signInResponse.status(), 200);
  const session = (await signInResponse.json()).session;
  const userResponse = await localFetch(new URL("/auth/v1/user", api), {
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${session.access_token}` },
  });
  assert.equal(userResponse.status, 200);
  assert.equal((await userResponse.json()).id, owner.userId);
  // Wait for the application's real session and identity synchronization before navigation.
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pubmax_handle"))).toBe(cfg.handle);
  evidence.stages.push("Real GoTrue session matches the SQL profile owner");

  stage = "390px full composer";
  await page.goto(new URL(`/map?sel=${venueId}`, app).href);
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(sheet).toBeVisible();
  await sheet.getByRole("tab", { name: "Stories", exact: true }).click();
  await sheet.getByRole("button", { name: /log a pint drop/i }).click();
  const form = page.locator("form.dropComposer");
  await expect(form).toBeVisible();
  await form.getByRole("group", { name: /quick-add price/i }).getByRole("button").first().click();
  const price = await form.getByLabel("What did it cost?", { exact: true }).inputValue();
  await form.getByLabel("Drink", { exact: true }).fill("Pale ale");
  await attachSpillBill(form);
  await form.getByRole("button", { name: "Add a photo or story" }).click();
  await form.getByLabel(/Snap the pour: snap or upload/i).setInputFiles(BILL_FIXTURE);
  const beforeLog = await storageLog();
  let firstUpload;
  let firstSql;
  let firstPhotos;
  let firstLog;
  let dropId;
  let attempts = 0;
  let interceptionError;
  let delivered = 0;
  const original = await readFile(BILL_FIXTURE);

  async function snapshot(key) {
    const actor = sha(JSON.stringify(["pint-drop:create:v1", owner.userId, key]));
    const result = await sql(`select json_build_object(
      'ledgerCount', (select count(*) from public.pint_drop_create_requests where actor_key_hash = ${literal(actor)}),
      'dropCount', (select count(*) from public.pint_drops where handle = ${literal(cfg.handle)}),
      'ledger', (select row_to_json(r) from public.pint_drop_create_requests r where actor_key_hash = ${literal(actor)}),
      'drop', (select json_build_object('id', id, 'venueId', venue_id, 'drink', drink, 'priceGbp', price_gbp,
        'measure', measure, 'measureLabel', measure_label, 'passedDownNote', passed_down_note, 'era', era,
        'visibility', visibility, 'vibeTags', vibe_tags, 'pintKey', pint_photo_key, 'receiptKey', receipt_photo_key,
        'venueKey', venue_photo_key) from public.pint_drops where id = ${literal(dropId)}),
      'objects', (select coalesce(json_agg(x order by x.name), '[]') from
        (select id, name, created_at, updated_at, version, metadata from storage.objects where bucket_id = ${literal(bucket)}) x));`);
    assert.equal(result.ledgerCount, 1);
    assert.equal(result.dropCount, 1);
    assert.equal(result.ledger.drop_id, dropId);
    assert.equal(result.drop.id, dropId);
    assert.equal(result.drop.venueId, venueId);
    assert.equal(result.drop.drink, "Pale ale");
    assert.equal(Number(result.drop.priceGbp), Number(price));
    assert.equal(result.drop.measure, "pint");
    const fields = Object.fromEntries(firstUpload.fields);
    for (const name of ["measureLabel", "passedDownNote", "era", "visibility"]) {
      assert.equal(result.drop[name] ?? "", fields[name]);
    }
    assert.deepEqual(result.drop.vibeTags ?? [], firstUpload.fields.filter(([name]) => name === "vibe_tags").map(([, value]) => value));
    assert.equal(result.drop.venueKey, null);
    assert(result.drop.pintKey && result.drop.receiptKey);
    assert.equal(result.objects.filter(row => [result.drop.pintKey, result.drop.receiptKey].includes(row.name)).length, 2);
    return result;
  }
  await page.route(`${app.origin}/api/pint-drops`, async route => {
    if (route.request().method() !== "POST") return route.fallback();
    try {
      attempts += 1;
      assert(attempts <= 2);
      const captured = await page.evaluate(() => window.receiptProofUploads);
      assert.equal(captured.length, attempts);
      const upload = captured.at(-1);
      assert(/^[A-Za-z0-9._:-]{16,128}$/.test(upload.key));
      assert.equal(route.request().headers()["idempotency-key"], upload.key);
      assert.deepEqual(upload.files.map(file => file.field).sort(), ["pint_photo", "receipt_photo"]);
      for (const file of upload.files) assert.deepEqual(Buffer.from(file.bytes), original);
      if (attempts === 1) firstUpload = upload;
      else assert.deepEqual(upload, firstUpload); // Includes key, all fields, bytes, and original File identities.
      evidence.uploads.push({ attempt: attempts, requestKeyHash: sha(upload.key), contentHash: sha(JSON.stringify(upload.fields)),
        files: upload.files.map(({ field, identity, name, type, size, lastModified, bytes }) =>
          ({ field, identity, name, type, size, lastModified, sha256: sha(Buffer.from(bytes)) })) });
      stage = attempts === 1 ? "first upstream 201 and independent SQL before abort" : "real retry upstream and persistence";
      const upstream = await route.fetch({ maxRetries: 0, maxRedirects: 0, timeout: 30_000 });
      assert.equal(upstream.status(), 201);
      const reply = await upstream.json();
      assert(/^[0-9a-f-]{36}$/.test(reply.drop?.id));
      if (attempts === 1) dropId = reply.drop.id;
      else assert.equal(reply.drop.id, dropId);
      evidence.replies.push({ status: 201, drop: { id: reply.drop.id, venueId: reply.drop.venueId,
        priceGbp: reply.drop.priceGbp, drink: reply.drop.drink, measure: reply.drop.measure },
        photoUrlHashes: [reply.drop.pintPhotoUrl, reply.drop.receiptPhotoUrl].map(url => {
          assert(typeof url === "string" && url.length > 0); return sha(url);
        }) });
      const saved = await snapshot(upload.key);
      evidence.sql.push({ phase: attempts === 1 ? "before abort" : "after retry", ...saved });
      const keys = [saved.drop.pintKey, saved.drop.receiptKey];
      const phase = attempts === 1 ? "receipt-before-abort.jpg" : "receipt-after-retry.jpg";
      const readBack = await photos(keys, phase);
      for (const key of keys) {
        await expect.poll(async () => (await storageLog()).filter(row => row.method === "GET"
          && row.status === 200 && row.path === `/object/authenticated/${bucket}/${key}` && row.phase === phase).length).toBe(1);
      }
      if (attempts === 1) {
        firstSql = saved;
        firstPhotos = readBack;
        firstLog = await storageLog();
        const newWrites = writes(firstLog).slice(writes(beforeLog).length);
        assert.equal(newWrites.length, 2); // Positive control for the real Storage log shape.
        for (const key of [saved.drop.pintKey, saved.drop.receiptKey]) {
          assert.equal(newWrites.filter(row => row.method === "POST" && row.path === `/object/${bucket}/${key}` && row.status >= 200 && row.status < 300).length, 1);
        }
        evidence.stages.push("Upstream 201, one ledger/drop, and readable stored photos proved before abort");
        await route.abort("failed");
      } else {
        assert.deepEqual(saved, firstSql);
        assert.deepEqual(readBack, firstPhotos);
        // Phase-specific GET completions prove the log advanced past replay, not an earlier read.
        const finalLog = await storageLog();
        assert.deepEqual(writes(finalLog), writes(firstLog));
        evidence.storage = { photos: readBack, firstUploads: 2, retryWrites: 0,
          writeEvents: writes(finalLog).slice(writes(beforeLog).length) };
        await route.fulfill({ response: upstream });
      }
      delivered += 1;
    } catch {
      interceptionError = stage;
      await route.abort("failed").catch(() => {});
    }
  });

  await form.getByRole("button", { name: "Log it", exact: true }).click();
  await expect.poll(() => interceptionError || delivered, { timeout: 60_000 }).toBe(1);
  stage = "retained composer after committed success was lost";
  await expect(form).toBeVisible();
  await expect(form.getByLabel("What did it cost?", { exact: true })).toHaveValue(price);
  await expect(form.getByLabel("Drink", { exact: true })).toHaveValue("Pale ale");
  await expect(sheet).toContainText("Network or storage error. Try again.");
  await expect(sheet.locator("article.dropCard").filter({ hasText: "Pale ale" })).toHaveCount(0);
  const preview = form.locator('[data-testid="spill-receipt-step"] img');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: join(output, "lost-201-retained-390.png") });
  await expect(form.getByRole("button", { name: "Log it", exact: true })).toBeEnabled();
  await form.getByRole("button", { name: "Log it", exact: true }).click(); // Exactly one real retry click.
  await expect.poll(() => interceptionError || delivered, { timeout: 60_000 }).toBe(2);
  stage = "one optimistic record and map row";
  await expect(form).toBeHidden();
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem("pubmax:optimistic-spill-posts:v1") ?? "[]"));
  assert.equal(records.length, 1);
  assert.equal(records[0].drop.id, dropId);
  assert.equal(records[0].retry, undefined);
  const mapRow = sheet.locator("article.dropCard").filter({ hasText: "Pale ale" });
  await expect(mapRow).toHaveCount(1);
  const storedImages = mapRow.locator(`img[src*="${dropId}"]`);
  await expect(storedImages).toHaveCount(2);
  for (const image of await storedImages.all()) {
    await expect.poll(() => image.evaluate(element => element.naturalWidth)).toBeGreaterThan(0);
  }
  assert.equal(attempts, 2);
  const finalUploads = await page.evaluate(() => window.receiptProofUploads);
  assert.equal(finalUploads.length, 2);
  assert.deepEqual(finalUploads[0], finalUploads[1]);
  evidence.retained = { price, sameFileObjects: true, sameKeyAndContent: true, decodedBill: true };
  evidence.optimistic = { records: 1, dropId, retryAbsent: true, mapRows: 1 };
  assert.deepEqual(await version(), evidence.version);
  await page.screenshot({ path: join(output, "replayed-once-390.png") });
  assert.equal(attempts, 2);
  assert.equal(interceptionError, undefined);
  evidence.status = "passed";
}

try {
  await main();
} catch {
  // Playwright and database error text can include inputs. Retain only the fixed stage label.
  evidence.status = "failed";
  evidence.failedStage = stage;
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (output) await writeFile(join(output, "proof.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(`Receipt proof ${evidence.status}${evidence.failedStage ? ` at: ${evidence.failedStage}` : ""}.`);
}
