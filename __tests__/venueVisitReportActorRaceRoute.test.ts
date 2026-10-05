import { createServer, type Server, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

const ID = "11111111-1111-4111-8111-111111111111";
const IPS = ["192.0.2.10", "192.0.2.20"] as const;
const SDK_ORIGIN = "https://reporter-fixture.invalid";
const CASES = [
  {
    route: "/api/venue-photos",
    table: "venue_photos",
    state: { moderation_state: "approved" },
    actors: [
      "c5a1118c96c897b76fa76d16323eb5b4a330f71a8e6825ccd115a31402c0f17e",
      "64a782ebb599ba8e48b01031d92abe64be3e55d05dc861ed1042242b300a06c0",
    ],
  },
  {
    route: "/api/visit-reports",
    table: "structured_visit_reports",
    state: { status: "visible" },
    actors: [
      "d2f41947e9c8917a96076d6198af32a9fdab9fec067f897d317895c9c069ad28",
      "90b813b09a19b0cca11caa62825f6068f11c15714f1bee0a649156c36c666986",
    ],
  },
] as const;

type Row = { id: string; report_count: number; report_actors: string[] } & Record<string, unknown>;
let server: Server;
let origin: string;
let photoPost: typeof import("@/app/api/venue-photos/route")["POST"];
let visitPost: typeof import("@/app/api/visit-reports/route")["POST"];
let row: Row;
let table: string;
let barrierTimer: ReturnType<typeof setTimeout> | undefined;
const pendingReads: Array<{ response: ServerResponse; snapshot: Row }> = [];
const reads: Row[] = [];
const writes: Row[] = [];
const limiterKeys: string[] = [];
const fixtureErrors: string[] = [];
let rpcError: { code: string; message: string } | null = null;
let rpcResult: unknown = undefined;
const rpcActors: string[] = [];

function configure(testCase: typeof CASES[number]): void {
  table = testCase.table;
  row = { id: ID, ...testCase.state, report_count: 0, report_actors: [] };
  reads.length = 0;
  writes.length = 0;
  limiterKeys.length = 0;
  fixtureErrors.length = 0;
  rpcActors.length = 0;
  rpcError = null;
  rpcResult = undefined;
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("SUPABASE_URL", SDK_ORIGIN);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_synthetic_reporter_fixture");
}

function reportRequest(route: string, ip: string = IPS[0], id: string = ID): Request {
  return new Request(`http://localhost${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-vercel-forwarded-for": ip },
    body: JSON.stringify({ action: "report", id, reason: "Synthetic report", actor: "forged-body-actor" }),
  });
}

function json(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function releaseReads(): void {
  clearTimeout(barrierTimer);
  barrierTimer = undefined;
  for (const pending of pendingReads.splice(0)) json(pending.response, pending.snapshot);
}

beforeAll(async () => {
  // The database boundary is synthetic. Routes, actor hashes, rate limiter,
  // store and installed Supabase SDK all run unchanged against loopback HTTP.
  server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", origin);
      if (url.pathname === "/rest/v1/rpc/check_rate_limit" && request.method === "POST") {
        let body = "";
        for await (const chunk of request) body += String(chunk);
        const payload = JSON.parse(body) as { p_key: string };
        limiterKeys.push(payload.p_key);
        return json(response, false);
      }
      const reporterRpc = table === "venue_photos" ? "append_venue_photo_report_actor" : "append_visit_report_report_actor";
      if (url.pathname === `/rest/v1/rpc/${reporterRpc}` && request.method === "POST") {
        let body = "";
        for await (const chunk of request) body += String(chunk);
        const payload = JSON.parse(body) as { p_id: string; p_actor: string; p_reason: string | null };
        rpcActors.push(payload.p_actor);
        if (rpcError) return json(response, rpcError, 400);
        if (rpcResult !== undefined) return json(response, rpcResult);
        if (payload.p_id !== row.id) return json(response, false);
        // This models the atomic RPC boundary. The SQL suite separately covers
        // concurrency, idempotence, moderation semantics and executable grants.
        if (!row.report_actors.includes(payload.p_actor)) {
          row.report_actors.push(payload.p_actor);
          row.report_count = row.report_actors.length;
        }
        return json(response, true);
      }
      if (url.pathname !== `/rest/v1/${table}` || url.searchParams.get("id") !== `eq.${ID}`) {
        throw new Error(`Unexpected fixture endpoint: ${request.method} ${url.pathname}`);
      }
      if (request.method === "GET") {
        // Hold both pre-write reads. Each receives the same empty actor list,
        // just as two independent durable requests can read before either write.
        const snapshot = structuredClone(row);
        reads.push(snapshot);
        pendingReads.push({ response, snapshot });
        if (pendingReads.length === 2) releaseReads();
        else barrierTimer = setTimeout(() => {
          fixtureErrors.push("The second concurrent read did not reach the barrier");
          releaseReads();
        }, 2_000);
        return;
      }
      if (request.method === "PATCH") {
        let body = "";
        for await (const chunk of request) body += String(chunk);
        // Model ordinary SQL UPDATE assignment, not an atomic actor append.
        // A later PATCH overwrites the earlier report_actors value.
        row = { ...row, ...JSON.parse(body) };
        writes.push(structuredClone(row));
        response.writeHead(204);
        response.end();
        return;
      }
      throw new Error(`Unexpected fixture method: ${request.method}`);
    })().catch((error: unknown) => {
      fixtureErrors.push(error instanceof Error ? error.message : String(error));
      if (!response.headersSent) json(response, { message: "Synthetic fixture failure" }, 503);
      else response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture port unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  // A synthetic HTTPS configuration lets production policy remain real.
  // The fetch boundary rewrites only this reserved .invalid origin to loopback.
  vi.stubEnv("SUPABASE_URL", SDK_ORIGIN);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_synthetic_reporter_fixture");
  vi.stubEnv("RATE_LIMIT_SALT", "fixture-rate-salt-for-report-race-only");
  vi.stubEnv("ACTOR_HASH_SALT", "fixture-actor-salt-for-report-race-only");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("ADMIN_TOKEN", "synthetic-admin-token-for-reporter-tests-only");
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== SDK_ORIGIN) throw new Error("Non-fixture request refused by reporter fixture");
    const localUrl = new URL(url.pathname + url.search, origin);
    const localInput = input instanceof Request ? new Request(localUrl, input) : localUrl;
    return nativeFetch(localInput, init);
  });
  vi.resetModules();
  photoPost = (await import("@/app/api/venue-photos/route")).POST;
  visitPost = (await import("@/app/api/visit-reports/route")).POST;
}, 15_000);

afterEach(() => {
  releaseReads();
});

afterAll(async () => {
  releaseReads();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}, 5_000);

it.each(CASES)("retains both acknowledged reporters through POST $route", async (testCase) => {
  configure(testCase);
  const post = testCase.table === "venue_photos" ? photoPost : visitPost;
  const responses = await Promise.all(IPS.map((ip) => post(reportRequest(testCase.route, ip))));
  const acknowledgments = await Promise.all(responses.map(async (response) => ({
    status: response.status, body: await response.json(),
  })));
  const evidence = {
    route: testCase.route, acknowledgments,
    expectedActors: testCase.actors,
    reads: reads.map((read) => ({ count: read.report_count, actors: read.report_actors })),
    writes: writes.map((write) => ({ count: write.report_count, actors: write.report_actors })),
    persisted: { count: row.report_count, actors: row.report_actors },
  };
  expect(fixtureErrors).toEqual([]);
  expect(acknowledgments).toEqual([{ status: 200, body: { ok: true } }, { status: 200, body: { ok: true } }]);
  // Fixed hashes use the two synthetic platform addresses and fixture salts.
  // Both real limiter requests must carry those server-derived actors.
  for (const actor of testCase.actors) expect(limiterKeys.some((key) => key.endsWith(`:${actor}`))).toBe(true);
  expect(row.report_actors, JSON.stringify(evidence)).toEqual(expect.arrayContaining([...testCase.actors]));
  expect(row.report_count).toBe(2);
}, 10_000);

it.each(CASES)("refuses an unavailable production RPC through POST $route without fallback writes", async (testCase) => {
  const post = testCase.table === "venue_photos" ? photoPost : visitPost;
  for (const code of ["PGRST202", "42883", "57014"]) {
    configure(testCase);
    vi.stubEnv("VERCEL_ENV", "production");
    rpcError = { code, message: code === "57014" ? "Synthetic reporter statement cancellation" : "Synthetic reporter function missing from schema cache" };
    const response = await post(reportRequest(testCase.route));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "STORE_UNAVAILABLE", retryable: true });
    expect(rpcActors).toEqual([testCase.actors[0]]);
    expect(fixtureErrors).toEqual([]);
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
    expect(row.report_count).toBe(0);
  }
}, 10_000);

it.each(CASES)("refuses an invalid durable result through POST $route", async (testCase) => {
  configure(testCase);
  rpcResult = null;
  const post = testCase.table === "venue_photos" ? photoPost : visitPost;
  const response = await post(reportRequest(testCase.route));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "STORE_UNAVAILABLE", retryable: true });
  expect(row.report_count).toBe(0);
});

it.each(CASES)("keeps a missing target as 404 through POST $route", async (testCase) => {
  configure(testCase);
  rpcResult = false;
  const post = testCase.table === "venue_photos" ? photoPost : visitPost;
  const response = await post(reportRequest(testCase.route));
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  expect(row.report_count).toBe(0);
});

it.each(CASES)("keeps keyless local reporting through POST $route", async (testCase) => {
  configure(testCase);
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  const post = testCase.table === "venue_photos" ? photoPost : visitPost;
  let id: string;
  let readActors: () => Promise<string[] | undefined>;
  if (testCase.table === "venue_photos") {
    const photoStoreModule = await import("@/lib/venuePhotoStore");
    photoStoreModule.__resetVenuePhotos();
    const store = photoStoreModule.venuePhotoStore();
    const created = await store.create({ id: ID, venueId: "fixture-pub", wallCategory: "pint", placeLabel: "",
      authorActor: `profile:${ID}`, authorProfileId: ID, objectKey: `venue-photos/fixture-pub/${ID}.jpg`,
      drinkCategory: null, caption: "", width: 100, height: 100 });
    id = created.id;
    readActors = async () => (await store.getById(id))?.reportActors;
  } else {
    const visitStoreModule = await import("@/lib/visitReportsStore");
    visitStoreModule.__resetVisitReports();
    const store = visitStoreModule.visitReportsStore();
    const created = await store.create({ venueId: "fixture-pub", handle: "fixture_reporter", visitedAt: "2026-10-03",
      busyness: "steady", noise: "easy-to-talk", seating: "plenty", serviceWait: "quick", note: "" });
    id = created.id;
    readActors = async () => (await store.listForReview()).find((report) => report.id === id)?.reportActors;
  }
  const response = await post(reportRequest(testCase.route, IPS[0], id));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(await readActors()).toEqual([testCase.actors[0]]);
  expect(limiterKeys).toEqual([]);
  expect(rpcActors).toEqual([]);
  expect(reads).toEqual([]);
  expect(writes).toEqual([]);
});
