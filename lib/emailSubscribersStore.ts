// Email-subscriber store — the durable-or-memory backing for the LIGHTWEIGHT
// email capture on the identity nudge sheet (Cycle-2 locked owner decision:
// "push identity harder — early email capture"). A signed-out user who declines
// full OAuth can instead leave just an email to receive the weekly pint digest.
//
// ONE store interface, TWO implementations (process-memory + Supabase
// public.email_subscribers) — the exact dual-backend seam as
// lib/priceConfirmStore.ts: Supabase when env keys exist, process-memory
// otherwise, chosen at the single emailSubscribersStore() seam. Before migration
// 0042 lands (or on a schema miss) the Supabase path fails soft to the in-memory
// store, so capture keeps working and becomes durable the moment the table
// exists.
//
// ── DOUBLE-OPT-IN STANCE (GDPR-sane, one stated purpose) ─────────────────────
// Every capture stores `confirmed = false`: a PENDING subscriber, NOT a mailing
// list member. Sending the confirmation email is provider-gated (noop today —
// see the route). A subscriber becomes mailable only after confirm(token).
//
// ── DIGEST RECIPIENT SEAM (#327 — feat/email-digest, do NOT edit that branch) ─
// The weekly digest resolves recipients through
// resolveDigestRecipients(members: DigestAudienceMember[]) where a member is
// mailed only when `optIn === true && optOut !== true` (lib/weeklyDigest.ts on
// feat/email-digest). This store exposes listConfirmedSubscribers() → the set of
// CONFIRMED emails. When the two branches meet, the digest's audience loader maps
// each confirmed subscriber to a DigestAudienceMember as:
//     { id: <token-or-id>, email, optIn: true, optOut: false }
// and an UNCONFIRMED subscriber is simply never yielded (optIn stays false), so
// double-opt-in is enforced end-to-end WITHOUT changing isDigestOptedIn(). This
// module owns the confirmed/unconfirmed truth; the digest owns the send. The
// seam is listConfirmedSubscribers(); see docs/EMAIL_CAPTURE.md.

import {
  coerceSource,
  mintUnsubscribeToken,
  parseEmail,
  type EmailSubscriberSource,
} from "@/lib/emailSubscribers";
import { createFailSoftGuard, selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

export type SubscribeInput = {
  /** Raw email from the capture field; normalised + validated by the store. */
  email: string;
  /** Capture surface; coerced to the allowlist ('identity-nudge' today). */
  source?: string;
};

export type SubscribeOutcome = {
  /** `created` = a new pending row; `existing` = the address was already known. */
  status: "created" | "existing";
  /** Whether the (now-canonical) row is already confirmed. */
  confirmed: boolean;
  /** The row's opaque confirm/unsubscribe token — API-only, never surfaced to
   *  the browser (used server-side to build the provider-gated confirm link). */
  unsubscribeToken: string;
  /** Set when a durable write hard-failed — the address was NOT recorded. */
  failed?: true;
};

export type ConfirmedSubscriber = {
  email: string;
  token: string;
};

export type EmailSubscribersStore = {
  /**
   * Record a pending (unconfirmed) subscription and return the canonical row's
   * state. Idempotent by email: a re-submission does NOT create a second row,
   * does NOT re-confirm, and does NOT rotate the token — it returns the existing
   * row as `existing`. NEVER throws; a durable write that hard-fails resolves
   * with `failed: true` so the route can answer 503 (no fake success).
   */
  subscribe(input: SubscribeInput, now?: number): Promise<SubscribeOutcome>;
  /**
   * Mark the row owning `token` confirmed (double-opt-in completion). Returns
   * true when a row moved unconfirmed → confirmed, false when the token is
   * unknown or the row was already confirmed. NEVER throws.
   */
  confirm(token: string, now?: number): Promise<boolean>;
  /**
   * Remove the row owning `token` (unsubscribe / right-to-erasure). Returns true
   * when a row was removed. NEVER throws.
   */
  unsubscribe(token: string): Promise<boolean>;
  /**
   * The digest recipient seam (#327): every CONFIRMED subscriber. Unconfirmed
   * rows are never yielded, so double-opt-in holds end-to-end. NEVER throws.
   */
  listConfirmedSubscribers(): Promise<ConfirmedSubscriber[]>;
};

// Bound process memory in a long-lived server — evict the oldest row past this
// many distinct addresses (the durable table has no such cap).
const MAX_ROWS = 50_000;
// Cap how many confirmed rows a durable scan pulls for the digest seam.
const CONFIRMED_SCAN_ROWS = 50_000;

// ── In-memory implementation ─────────────────────────────────────────────────
type SubscriberRecord = {
  email: string;
  source: EmailSubscriberSource;
  confirmed: boolean;
  unsubscribeToken: string;
  createdAt: number;
  updatedAt: number;
  confirmedAt: number | null;
};

// One row per normalised email. Module-level so it persists across requests
// within a process; never a browser global.
const rows = new Map<string, SubscriberRecord>();
// Secondary index: token → email, so confirm/unsubscribe are O(1) by token.
const tokenIndex = new Map<string, string>();

function evictIfNeeded(): void {
  if (rows.size <= MAX_ROWS) return;
  let oldestEmail: string | null = null;
  let oldestAt = Infinity;
  for (const [email, rec] of rows) {
    if (rec.createdAt < oldestAt) {
      oldestAt = rec.createdAt;
      oldestEmail = email;
    }
  }
  if (oldestEmail) {
    const rec = rows.get(oldestEmail);
    if (rec) tokenIndex.delete(rec.unsubscribeToken);
    rows.delete(oldestEmail);
  }
}

export const memoryEmailSubscribersStore: EmailSubscribersStore = {
  async subscribe(input, now = Date.now()) {
    const email = parseEmail(input.email);
    if (!email) return { status: "existing", confirmed: false, unsubscribeToken: "", failed: true };
    const existing = rows.get(email);
    if (existing) {
      return {
        status: "existing",
        confirmed: existing.confirmed,
        unsubscribeToken: existing.unsubscribeToken,
      };
    }
    const rec: SubscriberRecord = {
      email,
      source: coerceSource(input.source),
      confirmed: false,
      unsubscribeToken: mintUnsubscribeToken(),
      createdAt: now,
      updatedAt: now,
      confirmedAt: null,
    };
    rows.set(email, rec);
    tokenIndex.set(rec.unsubscribeToken, email);
    evictIfNeeded();
    return { status: "created", confirmed: false, unsubscribeToken: rec.unsubscribeToken };
  },

  async confirm(token, now = Date.now()) {
    const email = tokenIndex.get(token);
    if (!email) return false;
    const rec = rows.get(email);
    if (!rec || rec.confirmed) return false;
    rec.confirmed = true;
    rec.confirmedAt = now;
    rec.updatedAt = now;
    return true;
  },

  async unsubscribe(token) {
    const email = tokenIndex.get(token);
    if (!email) return false;
    tokenIndex.delete(token);
    return rows.delete(email);
  },

  async listConfirmedSubscribers() {
    const out: ConfirmedSubscriber[] = [];
    for (const rec of rows.values()) {
      if (rec.confirmed) out.push({ email: rec.email, token: rec.unsubscribeToken });
    }
    return out;
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "email-subscribers",
  tables: "email_subscribers",
  migrationHint: "apply migration 0042",
});

type SubscriberRow = {
  email?: unknown;
  confirmed?: unknown;
  unsubscribe_token?: unknown;
};

function readRow(row: unknown): { email: string; confirmed: boolean; token: string } | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as SubscriberRow;
  if (typeof r.email !== "string" || typeof r.unsubscribe_token !== "string") return null;
  return { email: r.email, confirmed: r.confirmed === true, token: r.unsubscribe_token };
}

export const supabaseEmailSubscribersStore: EmailSubscribersStore = {
  async subscribe(input, now = Date.now()) {
    const email = parseEmail(input.email);
    if (!email) return { status: "existing", confirmed: false, unsubscribeToken: "", failed: true };
    const token = mintUnsubscribeToken();
    const iso = new Date(now).toISOString();
    return guard<SubscribeOutcome>({
      context: "subscribe",
      onSchemaMiss: () => memoryEmailSubscribersStore.subscribe(input, now),
      message: "subscribe failed — flagging degraded write",
      onError: () => ({ status: "existing", confirmed: false, unsubscribeToken: "", failed: true }),
      run: async () => {
        // INSERT ... ON CONFLICT (email) DO NOTHING — never clobbers an existing
        // row's confirmed state or token. `inserted` is empty on conflict.
        const { data: inserted, error: insertError } = await requireSupabaseAdmin()
          .from("email_subscribers")
          .upsert(
            {
              email,
              source: coerceSource(input.source),
              confirmed: false,
              unsubscribe_token: token,
              created_at: iso,
              updated_at: iso,
            },
            { onConflict: "email", ignoreDuplicates: true },
          )
          .select("email, confirmed, unsubscribe_token");
        if (insertError) throw new Error(insertError.message);

        const insertedRow = Array.isArray(inserted) ? readRow(inserted[0]) : null;
        if (insertedRow) {
          return {
            status: "created",
            confirmed: insertedRow.confirmed,
            unsubscribeToken: insertedRow.token,
          };
        }

        // Conflict: read the authoritative existing row.
        const { data: existing, error: selectError } = await requireSupabaseAdmin()
          .from("email_subscribers")
          .select("email, confirmed, unsubscribe_token")
          .eq("email", email)
          .maybeSingle();
        if (selectError) throw new Error(selectError.message);
        const existingRow = readRow(existing);
        if (!existingRow) {
          // Row vanished between insert-conflict and select (rare) — treat as a
          // degraded write rather than a fake success.
          return { status: "existing", confirmed: false, unsubscribeToken: "", failed: true };
        }
        return {
          status: "existing",
          confirmed: existingRow.confirmed,
          unsubscribeToken: existingRow.token,
        };
      },
    });
  },

  async confirm(token, now = Date.now()) {
    if (!token) return false;
    return guard<boolean>({
      context: "confirm",
      onSchemaMiss: () => memoryEmailSubscribersStore.confirm(token, now),
      message: "confirm failed",
      onError: () => false,
      run: async () => {
        const { data, error } = await requireSupabaseAdmin()
          .from("email_subscribers")
          .update({ confirmed: true, confirmed_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() })
          .eq("unsubscribe_token", token)
          .eq("confirmed", false)
          .select("email");
        if (error) throw new Error(error.message);
        return Array.isArray(data) && data.length > 0;
      },
    });
  },

  async unsubscribe(token) {
    if (!token) return false;
    return guard<boolean>({
      context: "unsubscribe",
      onSchemaMiss: () => memoryEmailSubscribersStore.unsubscribe(token),
      message: "unsubscribe failed",
      onError: () => false,
      run: async () => {
        const { data, error } = await requireSupabaseAdmin()
          .from("email_subscribers")
          .delete()
          .eq("unsubscribe_token", token)
          .select("email");
        if (error) throw new Error(error.message);
        return Array.isArray(data) && data.length > 0;
      },
    });
  },

  async listConfirmedSubscribers() {
    return guard<ConfirmedSubscriber[]>({
      context: "listConfirmed",
      onSchemaMiss: () => memoryEmailSubscribersStore.listConfirmedSubscribers(),
      message: "listConfirmed failed — returning empty",
      onError: () => [],
      run: async () => {
        const { data, error } = await requireSupabaseAdmin()
          .from("email_subscribers")
          .select("email, unsubscribe_token")
          .eq("confirmed", true)
          .limit(CONFIRMED_SCAN_ROWS);
        if (error) throw new Error(error.message);
        if (!Array.isArray(data)) return [];
        const out: ConfirmedSubscriber[] = [];
        for (const row of data) {
          const parsed = readRow(row);
          if (parsed) out.push({ email: parsed.email, token: parsed.token });
        }
        return out;
      },
    });
  },
};

/** The single backend selection point (mirrors the other stores). */
export function emailSubscribersStore(): EmailSubscribersStore {
  return selectStore(memoryEmailSubscribersStore, supabaseEmailSubscribersStore);
}

/** Test-only: clear the in-memory rows + token index and warn dedupe. */
export function __resetEmailSubscribers(): void {
  rows.clear();
  tokenIndex.clear();
  resetSchemaMissWarnings();
}
