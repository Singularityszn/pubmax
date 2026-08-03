/**
 * RLS wave 2 — migration contract tests.
 *
 * These assert the SQL policies express deny/allow for anonymous, owner, and
 * other signed-in users. They do not open a live Postgres; house style is to
 * pin the migration text (see apiOnlySocialReadsMigration.test.ts).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

const HELPERS = readMigration("20260803200000_0065_rls_wave2_helpers.sql");
const PRIORITY = readMigration("20260803201000_0066_rls_wave2_priority_policies.sql");
const OWNER = readMigration("20260803202000_0067_rls_wave2_owner_policies.sql");
const SERVICE = readMigration("20260803203000_0068_rls_wave2_service_role_only.sql");
const RPC = readMigration("20260803204000_0069_rls_wave2_rpc_hardening.sql");

const N_HELPERS = normalize(HELPERS);
const N_PRIORITY = normalize(PRIORITY);
const N_OWNER = normalize(OWNER);
const N_SERVICE = normalize(SERVICE);
const N_RPC = normalize(RPC);
const ALL = `${HELPERS}\n${PRIORITY}\n${OWNER}\n${SERVICE}\n${RPC}`;
const N_ALL = normalize(ALL);

/** Extract one create policy body (normalized) for assertions. */
function policyBody(sql: string, policyName: string): string {
  const re = new RegExp(
    `create\\s+policy\\s+${policyName}\\s+on\\s+public\\.(\\w+)([\\s\\S]*?)(?=\\n(?:drop\\s+policy|create\\s+policy|revoke\\s+|grant\\s+|commit|begin|-- ═))`,
    "i",
  );
  const m = sql.match(re);
  expect(m, `expected policy ${policyName}`).toBeTruthy();
  return normalize(m![0]);
}

describe("RLS wave 2 helpers", () => {
  it("ships security-definer helpers that read auth.uid(), never a client-supplied uid", () => {
    expect(N_HELPERS).toContain("create or replace function public.rls_owns_profile");
    expect(N_HELPERS).toContain("create or replace function public.rls_owns_handle");
    expect(N_HELPERS).toContain("create or replace function public.rls_is_plan_participant");
    expect(N_HELPERS).toContain("create or replace function public.rls_is_conversation_participant");
    expect(N_HELPERS).toContain("create or replace function public.rls_current_price_actor");
    expect(N_HELPERS).toContain("security definer");
    expect(N_HELPERS).toContain("auth.uid()");
    // Helpers must not take a user id parameter a client could forge.
    expect(HELPERS).not.toMatch(/rls_owns_profile\s*\(\s*p_user/i);
    expect(N_HELPERS).toContain("revoke all on function public.rls_owns_profile(uuid) from public, anon");
    expect(N_HELPERS).toContain("grant execute on function public.rls_owns_profile(uuid) to authenticated, service_role");
  });
});

describe("plans — anon deny, owner/participant allow, other deny", () => {
  it("denies every anon operation", () => {
    const body = policyBody(PRIORITY, "plans_anon_deny");
    expect(body).toContain("to anon");
    expect(body).toContain("using (false)");
    expect(body).toContain("with check (false)");
  });

  it("allows authenticated select only via plan participant helper (owner or linked crew)", () => {
    const body = policyBody(PRIORITY, "plans_participant_select");
    expect(body).toContain("for select");
    expect(body).toContain("to authenticated");
    expect(body).toContain("rls_is_plan_participant(id)");
    // No open read.
    expect(body).not.toContain("using (true)");
  });

  it("does not grant authenticated write on plans (other and owner write via API/service role)", () => {
    expect(N_PRIORITY).not.toMatch(
      /grant\s+(insert|update|delete|all)\s+on\s+table\s+public\.plans\s+to\s+authenticated/,
    );
    expect(N_PRIORITY).not.toMatch(
      /create\s+policy\s+plans_\w+\s+on\s+public\.plans\s+for\s+(insert|update|delete)/,
    );
  });

  it("keeps plan_crew_members.token_hash off the authenticated column grant", () => {
    expect(PRIORITY).toMatch(
      /grant select\s*\(\s*id,\s*plan_id,\s*name,\s*status,\s*user_id,\s*joined_at,\s*updated_at\s*\)\s*on table public\.plan_crew_members to authenticated/i,
    );
    expect(N_PRIORITY).not.toMatch(
      /grant select\s*\([^)]*token_hash[^)]*\)\s*on table public\.plan_crew_members to authenticated/,
    );
    // Full-table select would include token_hash.
    expect(N_PRIORITY).not.toContain(
      "grant select on table public.plan_crew_members to authenticated",
    );
  });

  it("helper treats owner_user_id and crew user_id as participants (not arbitrary others)", () => {
    expect(N_HELPERS).toContain("pl.owner_user_id = (select auth.uid())");
    expect(N_HELPERS).toContain("m.user_id = (select auth.uid())");
  });
});

describe("messages — anon deny, participant allow, other deny", () => {
  it("denies anon on conversations and messages", () => {
    expect(policyBody(PRIORITY, "conversations_anon_deny")).toContain("using (false)");
    expect(policyBody(PRIORITY, "messages_anon_deny")).toContain("using (false)");
  });

  it("allows authenticated select only for conversation participants", () => {
    const conv = policyBody(PRIORITY, "conversations_participant_select");
    expect(conv).toContain("for select");
    expect(conv).toContain("to authenticated");
    expect(conv).toContain("user_id_a = (select auth.uid())");
    expect(conv).toContain("user_id_b = (select auth.uid())");
    expect(conv).toContain("rls_owns_handle(handle_a)");
    expect(conv).toContain("rls_owns_handle(handle_b)");
    expect(conv).not.toContain("using (true)");

    const msg = policyBody(PRIORITY, "messages_participant_select");
    expect(msg).toContain("rls_is_conversation_participant(conversation_id)");
  });

  it("does not open authenticated insert/update/delete on messages (writes stay API-mediated)", () => {
    expect(N_PRIORITY).not.toMatch(
      /create\s+policy\s+messages_\w+\s+on\s+public\.messages\s+for\s+(insert|update|delete)/,
    );
  });
});

describe("saved_pubs — anon deny, owner allow, other deny", () => {
  it("denies anon", () => {
    expect(policyBody(PRIORITY, "saved_pubs_anon_deny")).toContain("using (false)");
  });

  it("scopes every authenticated verb to rls_owns_profile(profile_id)", () => {
    for (const name of [
      "saved_pubs_owner_select",
      "saved_pubs_owner_insert",
      "saved_pubs_owner_update",
      "saved_pubs_owner_delete",
    ]) {
      const body = policyBody(PRIORITY, name);
      expect(body).toContain("to authenticated");
      expect(body).toContain("rls_owns_profile(profile_id)");
      expect(body).not.toContain("using (true)");
    }
  });

  it("owner helper is auth.uid()-bound so another signed-in user fails", () => {
    expect(N_HELPERS).toContain("p.user_id = (select auth.uid())");
    expect(N_HELPERS).toContain("p.id = p_profile_id");
  });
});

describe("community_prices — anon deny, owner/visible allow, other limited", () => {
  it("denies anon entirely", () => {
    expect(policyBody(PRIORITY, "community_prices_anon_deny")).toContain("using (false)");
    expect(N_PRIORITY).not.toMatch(
      /grant\s+select[\s\S]*on table public\.community_prices to anon/,
    );
  });

  it("allows authenticated select of non-hidden rows or own actor rows", () => {
    const body = policyBody(PRIORITY, "community_prices_visible_select");
    expect(body).toContain("for select");
    expect(body).toContain("to authenticated");
    expect(body).toContain("hidden_at is null");
    expect(body).toContain("actor = public.rls_current_price_actor()");
    // Other users cannot read hidden rows: only null hidden_at OR own actor.
    expect(body).not.toContain("using (true)");
  });

  it("does not grant the actor column to authenticated (token stays API-only)", () => {
    const grant = PRIORITY.match(
      /grant select\s*\(([^)]*)\)\s*on table public\.community_prices to authenticated/i,
    );
    expect(grant, "expected community_prices column grant").toBeTruthy();
    const cols = grant![1].toLowerCase();
    expect(cols).toContain("venue_id");
    expect(cols).toContain("price_pennies");
    expect(cols).not.toMatch(/\bactor\b/);
    expect(cols).not.toContain("moderator_note");
    expect(cols).not.toContain("report_reason");
  });

  it("owner actor is profile:<id> matching contributionIdentity.server.ts", () => {
    expect(N_HELPERS).toContain("'profile:' || public.rls_current_profile_id()::text");
  });

  it("does not allow authenticated insert/update/delete (submit/hide stay service-role)", () => {
    expect(N_PRIORITY).not.toMatch(
      /create\s+policy\s+community_prices_\w+\s+on\s+public\.community_prices\s+for\s+(insert|update|delete)/,
    );
  });
});

describe("visit_reports — anon deny, visible/owner allow, other cannot see hidden", () => {
  it("denies anon", () => {
    expect(policyBody(PRIORITY, "visit_reports_anon_deny")).toContain("using (false)");
  });

  it("allows authenticated select when visible OR own handle", () => {
    const body = policyBody(PRIORITY, "visit_reports_visible_or_owner_select");
    expect(body).toContain("for select");
    expect(body).toContain("to authenticated");
    expect(body).toContain("status = 'visible'");
    expect(body).toContain("rls_owns_handle(handle)");
    expect(body).not.toContain("using (true)");
  });

  it("does not allow authenticated write (composer is service-role API)", () => {
    expect(N_PRIORITY).not.toMatch(
      /create\s+policy\s+visit_reports_\w+\s+on\s+public\.visit_reports\s+for\s+(insert|update|delete)/,
    );
  });
});

describe("RPC hardening", () => {
  it("revokes anon/authenticated execute on refresh_community_price_quality", () => {
    expect(N_RPC).toContain(
      "revoke all on function public.refresh_community_price_quality() from public, anon, authenticated",
    );
    expect(N_RPC).toContain(
      "grant execute on function public.refresh_community_price_quality() to service_role",
    );
  });

  it("keeps public_contributor_leaderboard service_role-only (not anon-callable)", () => {
    // Documented intentional: product leaderboard is served via API, not raw RPC.
    expect(N_RPC).toContain(
      "revoke all on function public.public_contributor_leaderboard() from public, anon, authenticated",
    );
    expect(N_RPC).toContain(
      "grant execute on function public.public_contributor_leaderboard() to service_role",
    );
  });
});

describe("service-role-only tables and rounds closure", () => {
  it("drops the open rounds public-read policies", () => {
    expect(N_SERVICE).toContain("drop policy if exists rounds_public_read on public.rounds");
    expect(N_SERVICE).toContain(
      "drop policy if exists round_members_public_read on public.round_members",
    );
    expect(N_SERVICE).toContain(
      "drop policy if exists round_spends_public_read on public.round_spends",
    );
  });

  it("installs client_deny using(false) for private infrastructure tables", () => {
    // Policy names are built at runtime as t || '_client_deny' over this list.
    for (const table of [
      "rate_limits",
      "push_tokens",
      "social_oauth_states",
      "community_price_reports",
      "plan_invites",
      "referral_edges",
      "rounds",
    ]) {
      expect(N_SERVICE).toContain(`'${table}'`);
    }
    expect(N_SERVICE).toContain("t || '_client_deny'");
    expect(N_SERVICE).toContain("using (false)");
    expect(N_SERVICE).toContain("with check (false)");
  });

  it("restores public catalogue reads for drinks and pub_heritage only", () => {
    expect(N_SERVICE).toContain("create policy drinks_public_read");
    expect(N_SERVICE).toContain('create policy "pub_heritage public read"');
    expect(N_SERVICE).toContain(
      "grant select on table public.drinks to anon, authenticated",
    );
  });
});

describe("owner-keyed extras", () => {
  it("binds private_account_identities and notifications to the caller", () => {
    expect(N_OWNER).toContain(
      "user_id = (select auth.uid())",
    );
    expect(N_OWNER).toContain("rls_owns_handle(recipient_handle)");
  });

  it("binds pub_pals and night_memories to owner_id = auth.uid()", () => {
    expect(N_OWNER).toContain("owner_id = (select auth.uid())");
    expect(N_OWNER).toContain("create policy pub_pals_owner_all");
    expect(N_OWNER).toContain("create policy night_memories_owner_all");
  });
});

describe("coverage inventory (honest partial report)", () => {
  /**
   * The 68 advisor tables at branch base (RLS on, zero policies). Wave 2
   * either installs a real ownership policy or an explicit client_deny.
   */
  const ADVISOR_TABLES_AT_BASE = [
    "analytics_event_receipts",
    "area_demand",
    "check_ins",
    "community_price_reports",
    "community_prices",
    "conversations",
    "crawl_story_stops",
    "drink_ratings",
    "drinks",
    "email_subscribers",
    "external_social_accounts",
    "feed_freshness",
    "follows",
    "messages",
    "night_memories",
    "night_moment_consents",
    "night_moments",
    "night_stories",
    "night_story_contributors",
    "night_story_moments",
    "night_story_publish_proposals",
    "notifications",
    "operator_proposals",
    "pint_drop_comments",
    "pint_drop_reactions",
    "pint_drop_reports",
    "plan_actions",
    "plan_completions",
    "plan_constraints",
    "plan_crew_members",
    "plan_invites",
    "plan_route_proposals",
    "plan_stops",
    "plan_vibe_vote_requests",
    "plan_vibe_votes",
    "plan_vote_requests",
    "plan_votes",
    "plans",
    "price_confirms",
    "private_account_identities",
    "pro_feature_unlock_ledger",
    "profile_handle_aliases",
    "pub_heritage",
    "pub_pal_mastery_events",
    "pub_pal_memories",
    "pub_pal_voice_usage",
    "pub_pals",
    "pub_presence",
    "push_tokens",
    "rate_limits",
    "referral_edges",
    "referral_erasure_blocks",
    "referral_invite_codes",
    "referral_qualification_events",
    "round_price_line_charges",
    "round_spends",
    "round_stops",
    "saved_list_follows",
    "saved_lists",
    "saved_pubs",
    "social_oauth_states",
    "structured_visit_reports",
    "venue_operators",
    "venue_ratings",
    "visit_reports",
    "walk_route_legs",
    "weather_recommendations",
    "weather_snapshots",
  ] as const;

  const OWNERSHIP_OR_PARTICIPANT = new Set([
    "plans",
    "plan_stops",
    "plan_crew_members",
    "conversations",
    "messages",
    "saved_pubs",
    "community_prices",
    "visit_reports",
    "private_account_identities",
    "notifications",
    "saved_lists",
    "saved_list_follows",
    "follows",
    "check_ins",
    "pub_pals",
    "pub_pal_memories",
    "pub_pal_mastery_events",
    "pub_pal_voice_usage",
    "night_memories",
    "night_moments",
    "night_moment_consents",
    "night_stories",
    "night_story_contributors",
    "night_story_moments",
    "night_story_publish_proposals",
    "structured_visit_reports",
    "external_social_accounts",
    "profile_handle_aliases",
    "drinks",
    "pub_heritage",
  ]);

  it("lists 68 advisor tables and covers each in wave 2 SQL", () => {
    expect(ADVISOR_TABLES_AT_BASE).toHaveLength(68);

    for (const table of ADVISOR_TABLES_AT_BASE) {
      // Covered either by a named policy/grant on public.<table>, or by the
      // dynamic client_deny list entry '<table>' in 0068.
      const mentioned =
        N_ALL.includes(`public.${table}`) ||
        N_ALL.includes(`'${table}'`) ||
        N_ALL.includes(`${table}_anon_deny`) ||
        N_ALL.includes(`${table}_owner`) ||
        N_ALL.includes(`${table}_participant`) ||
        N_ALL.includes(`${table}_visible`) ||
        N_ALL.includes(`${table}_author`) ||
        N_ALL.includes(`${table}_recipient`) ||
        N_ALL.includes(`${table}_party`) ||
        N_ALL.includes(`${table}_host`) ||
        N_ALL.includes(table);
      expect(mentioned, `wave 2 must mention ${table}`).toBe(true);
    }
  });

  it("documents which tables got ownership policies vs explicit client_deny", () => {
    const ownership = ADVISOR_TABLES_AT_BASE.filter((t) =>
      OWNERSHIP_OR_PARTICIPANT.has(t),
    );
    const denyOnly = ADVISOR_TABLES_AT_BASE.filter(
      (t) => !OWNERSHIP_OR_PARTICIPANT.has(t),
    );
    // Pin the split so a future edit that silently moves a private table into
    // "public" without a product reason fails this suite.
    expect(ownership.length).toBeGreaterThanOrEqual(30);
    expect(denyOnly.length).toBeGreaterThanOrEqual(30);
    expect(ownership.length + denyOnly.length).toBe(68);
  });

  it("does not apply migrations (files only) and leaves auth settings untouched", () => {
    expect(N_ALL).not.toContain("alter system");
    expect(N_ALL).not.toContain("auth.config");
    expect(N_ALL).not.toContain("leaked_password");
    // No destructive data ops.
    expect(ALL).not.toMatch(/\btruncate\b|\bdrop table\b/i);
  });

  it("migration files are present under supabase/migrations", () => {
    const names = readdirSync(MIGRATIONS_DIR);
    for (const f of [
      "20260803200000_0065_rls_wave2_helpers.sql",
      "20260803201000_0066_rls_wave2_priority_policies.sql",
      "20260803202000_0067_rls_wave2_owner_policies.sql",
      "20260803203000_0068_rls_wave2_service_role_only.sql",
      "20260803204000_0069_rls_wave2_rpc_hardening.sql",
    ]) {
      expect(names).toContain(f);
    }
  });
});
