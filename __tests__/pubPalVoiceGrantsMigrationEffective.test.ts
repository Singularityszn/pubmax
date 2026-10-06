// Migration 0176 and the voice-token route against a real PostgreSQL 16
// cluster: the fault before, the server-side meter after, and the rollback.
//
// Pub Pal voice is paid for by the minute. Before 0176 the browser reported how
// long a session ran and `record_pub_pal_voice_minutes` billed that figure, so
// a signed-in caller who sent zero seconds on release was billed nothing and
// could start sessions for ever. This proof holds four things a unit test over
// mocked RPCs cannot: the fault really reproduces on the pre-0176 catalog, the
// route driven end to end over the real functions fills the allowance whatever
// the browser says, the settle really reads only the provider's duration, and
// the old client-trusted functions really are closed to every role.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  PAL_VOICE_GRANT_MINUTES,
  PAL_VOICE_MONTHLY_MINUTES,
  billableVoiceMinutes,
} from "@/lib/palVoiceMetering";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const ROLLBACKS = join(MIGRATIONS, "rollback");
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const LABEL = "0176_pub_pal_voice_grants";

const uuid = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const month = new Date().toISOString().slice(0, 7) + "-01";

const harness = vi.hoisted(() => ({
  sql: null as null | ((statement: string) => string),
  userId: "",
  conversations: new Map<string, { status: string; seconds: number | null }>(),
  issued: 0,
  lastConversationId: "",
}));

vi.mock("@/lib/authServer", () => ({ callerUserId: async () => harness.userId }));
vi.mock("@/lib/pubPalStore", () => ({
  getPubPalResult: async () => ({
    ok: true as const,
    value: {
      id: "pal-1",
      ownerId: harness.userId,
      name: "Ripley",
      adultAttestedAt: "2026-08-08T00:00:00.000Z",
      appearance: { species: "fox", signalAffinity: "gin", material: "hologram", accessory: "none" },
      personality: { playfulness: 62, energy: 54, storytelling: 58, relationship: "sidekick" },
      voice: { id: "ember", pace: 50, warmth: 64, energy: 52 },
      muted: false,
      hidden: false,
      proposalPreferences: { memories: false, routes: true },
      masteryPoints: 0,
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:00:00.000Z",
    },
  }),
}));
vi.mock("@/lib/pubPalToolTurnStore", () => ({ bindPubPalToolTurn: async () => {} }));
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  clientIp: () => "203.0.113.10",
  hashIp: (ip: string) => `hashed:${ip}`,
  checkRateLimitDurableDetailed: async () => ({ verdict: false, reason: "counted" }),
  // The service-role client: every RPC runs as service_role on the real cluster.
  requireSupabaseAdmin: () => ({
    rpc: async (name: string, params: Record<string, unknown>) => {
      const args = Object.entries(params)
        .map(([key, value]) =>
          `${key} => ${typeof value === "number" ? value : `'${String(value).replaceAll("'", "''")}'`}`)
        .join(", ");
      const answer = harness.sql?.(`set role service_role; select public.${name}(${args})`);
      return { data: answer === "t" ? true : answer === "f" ? false : answer, error: null };
    },
  }),
}));

import { POST } from "@/app/api/pub-pal/voice-token/route";

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL voice grant session did not start.");
  return session;
}

function usedMinutes(ownerId: string): number {
  return Number(
    db().sql(`
      select coalesce(max(used_minutes), 0) from public.pub_pal_voice_usage
      where owner_id = '${ownerId}' and usage_month = date '${month}'
    `),
  );
}

function grantRow(ownerId: string, conversationId: string): string {
  return db().sql(`
    select state || '|' || coalesce(settled_minutes::text, '-')
    from public.pub_pal_voice_grants
    where owner_id = '${ownerId}' and conversation_id = '${conversationId}'
  `);
}

const call = (fn: string, args: string) => asServiceRole(`select public.${fn}(${args})`);

/** The browser's two requests, the way the route receives them. */
async function issue(): Promise<Response> {
  return POST(new Request("http://localhost/api/pub-pal/voice-token", { method: "POST" }));
}

async function release(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request("http://localhost/api/pub-pal/voice-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release", ...body }),
    }),
  );
}

function stubProvider(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("get-signed-url")) {
        harness.issued += 1;
        harness.lastConversationId = `conv_grant${String(harness.issued).padStart(6, "0")}`;
        return Response.json({
          signed_url: "wss://voice.example/session",
          conversation_id: harness.lastConversationId,
        });
      }
      const id = decodeURIComponent(url.split("/conversations/")[1] ?? "");
      const conversation = harness.conversations.get(id);
      if (!conversation) return new Response(null, { status: 404 });
      return Response.json({
        status: conversation.status,
        metadata: conversation.seconds === null ? {} : { call_duration_secs: conversation.seconds },
      });
    }),
  );
}

beforeAll(async () => {
  if (skipReason) return;
  vi.stubEnv("ELEVENLABS_API_KEY", "server-only-key");
  vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "pub-pal-agent");
  session = await startPostgres({ label: "voice-grants-0176", database: "pubmax_voice_grants" });
  harness.sql = (statement) => db().sql(statement);
  db().applyFile(SESSION_FIXTURE);
  for (const name of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    if (name.includes(LABEL)) continue;
    db().applyFile(join(MIGRATIONS, name));
  }
  db().sql(`
    insert into auth.users (id) values
      ('${uuid(1)}'), ('${uuid(2)}'), ('${uuid(3)}'), ('${uuid(4)}'), ('${uuid(5)}'),
      ('${uuid(6)}'), ('${uuid(7)}');
  `);
}, 240_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await session?.stop();
});

describe.skipIf(skipReason !== null)("before 0176: the browser's duration is the meter", () => {
  it("lets a caller who reports zero seconds start sessions for ever", () => {
    // Exactly the three calls the pre-0176 route made: reserve, release, bill
    // the browser's figure. Twenty sessions is far past a 30 minute allowance.
    for (let i = 0; i < 20; i += 1) {
      expect(db().sql(call("consume_pub_pal_voice_trial", `'${uuid(1)}', date '${month}', 30`))).toBe("t");
      expect(db().sql(call("release_pub_pal_voice_trial", `'${uuid(1)}', date '${month}'`))).toBe("t");
      db().sql(call("record_pub_pal_voice_minutes", `'${uuid(1)}', date '${month}', 0`));
    }
    expect(usedMinutes(uuid(1))).toBe(0);
  });
});

describe.skipIf(skipReason !== null)("after 0176", () => {
  it("applies", () => {
    const name = readdirSync(MIGRATIONS).find((n) => n.includes(LABEL));
    expect(name).toBeDefined();
    db().applyFile(join(MIGRATIONS, name!));
    stubProvider();
  });

  it("closes the client-trusted functions to every role", async () => {
    for (const statement of [
      call("consume_pub_pal_voice_trial", `'${uuid(1)}', date '${month}', 30`),
      call("release_pub_pal_voice_trial", `'${uuid(1)}', date '${month}'`),
      call("record_pub_pal_voice_minutes", `'${uuid(1)}', date '${month}', 0`),
      asBrowserRole("authenticated", uuid(1), `select public.record_pub_pal_voice_minutes('${uuid(1)}', date '${month}', 0)`),
    ]) {
      const answer = await db().attempt(statement);
      expect(answer.ok, statement).toBe(false);
      expect(answer.said).toMatch(/permission denied for function/);
    }
  });

  it("fills the allowance whatever duration the browser reports", async () => {
    harness.userId = uuid(2);
    const statuses: number[] = [];
    // A caller who releases at once, claiming zero seconds, ten times and then
    // some. The provider says the call is still running when it is asked, and a
    // later, honest-looking release changes nothing for a grant it cannot read.
    for (let i = 0; i < 14; i += 1) {
      const response = await issue();
      statuses.push(response.status);
      if (response.status !== 200) continue;
      const { conversationId } = await response.json() as { conversationId: string };
      harness.conversations.set(conversationId, { status: "in-progress", seconds: 0 });
      expect(await (await release({ conversationId, durationSeconds: 0 })).json())
        .toMatchObject({ settled: false });
    }

    expect(statuses.filter((s) => s === 200)).toHaveLength(PAL_VOICE_MONTHLY_MINUTES / PAL_VOICE_GRANT_MINUTES);
    expect(statuses.slice(10)).toEqual([429, 429, 429, 429]);
    expect(usedMinutes(uuid(2))).toBe(PAL_VOICE_MONTHLY_MINUTES);
  });

  it("settles an honest call from the provider's duration, once", async () => {
    harness.userId = uuid(3);
    const issued = await issue();
    const { conversationId } = await issued.json() as { conversationId: string };
    expect(usedMinutes(uuid(3))).toBe(PAL_VOICE_GRANT_MINUTES);

    harness.conversations.set(conversationId, { status: "done", seconds: 41 });
    // The browser claims nine hours. The provider's 41 seconds is what is billed.
    expect(await (await release({ conversationId, durationSeconds: 32_400 })).json())
      .toMatchObject({ released: true, settled: true });
    expect(usedMinutes(uuid(3))).toBe(billableVoiceMinutes(41));
    expect(grantRow(uuid(3), conversationId)).toBe(`settled|${billableVoiceMinutes(41)}`);

    // Releasing again, or after the provider changes its mind, moves nothing.
    harness.conversations.set(conversationId, { status: "done", seconds: 1 });
    expect(await (await release({ conversationId })).json()).toMatchObject({ settled: false });
    expect(usedMinutes(uuid(3))).toBe(billableVoiceMinutes(41));
  });

  it("settles a call that never connected for free and a long call for what it ran", async () => {
    harness.userId = uuid(4);
    const idle = await (await issue()).json() as { conversationId: string };
    harness.conversations.set(idle.conversationId, { status: "done", seconds: 0 });
    await release({ conversationId: idle.conversationId });
    expect(usedMinutes(uuid(4))).toBe(0);

    const long = await (await issue()).json() as { conversationId: string };
    // A provider that let a call run past the cap bills the real length.
    harness.conversations.set(long.conversationId, { status: "done", seconds: 300 });
    await release({ conversationId: long.conversationId });
    expect(usedMinutes(uuid(4))).toBe(5);
  });

  it("will not settle somebody else's conversation or an unissued one", async () => {
    harness.userId = uuid(5);
    const mine = await (await issue()).json() as { conversationId: string };
    harness.conversations.set(mine.conversationId, { status: "done", seconds: 0 });
    harness.conversations.set("conv_neverissued1", { status: "done", seconds: 0 });

    harness.userId = uuid(6);
    expect(await (await release({ conversationId: mine.conversationId })).json())
      .toMatchObject({ settled: false });
    expect(await (await release({ conversationId: "conv_neverissued1" })).json())
      .toMatchObject({ settled: false });

    expect(usedMinutes(uuid(5))).toBe(PAL_VOICE_GRANT_MINUTES);
    expect(grantRow(uuid(5), mine.conversationId)).toBe("issued|-");
  });

  it("admits exactly the allowance when sessions start at once", async () => {
    const statements = Array.from({ length: 20 }, (_, i) =>
      asServiceRole(
        `select public.prepay_pub_pal_voice_grant('${uuid(7)}', date '${month}', '${uuid(1000 + i)}', 3, 30)`,
      ));
    const answers = await db().concurrentResults(statements);
    expect(answers.filter((a) => a === "t")).toHaveLength(10);
    expect(usedMinutes(uuid(7))).toBe(30);
    expect(db().sql(`select count(*) from public.pub_pal_voice_grants where owner_id = '${uuid(7)}'`)).toBe("10");
  });

  it("refunds only a grant the server never handed out, once", () => {
    const owner = uuid(1);
    const grant = uuid(2000);
    expect(db().sql(call("prepay_pub_pal_voice_grant", `'${owner}', date '${month}', '${grant}', 3, 30`))).toBe("t");
    // A retried grant id never mints a second grant.
    expect(db().sql(call("prepay_pub_pal_voice_grant", `'${owner}', date '${month}', '${grant}', 3, 30`))).toBe("f");
    expect(usedMinutes(owner)).toBe(3);

    // Another owner cannot refund it.
    expect(db().sql(call("refund_pub_pal_voice_grant", `'${uuid(2)}', '${grant}'`))).toBe("f");
    expect(db().sql(call("refund_pub_pal_voice_grant", `'${owner}', '${grant}'`))).toBe("t");
    expect(db().sql(call("refund_pub_pal_voice_grant", `'${owner}', '${grant}'`))).toBe("f");
    expect(usedMinutes(owner)).toBe(0);

    // Once linked to a conversation the grant is a URL in a browser: no refund.
    const linked = uuid(2001);
    db().sql(call("prepay_pub_pal_voice_grant", `'${owner}', date '${month}', '${linked}', 3, 30`));
    expect(db().sql(call("link_pub_pal_voice_conversation", `'${owner}', '${linked}', 'conv_refundtest1'`))).toBe("t");
    expect(db().sql(call("refund_pub_pal_voice_grant", `'${owner}', '${linked}'`))).toBe("f");
    expect(usedMinutes(owner)).toBe(3);
  });

  it("refuses a malformed month, minutes, conversation id or duration", () => {
    const owner = uuid(1);
    const before = usedMinutes(owner);
    expect(db().sql(call("prepay_pub_pal_voice_grant", `'${owner}', date '2026-10-15', '${uuid(2100)}', 3, 30`))).toBe("f");
    expect(db().sql(call("prepay_pub_pal_voice_grant", `'${owner}', date '${month}', '${uuid(2101)}', 0, 30`))).toBe("f");
    const grant = uuid(2102);
    db().sql(call("prepay_pub_pal_voice_grant", `'${owner}', date '${month}', '${grant}', 3, 30`));
    expect(db().sql(call("link_pub_pal_voice_conversation", `'${owner}', '${grant}', '../agents'`))).toBe("f");
    expect(db().sql(call("link_pub_pal_voice_conversation", `'${owner}', '${grant}', 'conv_settleform1'`))).toBe("t");
    for (const seconds of ["-1", "86401", "null"]) {
      expect(db().sql(call("settle_pub_pal_voice_conversation", `'${owner}', 'conv_settleform1', ${seconds}`)), seconds).toBe("f");
    }
    expect(usedMinutes(owner)).toBe(before + 3);
  });

  it("holds the grants and functions to service_role alone", async () => {
    for (const statement of [
      `select count(*) from public.pub_pal_voice_grants`,
      `select public.prepay_pub_pal_voice_grant('${uuid(1)}', date '${month}', '${uuid(2200)}', 3, 30)`,
      `select public.refund_pub_pal_voice_grant('${uuid(1)}', '${uuid(2200)}')`,
      `select public.link_pub_pal_voice_conversation('${uuid(1)}', '${uuid(2200)}', 'conv_browser0001')`,
      `select public.settle_pub_pal_voice_conversation('${uuid(1)}', 'conv_browser0001', 0)`,
    ]) {
      for (const [role, sub] of [["anon", null], ["authenticated", uuid(1)]] as const) {
        const answer = await db().attempt(asBrowserRole(role, sub, statement));
        expect(answer.ok, `${role}: ${statement}`).toBe(false);
        expect(answer.said).toMatch(/permission denied/);
      }
    }
  });
});

describe.skipIf(skipReason !== null)("rollback 0176", () => {
  it("reopens the old functions to service_role and removes the new ones", () => {
    const name = readdirSync(ROLLBACKS).find((n) => n.includes(LABEL));
    expect(name).toBeDefined();
    db().applyFile(join(ROLLBACKS, name!));

    expect(db().sql(call("record_pub_pal_voice_minutes", `'${uuid(1)}', date '${month}', 0`))).toMatch(/^[tf]$/);
    expect(
      db().sql(`
        select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (
          'prepay_pub_pal_voice_grant', 'refund_pub_pal_voice_grant',
          'link_pub_pal_voice_conversation', 'settle_pub_pal_voice_conversation')
      `),
    ).toBe("0");
    expect(db().sql(`select to_regclass('public.pub_pal_voice_grants') is null`)).toBe("t");
  });
});
