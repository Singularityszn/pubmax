// Disposable friend-location browser proof backend. No production credentials.
// Reproduce with node docs/proof/friend-location-local-backend.mjs.
// GoTrue is a loopback fixture; PostgreSQL, PostgREST and app routes remain real.
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startRlsSession } from "../../scripts/rls/session-harness.mjs";

const session = await startRlsSession();
process.on("uncaughtException", async (error) => { console.error(error.message); await session.stop(); process.exit(1); });
const directory = join(process.cwd(), "artifacts/friend-location-proof");
mkdirSync(directory, { recursive: true });
const migrationDirectory = join(process.cwd(), "supabase/migrations");
for (const name of readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql") && name > "20260806035204_0070_v1_release_security.sql").sort()) session.sqlFile(join(migrationDirectory, name));
await session.reloadPostgrestSchema();
const jwtSecret = "pubmax-rls-session-only-secret-32-bytes-minimum";
const mint = (subject, role = "authenticated") => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ sub: subject, role, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 14_400, iat: Math.floor(Date.now() / 1000) });
  const signature = createHmac("sha256", jwtSecret).update(`${head}.${payload}`).digest("base64url");
  return `${head}.${payload}.${signature}`;
};
const actors = ["alice", "bob", "carol"].map((handle, i) => {
  const id = `10000000-0000-4000-8000-00000000000${i + 1}`;
  const profileId = `20000000-0000-4000-8000-00000000000${i + 1}`;
  const accountId = `30000000-0000-4000-8000-00000000000${i + 1}`;
  return { handle: `proof${handle}`, id, profileId, accountId, token: mint(id), refresh: `proof-refresh-${id}` };
});
const seeded = session.sql(actors.map((actor) => `insert into auth.users(id) values('${actor.id}');
  insert into profiles(id,user_id,handle) values('${actor.profileId}','${actor.id}','${actor.handle}');
  insert into private_account_identities(user_id,date_of_birth) values('${actor.id}','1990-01-01');
  insert into private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id) values('${actor.accountId}','supabase:${actor.id}','${actor.id}','${actor.profileId}');`).join("\n") + `
  insert into follows(follower_id,followee_id) values('${actors[0].profileId}','${actors[1].profileId}'),('${actors[1].profileId}','${actors[0].profileId}'),('${actors[0].profileId}','${actors[2].profileId}'),('${actors[2].profileId}','${actors[0].profileId}');`);
if (!seeded.ok) { await session.stop(); throw new Error("Friend proof fixture could not seed identities."); }
function identity(token) {
  try {
    const [head, body, signature] = token.split(".");
    const expected = createHmac("sha256", jwtSecret).update(`${head}.${body}`).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    if (claims.exp <= Date.now() / 1000 || claims.role !== "authenticated") return null;
    const actor = actors.find((actor) => actor.id === claims.sub);
    if (!actor || session.sql(`select count(*) from auth.users where id='${actor.id}'`).out !== "1") return null;
    return actor;
  } catch { return null; }
}
function user(actor) { return { id: actor.id, aud: "authenticated", role: "authenticated", email: `${actor.handle}@example.invalid`, email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }; }
const server = createServer(async (request, response) => {
  const headers = { "content-type": "application/json", "access-control-allow-origin": request.headers.origin || "*", "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version", "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS" };
  const answer = (status, body) => { response.writeHead(status, headers); response.end(JSON.stringify(body)); };
  if (request.method === "OPTIONS") { answer(200, {}); return; }
  if (request.url.startsWith("/rest/v1")) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const proxyHeaders = { ...request.headers }; delete proxyHeaders.host;
    const upstream = await fetch(`${session.restBaseUrl}${request.url.slice("/rest/v1".length)}`, { method: request.method, headers: proxyHeaders, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const outgoing = { ...headers, ...Object.fromEntries(upstream.headers) };
    delete outgoing["content-length"]; delete outgoing["content-encoding"];
    response.writeHead(upstream.status, outgoing);
    response.end(Buffer.from(await upstream.arrayBuffer())); return;
  }
  if (request.url === "/auth/v1/settings") { answer(200, { external: { google: false, apple: false, azure: false } }); return; }
  if (request.url === "/auth/v1/user") {
    const actor = identity((request.headers.authorization || "").replace(/^Bearer /, ""));
    answer(actor ? 200 : 401, actor ? user(actor) : { code: "bad_jwt", msg: "Invalid token" }); return;
  }
  if (request.url.startsWith("/auth/v1/token")) {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    const actor = actors.find((actor) => actor.refresh === body.refresh_token);
    answer(actor ? 200 : 401, actor ? { access_token: mint(actor.id), refresh_token: actor.refresh, expires_in: 14_400, token_type: "bearer", user: user(actor) } : { msg: "Invalid refresh token" }); return;
  }
  if (request.url === "/auth/v1/logout") { answer(200, {}); return; }
  answer(404, { error: "Fixture endpoint absent" });
});
await new Promise((resolve) => server.listen(Number(process.env.FRIEND_LOCATION_PROOF_AUTH_PORT || 0), "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
writeFileSync(join(directory, "fixture.json"), JSON.stringify({ baseUrl, anonymousKey: mint("00000000-0000-4000-8000-000000000000", "anon"), serviceRoleKey: mint("00000000-0000-4000-8000-000000000000", "service_role"), actors: actors.map((actor) => ({ ...actor, session: { access_token: actor.token, refresh_token: actor.refresh, expires_in: 14_400, expires_at: Math.floor(Date.now() / 1000) + 14_400, token_type: "bearer", user: user(actor) } })) }, null, 2), { mode: 0o600 });
console.log(`Friend proof backend ready at ${baseUrl}. Disposable identities only; GoTrue fixture seam.`);
let stopped = false;
async function stop() { if (stopped) return; stopped = true; server.close(); await session.stop(); process.exit(0); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
