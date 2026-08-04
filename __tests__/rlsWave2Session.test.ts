/**
 * Effective RLS session tests.
 *
 * Spins up throwaway local Postgres and PostgREST, applies the wave-2 policy
 * set, and proves deny/allow with real roles and HTTP requests:
 *   anonymous  → DENIED
 *   owner      → ALLOWED (where product allows)
 *   other user → DENIED
 *   hidden / friends-gated rows → DENIED to everyone they should be
 *
 * When PostgreSQL 16+ binaries are absent (e.g. Vercel build hosts), every
 * test is SKIPPED with a loud reason — never reported as pass. CI job
 * `rls-session` installs Postgres 16 plus PostgREST 14 and runs this suite.
 *
 * Never applies migrations to a live Supabase project.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

type Session = {
  appliedForwardMigrations: string[];
  preWaveCatalogSnapshot: string;
  catalogSnapshot: () => string;
  sql: (
    statement: string,
    opts?: { asRole?: string | null; sub?: string | null },
  ) => { ok: boolean; out: string; err: string };
  sqlFile: (path: string) => void;
  rest: (
    path: string,
    opts: { method?: string; sub?: string | null; headers?: Record<string, string> },
  ) => Promise<{ status: number; body: unknown; text: string }>;
  stop: () => Promise<void>;
  rollbackPath: string;
};

const EXPECTED_WAVE2_MIGRATIONS = [
  "20260803200000_0065_rls_wave2_helpers.sql",
  "20260803201000_0066_rls_wave2_priority_policies.sql",
  "20260803202000_0067_rls_wave2_owner_policies.sql",
  "20260803203000_0068_rls_wave2_service_role_only.sql",
  "20260803204000_0069_rls_wave2_rpc_hardening.sql",
];

const OWNER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const FRIEND = "33333333-3333-3333-3333-333333333333";
const STRANGER = "44444444-4444-4444-4444-444444444444";

let session: Session | null = null;
/** Set only when Postgres binaries are genuinely missing. Loud skip, not pass. */
let skipReason: string | null = null;

beforeAll(async () => {
  // @ts-expect-error — plain .mjs harness, no declaration file (see scripts/rls/).
  const mod = await import("../scripts/rls/session-harness.mjs");
  const missing: string | null = mod.missingPostgresReason();
  if (missing) {
    skipReason = missing;
    // Loud, visible in CI/Vercel logs — a SKIP is not a green pass.
    console.error(
      [
        "",
        "══════════════════════════════════════════════════════════════",
        "SKIPPING RLS session tests (not a pass)",
        `Reason: ${missing}`,
        "CI job `rls-session` runs these with PostgreSQL 16.",
        "══════════════════════════════════════════════════════════════",
        "",
      ].join("\n"),
    );
    return;
  }

  try {
    session = (await mod.startRlsSession()) as Session;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Binaries present but cluster failed — fail hard, do not skip.
    throw new Error(`RLS session harness failed to start: ${msg}`);
  }

  // Seed identities and rows as table owner (bypasses RLS).
  const seed = `
    insert into auth.users (id) values
      ('${OWNER}'),
      ('${OTHER}'),
      ('${FRIEND}'),
      ('${STRANGER}');

    insert into public.profiles (id, user_id, handle) values
      ('a1111111-1111-1111-1111-111111111111', '${OWNER}', 'alice'),
      ('b2222222-2222-2222-2222-222222222222', '${OTHER}', 'bob'),
      ('c3333333-3333-3333-3333-333333333333', '${FRIEND}', 'cara'),
      ('d4444444-4444-4444-4444-444444444444', '${STRANGER}', 'dan');

    -- cara follows alice (cara is a follower of the author)
    insert into public.follows (follower_id, followee_id) values
      ('c3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111');

    -- bob follows alice one-way is NOT enough for mutual; product uses
    -- author-followers so bob does NOT qualify for friends drops.
    -- (deliberately no bob→alice edge)

    insert into public.visit_reports (id, venue_id, handle, price_gbp, status, visibility) values
      ('e1000000-0000-4000-8000-000000000001', 'v1', 'alice', 5.50, 'visible', 'public'),
      ('e1000000-0000-4000-8000-000000000002', 'v1', 'alice', 5.50, 'visible', 'friends'),
      ('e1000000-0000-4000-8000-000000000003', 'v1', 'alice', 5.50, 'visible', 'legacy'),
      ('e1000000-0000-4000-8000-000000000004', 'v1', 'alice', 5.50, 'hidden',  'public'),
      ('e1000000-0000-4000-8000-000000000005', 'v1', 'alice', 5.50, 'pending', 'public');

    insert into public.community_prices (id, venue_id, drink_category, price_pennies, actor, contributor_handle, hidden_at) values
      ('f1000000-0000-4000-8000-000000000001', 'v1', 'beer', 550, 'profile:22222222-2222-2222-2222-222222222222', 'bob', null),
      ('f1000000-0000-4000-8000-000000000002', 'v1', 'beer', 600, 'profile:a1111111-1111-1111-1111-111111111111', 'alice', now());

    insert into public.private_account_identities (user_id, date_of_birth, full_name) values
      ('${OWNER}', '1990-01-01', 'Alice Example');

    insert into public.plans (id, title, start_time, owner_user_id) values
      ('a1000000-0000-4000-8000-000000000001', 'Alice plan', now(), '${OWNER}'),
      ('a1000000-0000-4000-8000-000000000002', 'Bob plan', now(), '${OTHER}');

    insert into public.conversations (id, handle_a, handle_b, user_id_a, user_id_b) values
      ('b1000000-0000-4000-8000-000000000001', 'alice', 'cara', '${OWNER}', '${FRIEND}');

    insert into public.messages (id, conversation_id, sender_handle, body) values
      ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'alice', 'hello crew');

    insert into public.saved_pubs (id, profile_id, venue_id) values
      ('c1000000-0000-4000-8000-000000000001', 'a1111111-1111-1111-1111-111111111111', 'v1'),
      ('c1000000-0000-4000-8000-000000000002', 'b2222222-2222-2222-2222-222222222222', 'v2');

    insert into public.structured_visit_reports (id, venue_id, handle, visited_at, note, status) values
      ('d1000000-0000-4000-8000-000000000001', 'v1', 'alice', current_date, 'visible visit', 'visible'),
      ('d1000000-0000-4000-8000-000000000002', 'v1', 'alice', current_date - 1, 'hidden visit', 'hidden');

    insert into public.rounds (id, code, title, created_by_handle) values
      ('e2000000-0000-4000-8000-000000000001', 'ABCD', 'Alice round', 'alice');

    -- Night story graph: alice hosts published and draft stories. Bob owns
    -- the moments joined to them, proving a moment author cannot mutate the
    -- host-owned join through a published-row read policy.
    insert into public.night_memories (id, owner_id, title) values
      ('aa000000-0000-4000-8000-000000000001', '${OWNER}', 'Alice night');
    insert into public.night_moments (id, memory_id, owner_id, kind, caption) values
      ('ab000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', '${OTHER}', 'event', 'published moment'),
      ('ab000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000001', '${OWNER}', 'event', 'private moment'),
      ('ab000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-000000000001', '${OTHER}', 'event', 'draft story moment');
    insert into public.night_stories (id, memory_id, host_editor_id, title, status, visibility, published_at) values
      ('ac000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', '${OWNER}', 'Published night', 'published', 'public', now()),
      ('ac000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000001', '${OWNER}', 'Draft night', 'draft', 'private', null);
    insert into public.night_story_moments (story_id, moment_id, position) values
      ('ac000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001', 0),
      ('ac000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000003', 0);
  `;
  const r = session!.sql(seed);
  if (!r.ok) {
    throw new Error(`seed failed: ${r.err}\n${r.out}`);
  }
}, 60_000);

afterAll(async () => {
  if (session) await session.stop();
});

// Every test skips with the same loud reason when Postgres is absent.
// Vitest reports these as skipped, never as passed.
beforeEach((ctx) => {
  if (skipReason) {
    ctx.skip(true, skipReason);
  }
});

function requireSession(): Session {
  if (skipReason) {
    throw new Error(`unreachable: test should have been skipped: ${skipReason}`);
  }
  if (!session) {
    throw new Error("RLS session not started");
  }
  return session;
}

function count(
  table: string,
  where: string,
  opts: { asRole?: string | null; sub?: string | null },
): number {
  // Scalar expression so the harness can wrap it as RESULT:<n>.
  const r = requireSession().sql(
    `select count(*)::text from public.${table} where ${where}`,
    opts,
  );
  if (!r.ok) {
    // privilege or RLS denial for whole-table access surfaces as error
    if (/permission denied|row-level security/i.test(r.err)) return 0;
    throw new Error(`count ${table}: ${r.err}`);
  }
  const n = Number(r.out);
  return Number.isFinite(n) ? n : 0;
}

function canSelect(
  table: string,
  where: string,
  opts: { asRole?: string | null; sub?: string | null },
): boolean {
  return count(table, where, opts) > 0;
}

function tryWrite(
  statement: string,
  opts: { asRole?: string | null; sub?: string | null },
): boolean {
  const r = requireSession().sql(statement, opts);
  return r.ok;
}

/**
 * Attempt a DELETE as a client role, then count remaining rows as table owner
 * (bypasses RLS). RLS that filters the row out of DELETE returns success with
 * 0 rows affected - so "ok" alone is not proof the moderation record survived.
 */
function rowSurvivesDelete(
  table: string,
  where: string,
  opts: { asRole?: string | null; sub?: string | null },
): boolean {
  const s = requireSession();
  // Privilege denial or an RLS-filtered zero-row DELETE both protect the row.
  // Any other SQL error means the test did not exercise DELETE successfully.
  const deleted = s.sql(`delete from public.${table} where ${where}`, opts);
  if (!deleted.ok && !/permission denied/i.test(deleted.err)) {
    throw new Error(`delete ${table}: ${deleted.err}`);
  }
  const left = s.sql(`select count(*)::text from public.${table} where ${where}`);
  if (!left.ok) throw new Error(`post-delete count ${table}: ${left.err}`);
  return Number(left.out) === 1;
}

async function expectHiddenThroughPostgrest({
  table,
  filter,
  sqlWhere,
  sub,
}: {
  table: string;
  filter: string;
  sqlWhere: string;
  sub: string;
}) {
  const s = requireSession();
  const selected = await s.rest(`/rest/v1/${table}?${filter}`, { sub });
  expect(selected.status).toBe(200);
  expect(selected.body).toEqual([]);

  const deleted = await s.rest(`/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    sub,
    headers: { Prefer: "return=representation" },
  });
  expect([200, 401, 403]).toContain(deleted.status);
  if (deleted.status === 200) expect(deleted.body).toEqual([]);

  const remaining = s.sql(
    `select count(*)::text from public.${table} where ${sqlWhere}`,
  );
  expect(remaining.ok).toBe(true);
  expect(Number(remaining.out)).toBe(1);
}

describe("migration execution", () => {
  it("applies every exact wave-2 migration file", () => {
    expect(requireSession().appliedForwardMigrations).toEqual(
      EXPECTED_WAVE2_MIGRATIONS,
    );
  });
});

describe("private Pint Drop storage", () => {
  it("denies direct client reads and permits service-role reads", () => {
    const s = requireSession();
    const seeded = s.sql(`
      insert into storage.objects (bucket_id, name, owner_id)
      values ('pint-drops', 'v1/drop-1/pint.jpg', '${OWNER}')
    `);
    expect(seeded.ok, seeded.err).toBe(true);

    for (const role of ["anon", "authenticated"]) {
      const read = s.sql(
        "select count(*)::text from storage.objects where bucket_id = 'pint-drops'",
        { asRole: role, sub: role === "authenticated" ? OWNER : null },
      );
      expect(read.ok, read.err).toBe(true);
      expect(Number(read.out)).toBe(0);
    }

    const serviceRead = s.sql(
      "select count(*)::text from storage.objects where bucket_id = 'pint-drops'",
      { asRole: "service_role" },
    );
    expect(serviceRead.ok, serviceRead.err).toBe(true);
    expect(Number(serviceRead.out)).toBe(1);
  });
});

describe("visit_reports — effective RLS", () => {
  it("denies anonymous on every drop", () => {
    expect(canSelect("visit_reports", "true", { asRole: "anon" })).toBe(false);
  });

  it("allows any authenticated reader on a visible public drop", () => {
    expect(
      canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(true);
  });

  it("denies a non-follower on a friends-only drop", () => {
    expect(
      canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000002'", {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(false);
    expect(
      canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000002'", {
        asRole: "authenticated",
        sub: STRANGER,
      }),
    ).toBe(false);
  });

  it("allows the author and a follower on a friends-only drop", () => {
    expect(
      canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000002'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(true);
    expect(
      canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000002'", {
        asRole: "authenticated",
        sub: FRIEND,
      }),
    ).toBe(true);
  });

  it("allows only the author on a legacy drop", () => {
    expect(
      canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000003'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(true);
    expect(
      canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000003'", {
        asRole: "authenticated",
        sub: FRIEND,
      }),
    ).toBe(false);
  });

  it("denies hidden and pending to the author (and everyone else)", () => {
    for (const sub of [OWNER, OTHER, FRIEND]) {
      expect(
        canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000004'", {
          asRole: "authenticated",
          sub,
        }),
      ).toBe(false);
      expect(
        canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000005'", {
          asRole: "authenticated",
          sub,
        }),
      ).toBe(false);
    }
  });

  it("keeps a hidden drop undeletable by its author (moderation record survives)", () => {
    expect(
      rowSurvivesDelete(
        "visit_reports",
        "id = 'e1000000-0000-4000-8000-000000000004'",
        { asRole: "authenticated", sub: OWNER },
      ),
    ).toBe(true);
  });
});

describe("community_prices — effective RLS", () => {
  it("denies anonymous", () => {
    expect(canSelect("community_prices", "true", { asRole: "anon" })).toBe(false);
  });

  it("allows authenticated select of non-hidden rows", () => {
    expect(
      canSelect("community_prices", "id = 'f1000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(true);
  });

  it("denies hidden rows even to the contributing actor", () => {
    expect(
      canSelect("community_prices", "id = 'f1000000-0000-4000-8000-000000000002'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(false);
    expect(
      canSelect("community_prices", "id = 'f1000000-0000-4000-8000-000000000002'", {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(false);
  });

  it("keeps a hidden price undeletable by its contributing actor", () => {
    expect(
      rowSurvivesDelete(
        "community_prices",
        "id = 'f1000000-0000-4000-8000-000000000002'",
        { asRole: "authenticated", sub: OWNER },
      ),
    ).toBe(true);
  });
});

describe("private_account_identities — effective RLS", () => {
  it("denies anonymous select", () => {
    expect(
      canSelect("private_account_identities", "true", { asRole: "anon" }),
    ).toBe(false);
  });

  it("allows owner select and denies other user", () => {
    expect(
      canSelect("private_account_identities", "true", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(true);
    expect(
      canSelect("private_account_identities", "true", {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(false);
  });

  it("denies authenticated insert/update/delete (service-role only writes)", () => {
    expect(
      tryWrite(
        `insert into public.private_account_identities (user_id, date_of_birth)
         values ('${OTHER}', '1991-02-02');`,
        { asRole: "authenticated", sub: OTHER },
      ),
    ).toBe(false);
    expect(
      tryWrite(
        `update public.private_account_identities set full_name = 'hacked'
         where user_id = '${OWNER}';`,
        { asRole: "authenticated", sub: OWNER },
      ),
    ).toBe(false);
    expect(
      tryWrite(
        `delete from public.private_account_identities where user_id = '${OWNER}';`,
        { asRole: "authenticated", sub: OWNER },
      ),
    ).toBe(false);
  });
});

describe("plans — effective RLS", () => {
  it("denies anonymous", () => {
    expect(canSelect("plans", "true", { asRole: "anon" })).toBe(false);
  });

  it("allows owner and denies other user", () => {
    expect(
      canSelect("plans", "id = 'a1000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(true);
    expect(
      canSelect("plans", "id = 'a1000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(false);
  });
});

describe("messages — effective RLS", () => {
  it("denies anonymous", () => {
    expect(canSelect("messages", "true", { asRole: "anon" })).toBe(false);
  });

  it("allows a conversation participant and denies a stranger", () => {
    expect(
      canSelect("messages", "id = 'b2000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(true);
    expect(
      canSelect("messages", "id = 'b2000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: FRIEND,
      }),
    ).toBe(true);
    expect(
      canSelect("messages", "id = 'b2000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: STRANGER,
      }),
    ).toBe(false);
  });
});

describe("saved_pubs — effective RLS", () => {
  it("denies anonymous", () => {
    expect(canSelect("saved_pubs", "true", { asRole: "anon" })).toBe(false);
  });

  it("allows owner and denies other user", () => {
    expect(
      canSelect("saved_pubs", "id = 'c1000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(true);
    expect(
      canSelect("saved_pubs", "id = 'c1000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(false);
  });
});

describe("structured_visit_reports + rounds — effective RLS", () => {
  it("hides hidden structured visit reports from their author", () => {
    expect(
      canSelect("structured_visit_reports", "id = 'd1000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(true);
    expect(
      canSelect("structured_visit_reports", "id = 'd1000000-0000-4000-8000-000000000002'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(false);
  });

  it("keeps a hidden structured visit report undeletable by its author", () => {
    expect(
      rowSurvivesDelete(
        "structured_visit_reports",
        "id = 'd1000000-0000-4000-8000-000000000002'",
        { asRole: "authenticated", sub: OWNER },
      ),
    ).toBe(true);
  });

  it("denies client roles on rounds (service-role only)", () => {
    expect(canSelect("rounds", "true", { asRole: "anon" })).toBe(false);
    expect(
      canSelect("rounds", "true", { asRole: "authenticated", sub: OWNER }),
    ).toBe(false);
  });
});

describe("night_story_moments / night_stories / night_moments - write isolation", () => {
  const PUBLISHED_STORY = "ac000000-0000-4000-8000-000000000001";
  const DRAFT_STORY = "ac000000-0000-4000-8000-000000000002";
  const STORY_MOMENT = "ab000000-0000-4000-8000-000000000001";
  const PRIVATE_MOMENT = "ab000000-0000-4000-8000-000000000002";

  it("lets any authenticated reader select moments on a published public story", () => {
    expect(
      canSelect(
        "night_story_moments",
        `story_id = '${PUBLISHED_STORY}' and moment_id = '${STORY_MOMENT}'`,
        { asRole: "authenticated", sub: OTHER },
      ),
    ).toBe(true);
  });

  it("lets a moment author read but not delete its published story join through PostgREST", async () => {
    const filter =
      "story_id=eq.ac000000-0000-4000-8000-000000000001&moment_id=eq.ab000000-0000-4000-8000-000000000001&select=story_id,moment_id";
    const s = requireSession();
    const selected = await s.rest(`/rest/v1/night_story_moments?${filter}`, {
      sub: OTHER,
    });
    expect(selected.status).toBe(200);
    expect(selected.body).toEqual([
      {
        story_id: "ac000000-0000-4000-8000-000000000001",
        moment_id: "ab000000-0000-4000-8000-000000000001",
      },
    ]);

    const deleted = await s.rest(`/rest/v1/night_story_moments?${filter}`, {
      method: "DELETE",
      sub: OTHER,
      headers: { Prefer: "return=representation" },
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual([]);

    const remaining = s.sql(
      `select count(*)::text from public.night_story_moments
       where story_id = '${PUBLISHED_STORY}' and moment_id = '${STORY_MOMENT}'`,
    );
    expect(remaining.ok).toBe(true);
    expect(Number(remaining.out)).toBe(1);
  });

  it("denies non-host DELETE on a published story moment (moderation record / join survives)", () => {
    // Gate defect: FOR ALL + published USING let any authenticated user delete.
    expect(
      rowSurvivesDelete(
        "night_story_moments",
        `story_id = '${PUBLISHED_STORY}' and moment_id = '${STORY_MOMENT}'`,
        { asRole: "authenticated", sub: OTHER },
      ),
    ).toBe(true);
    // Host may still remove the join row (product path is service-role, but
    // the host write policy is intentional).
    const hostDelete = requireSession().sql(
      `delete from public.night_story_moments
       where story_id = '${PUBLISHED_STORY}' and moment_id = '${STORY_MOMENT}'`,
      { asRole: "authenticated", sub: OWNER },
    );
    expect(hostDelete.ok, hostDelete.err).toBe(true);
    // Restore for later assertions in this file.
    const restore = requireSession().sql(
      `insert into public.night_story_moments (story_id, moment_id, position)
       values ('${PUBLISHED_STORY}', '${STORY_MOMENT}', 0)
       on conflict do nothing`,
    );
    expect(restore.ok).toBe(true);
  });

  it("denies non-host DELETE on a draft night story and a private night moment", () => {
    expect(
      rowSurvivesDelete("night_stories", `id = '${DRAFT_STORY}'`, {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(true);
    expect(
      rowSurvivesDelete("night_moments", `id = '${PRIVATE_MOMENT}'`, {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(true);
  });

  it("denies non-owner SELECT of a private night moment and draft story", () => {
    expect(
      canSelect("night_moments", `id = '${PRIVATE_MOMENT}'`, {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(false);
    expect(
      canSelect("night_stories", `id = '${DRAFT_STORY}'`, {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(false);
  });
});

describe("hidden rows through PostgREST", () => {
  it.each([
    {
      table: "night_moments",
      filter: "id=eq.ab000000-0000-4000-8000-000000000002&select=id",
      sqlWhere: "id = 'ab000000-0000-4000-8000-000000000002'",
      sub: OTHER,
    },
    {
      table: "night_stories",
      filter: "id=eq.ac000000-0000-4000-8000-000000000002&select=id",
      sqlWhere: "id = 'ac000000-0000-4000-8000-000000000002'",
      sub: OTHER,
    },
    {
      table: "night_story_moments",
      filter:
        "story_id=eq.ac000000-0000-4000-8000-000000000002&moment_id=eq.ab000000-0000-4000-8000-000000000003&select=story_id,moment_id",
      sqlWhere:
        "story_id = 'ac000000-0000-4000-8000-000000000002' and moment_id = 'ab000000-0000-4000-8000-000000000003'",
      sub: OTHER,
    },
    {
      table: "community_prices",
      filter: "id=eq.f1000000-0000-4000-8000-000000000002&select=id",
      sqlWhere: "id = 'f1000000-0000-4000-8000-000000000002'",
      sub: OWNER,
    },
    {
      table: "visit_reports",
      filter: "id=eq.e1000000-0000-4000-8000-000000000004&select=id",
      sqlWhere: "id = 'e1000000-0000-4000-8000-000000000004'",
      sub: OWNER,
    },
  ])(
    "$table cannot be observed or deleted by its protected actor",
    async (testCase) => {
      await expectHiddenThroughPostgrest(testCase);
    },
  );
});

describe("rollback path", () => {
  it("restores the complete pre-wave policy and privilege catalog", () => {
    const s = requireSession();
    expect(() => s.sqlFile(s.rollbackPath)).not.toThrow();
    expect(s.catalogSnapshot()).toBe(s.preWaveCatalogSnapshot);
  });
});
