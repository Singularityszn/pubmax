import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { postgresSkipReason } from "./helpers/postgres";

type Session = {
  sqlFile(path: string): void;
  sql(statement: string): { ok: boolean; out: string; err: string };
  reloadPostgrestSchema(): Promise<void>;
  stop(): Promise<void>;
  restBaseUrl: string;
  serviceRoleKey: string;
};

type PublicDrop = { id: string; handle: string; venueId: string };
type PublicFeed = { drops: PublicDrop[]; passportAreas?: string[] };

const AUTHORS = ["durable_privacy_author", "apubmaxxer"] as const;
const LIVE_VENUE = "venue-eltcmh"; // City of London
const ANONYMOUS_VENUE = "venue-wrpmzq"; // Hackney
const RETIRED_VENUE = "venue-1pfnt71"; // Camden
const skipReason = postgresSkipReason();
const nativeFetch = globalThis.fetch;
let session: Session | null = null;
let GET: typeof import("@/app/api/pint-drops/route").GET;

function dropId(authorIndex: number, row: number): string {
  return `c1980000-0000-4000-8000-${String(authorIndex * 10 + row).padStart(12, "0")}`;
}

function sql(statement: string): void {
  if (!session) throw new Error("Pint privacy proof has no database session");
  const result = session.sql(statement);
  if (!result.ok) throw new Error(result.err);
}

async function readFeed(author?: string): Promise<PublicFeed> {
  const url = new URL("http://localhost/api/pint-drops?city=london");
  if (author) url.searchParams.set("author", author);
  // No viewer, bearer or moderator credentials: this is the public route.
  const response = await GET(new Request(url));
  expect(response.status).toBe(200);
  return response.json() as Promise<PublicFeed>;
}

beforeAll(async () => {
  if (skipReason) return;
  // @ts-expect-error The existing executable session harness has no declarations.
  const harness = await import("../scripts/rls/session-harness.mjs") as {
    startRlsSession(): Promise<Session>;
  };
  session = await harness.startRlsSession();
  try {
    const migrations = join(process.cwd(), "supabase/migrations");
    for (const name of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql") && name > "20260806035204_0070_v1_release_security.sql")
      .sort()) {
      session.sqlFile(join(migrations, name));
    }
    await session.reloadPostgrestSchema();
    vi.stubEnv("SUPABASE_URL", session.restBaseUrl);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", session.serviceRoleKey);
    vi.stubEnv("SUPABASE_STORAGE_BUCKET", "pint-drops");
    vi.stubEnv("VERCEL_ENV", "preview");
    const restBaseUrl = session.restBaseUrl;
    const origin = new URL(restBaseUrl).origin;
    // The real Supabase client talks to real PostgREST. Only its Supabase URL
    // prefix is adapted. The transport cannot contact another HTTP origin.
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const requested = input instanceof Request ? input.url : String(input);
      if (new URL(requested).origin !== origin) throw new Error("Pint privacy proof forbids external HTTP");
      const local = requested.replace(`${restBaseUrl}/rest/v1`, restBaseUrl);
      return nativeFetch(input instanceof Request ? new Request(local, input) : local, init);
    });
    vi.resetModules();
    const { pintDropsStore, supabasePintDropStore } = await import("@/lib/pintDropsStore");
    expect(pintDropsStore()).toBe(supabasePintDropStore);
    ({ GET } = await import("@/app/api/pint-drops/route"));
    const { getVenueIndex } = await import("@/lib/venueIndex");
    const venues = await getVenueIndex();
    expect(venues.get(LIVE_VENUE)?.borough).toBe("City of London");
    expect(venues.get(ANONYMOUS_VENUE)?.borough).toBe("Hackney");
    expect(venues.get(RETIRED_VENUE)?.borough).toBe("Camden");

    for (const [index, author] of AUTHORS.entries()) {
      const userId = `c1980000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`;
      const profileId = `c1980000-0000-4000-8002-${String(index + 1).padStart(12, "0")}`;
      sql(`insert into auth.users(id) values ('${userId}');
        insert into public.profiles(id,user_id,handle,display_name)
        values ('${profileId}','${userId}','${author}','Live public author');
        insert into public.pint_drops
          (id,handle,venue_id,drink,price_gbp,passed_down_note,era,provenance,status,visibility,created_at,author_retired_at)
        values
          ('${dropId(index, 1)}','${author}','${LIVE_VENUE}','',null,'Public observation','','anecdote','visible','public','2026-01-01T12:00:00Z',null),
          ('${dropId(index, 2)}','${author}','${ANONYMOUS_VENUE}','',null,'Anonymous observation','','anecdote','visible','anonymous','2026-01-02T12:00:00Z',null),
          ('${dropId(index, 3)}','${author}','${RETIRED_VENUE}','',null,'Retained observation','','anecdote','visible','public','2026-01-03T12:00:00Z','2026-01-04T12:00:00Z');`);
    }
    sql(`insert into public.pint_drops
      (id,handle,venue_id,drink,price_gbp,passed_down_note,era,provenance,status,visibility,created_at)
      values ('${dropId(2, 1)}','unrelated_public_author','${LIVE_VENUE}','',null,'Unrelated observation','','anecdote','visible','public','2026-01-05T12:00:00Z');`);
  } catch (error) {
    await session.stop();
    session = null;
    throw error;
  }
}, 600_000);

afterAll(async () => {
  try { await session?.stop(); } finally {
    session = null;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

describe.skipIf(skipReason !== null)("durable public Pint Drop author privacy", () => {
  it.each(AUTHORS)("returns only live attributed rows and geography for %s", async (author) => {
    const index = AUTHORS.indexOf(author);
    const feed = await readFeed(author);
    expect(feed.drops.map((drop) => drop.id)).toEqual([dropId(index, 1)]);
    expect(feed.drops[0]).toMatchObject({ handle: author, venueId: LIVE_VENUE });
    expect(feed.passportAreas).toEqual(["City of London"]);
  });

  it("keeps anonymous and retired observations visible without attributing them", async () => {
    const feed = await readFeed();
    for (const index of [0, 1]) {
      expect(feed.drops.find((drop) => drop.id === dropId(index, 1)))
        .toMatchObject({ handle: AUTHORS[index], venueId: LIVE_VENUE });
      expect(feed.drops.find((drop) => drop.id === dropId(index, 2)))
        .toMatchObject({ handle: "a PUBMAXXER", venueId: ANONYMOUS_VENUE });
      expect(feed.drops.find((drop) => drop.id === dropId(index, 3)))
        .toMatchObject({ handle: "a PUBMAXXER", venueId: RETIRED_VENUE });
    }
    expect(feed.drops.find((drop) => drop.id === dropId(2, 1)))
      .toMatchObject({ handle: "unrelated_public_author" });
    expect(feed).not.toHaveProperty("passportAreas");
  });
});
