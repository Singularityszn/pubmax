/**
 * Effective RLS session tests.
 *
 * Spins up a throwaway local Postgres, applies the wave-2 policy set, and
 * proves deny/allow with real roles:
 *   anonymous  → DENIED
 *   owner      → ALLOWED (where product allows)
 *   other user → DENIED
 *   hidden / friends-gated rows → DENIED to everyone they should be
 *
 * When PostgreSQL 16+ binaries are absent (e.g. Vercel build hosts), every
 * test is SKIPPED with a loud reason — never reported as pass. CI job
 * `rls-session` installs Postgres 16 and runs this suite for real.
 *
 * Never applies migrations to a live Supabase project.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

type Session = {
  sql: (
    statement: string,
    opts?: { asRole?: string | null; sub?: string | null },
  ) => { ok: boolean; out: string; err: string };
  sqlFile: (path: string) => void;
  stop: () => Promise<void>;
  rollbackPath: string;
};

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
    // eslint-disable-next-line no-console
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
      ('f1000000-0000-4000-8000-000000000001', 'v1', 'beer', 550, 'profile:a1111111-1111-1111-1111-111111111111', 'alice', null),
      ('f1000000-0000-4000-8000-000000000002', 'v1', 'beer', 600, 'profile:a1111111-1111-1111-1111-111111111111', 'alice', now());

    insert into public.private_account_identities (user_id, date_of_birth, full_name) values
      ('${OWNER}', '1990-01-01', 'Alice Example');

    insert into public.plans (id, title, owner_user_id) values
      ('a1000000-0000-4000-8000-000000000001', 'Alice plan', '${OWNER}'),
      ('a1000000-0000-4000-8000-000000000002', 'Bob plan', '${OTHER}');

    insert into public.conversations (id, handle_a, handle_b, user_id_a, user_id_b) values
      ('b1000000-0000-4000-8000-000000000001', 'alice', 'cara', '${OWNER}', '${FRIEND}');

    insert into public.messages (id, conversation_id, sender_handle, body) values
      ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'alice', 'hello crew');

    insert into public.saved_pubs (id, profile_id, venue_id) values
      ('c1000000-0000-4000-8000-000000000001', 'a1111111-1111-1111-1111-111111111111', 'v1'),
      ('c1000000-0000-4000-8000-000000000002', 'b2222222-2222-2222-2222-222222222222', 'v2');

    insert into public.structured_visit_reports (id, venue_id, handle, note, status) values
      ('d1000000-0000-4000-8000-000000000001', 'v1', 'alice', 'visible visit', 'visible'),
      ('d1000000-0000-4000-8000-000000000002', 'v1', 'alice', 'hidden visit', 'hidden');

    insert into public.rounds (id, code) values ('e2000000-0000-4000-8000-000000000001', 'ABCD');
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

  it("denies client roles on rounds (service-role only)", () => {
    expect(canSelect("rounds", "true", { asRole: "anon" })).toBe(false);
    expect(
      canSelect("rounds", "true", { asRole: "authenticated", sub: OWNER }),
    ).toBe(false);
  });
});

describe("rollback path", () => {
  it("applies the wave-2 rollback script without error", () => {
    const s = requireSession();
    // Apply against the same throwaway cluster — proves the script is runnable.
    expect(() => s.sqlFile(s.rollbackPath)).not.toThrow();
    // After rollback, prior rounds public read is restored.
    const r = s.sql(
      `select count(*)::text from pg_policies where tablename = 'rounds' and policyname = 'rounds_public_read'`,
    );
    expect(r.ok).toBe(true);
    expect(Number(r.out)).toBe(1);
    // Wave-2 helpers must be gone so they cannot be left half-applied.
    const helpers = s.sql(
      `select count(*)::text from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'rls_%'`,
    );
    expect(helpers.ok).toBe(true);
    expect(Number(helpers.out)).toBe(0);
  });
});
