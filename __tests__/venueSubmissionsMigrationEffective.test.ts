// Migration 0189, proved against a real PostgreSQL replay of every migration:
// the CHECKs that hold a submission and its menu files to their bounds, the
// owner-folder key on every file, the refusal of every browser role at the
// grant, the erasure when an account is deleted through the real deletion path,
// and a rollback that applies cleanly and lets the forward file apply again.

import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startMigratedPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const FORWARD = join(MIGRATIONS, "20261017190000_0189_venue_submissions.sql");
const ROLLBACK = join(MIGRATIONS, "rollback/20261017190000_0189_venue_submissions_rollback.sql");

const ALICE_USER = "a1111111-1111-4111-8111-111111111111";
const ALICE_PROFILE = "a2222222-2222-4222-8222-222222222222";
const BOB_USER = "b1111111-1111-4111-8111-111111111111";
const BOB_PROFILE = "b2222222-2222-4222-8222-222222222222";
const ALICE_SUBMISSION = "a3333333-3333-4333-8333-333333333333";
const BOB_SUBMISSION = "b3333333-3333-4333-8333-333333333333";
const SHA = "a".repeat(64);

let session: PostgresSession | null = null;

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({
    label: "venue-submissions-0189",
    database: "pubmax_venue_submissions_0189",
  });
  session.sql(`
    insert into auth.users (id) values ('${ALICE_USER}'), ('${BOB_USER}');
    insert into public.profiles (id, user_id, handle) values
      ('${ALICE_PROFILE}', '${ALICE_USER}', 'alicepm'),
      ('${BOB_PROFILE}', '${BOB_USER}', 'bobpm');
  `);
}, 300_000);

afterAll(async () => {
  await session?.stop();
});

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL venue submission session did not start.");
  return session;
}

type SubmissionFields = {
  id?: string;
  name?: string;
  address?: string;
  lat?: string;
  lng?: string;
  website?: string;
  menuUrl?: string;
  prices?: string;
  status?: string;
  duplicateOf?: string;
};

function submission(owner: string, fields: SubmissionFields = {}): string {
  return `
    insert into public.venue_submissions
      (id, owner_user_id, name, address, latitude, longitude, website, menu_url, prices, status, duplicate_of_venue_id)
    values (
      ${fields.id ? `'${fields.id}'` : "gen_random_uuid()"}, '${owner}',
      '${fields.name ?? "The Missing Crown"}', '${fields.address ?? "1 Example Street, London"}',
      ${fields.lat ?? "51.5"}, ${fields.lng ?? "-0.1"},
      '${fields.website ?? ""}', '${fields.menuUrl ?? ""}',
      '${fields.prices ?? "[]"}'::jsonb, '${fields.status ?? "pending"}',
      ${fields.duplicateOf ? `'${fields.duplicateOf}'` : "null"})`;
}

function file(owner: string, submissionId: string, key: string, kind = "image", contentType = "image/jpeg"): string {
  return `
    insert into public.venue_submission_files
      (submission_id, owner_user_id, object_key, kind, content_type, byte_size, sha256)
    values ('${submissionId}', '${owner}', '${key}', '${kind}', '${contentType}', 1024, '${SHA}')`;
}

function folder(owner: string, submissionId: string): string {
  return `venue-submissions/${owner}/${submissionId}`;
}

describe.skipIf(skipReason !== null)("0189 venue submissions", () => {
  it("takes a submission with prices and a menu photo and a PDF from the service role", async () => {
    const alice = await db().attempt(asServiceRole(submission(ALICE_USER, {
      id: ALICE_SUBMISSION,
      website: "https://missingcrown.example",
      prices: '[{"drinkCategory":"beer","priceGbp":5.2,"measure":"pint"}]',
    })));
    expect(alice.ok, alice.said).toBe(true);
    const bob = await db().attempt(asServiceRole(submission(BOB_USER, { id: BOB_SUBMISSION, lat: "null", lng: "null" })));
    expect(bob.ok, bob.said).toBe(true);
    const photo = await db().attempt(asServiceRole(file(ALICE_USER, ALICE_SUBMISSION, `${folder(ALICE_USER, ALICE_SUBMISSION)}/p1.jpg`)));
    expect(photo.ok, photo.said).toBe(true);
    const pdf = await db().attempt(asServiceRole(
      file(ALICE_USER, ALICE_SUBMISSION, `${folder(ALICE_USER, ALICE_SUBMISSION)}/m1.pdf`, "pdf", "application/pdf"),
    ));
    expect(pdf.ok, pdf.said).toBe(true);
    const bobFile = await db().attempt(asServiceRole(file(BOB_USER, BOB_SUBMISSION, `${folder(BOB_USER, BOB_SUBMISSION)}/b1.jpg`)));
    expect(bobFile.ok, bobFile.said).toBe(true);
  });

  it("holds a submission to its bounds", async () => {
    const refusals: [SubmissionFields, RegExp][] = [
      [{ name: "" }, /venue_submissions_name_len_check/],
      [{ name: "x".repeat(121) }, /venue_submissions_name_len_check/],
      [{ address: "" }, /venue_submissions_address_len_check/],
      [{ lat: "40.0" }, /venue_submissions_position_check/],
      [{ lat: "51.5", lng: "null" }, /venue_submissions_position_check/],
      [{ website: "http://insecure.example" }, /venue_submissions_website_check/],
      [{ menuUrl: "javascript:alert(1)" }, /venue_submissions_menu_url_check/],
      [{ prices: '{"beer":5}' }, /venue_submissions_prices_check/],
      [{ prices: JSON.stringify(Array.from({ length: 21 }, () => ({}))) }, /venue_submissions_prices_check/],
      [{ status: "published" }, /venue_submissions_status_check/],
      [{ status: "duplicate" }, /venue_submissions_duplicate_check/],
      [{ status: "pending", duplicateOf: "venue-abc" }, /venue_submissions_duplicate_check/],
    ];
    for (const [fields, said] of refusals) {
      const answer = await db().attempt(asServiceRole(submission(ALICE_USER, fields)));
      expect(answer.ok, JSON.stringify(fields)).toBe(false);
      expect(answer.said).toMatch(said);
    }
    const duplicate = await db().attempt(asServiceRole(submission(ALICE_USER, { status: "duplicate", duplicateOf: "venue-abc" })));
    expect(duplicate.ok, duplicate.said).toBe(true);
  });

  it("keeps every file inside its owner's own folder and its declared kind", async () => {
    const own = folder(ALICE_USER, ALICE_SUBMISSION);
    const refusals: [string, RegExp][] = [
      [file(ALICE_USER, ALICE_SUBMISSION, `${folder(BOB_USER, ALICE_SUBMISSION)}/x.jpg`), /venue_submission_files_key_check/],
      [file(ALICE_USER, ALICE_SUBMISSION, `${folder(ALICE_USER, BOB_SUBMISSION)}/x.jpg`), /venue_submission_files_key_check/],
      [file(ALICE_USER, ALICE_SUBMISSION, `${own}/../x.jpg`), /venue_submission_files_key_check/],
      [file(ALICE_USER, ALICE_SUBMISSION, `venue-photos/${own}/x.jpg`), /venue_submission_files_key_check/],
      [file(ALICE_USER, ALICE_SUBMISSION, `${own}/x.pdf`), /venue_submission_files_kind_check/],
      [file(ALICE_USER, ALICE_SUBMISSION, `${own}/x.jpg`, "pdf", "application/pdf"), /venue_submission_files_kind_check/],
      [file(ALICE_USER, ALICE_SUBMISSION, `${own}/x.png`, "image", "image/png"), /venue_submission_files_kind_check/],
      [file(ALICE_USER, ALICE_SUBMISSION, `${own}/p1.jpg`), /venue_submission_files_object_key_key|duplicate key/],
    ];
    for (const [statement, said] of refusals) {
      const answer = await db().attempt(asServiceRole(statement));
      expect(answer.ok, statement).toBe(false);
      expect(answer.said).toMatch(said);
    }
    const oversize = await db().attempt(asServiceRole(
      `update public.venue_submission_files set byte_size = 4194305 where object_key like '${own}/%'`,
    ));
    expect(oversize.ok).toBe(false);
    expect(oversize.said).toMatch(/venue_submission_files_size_check/);
  });

  it("gives every browser role nothing: no read and no write", async () => {
    for (const [role, sub] of [["authenticated", ALICE_USER], ["authenticated", BOB_USER], ["anon", null]] as const) {
      for (const table of ["venue_submissions", "venue_submission_files"]) {
        const read = await db().attempt(asBrowserRole(role, sub, `select count(*) from public.${table}`));
        expect(read.ok, `${role} reads ${table}`).toBe(false);
        expect(read.said).toMatch(/42501|permission denied/);
        const remove = await db().attempt(asBrowserRole(role, sub, `delete from public.${table}`));
        expect(remove.ok, `${role} deletes ${table}`).toBe(false);
        expect(remove.said).toMatch(/42501|permission denied/);
      }
      const write = await db().attempt(asBrowserRole(role, sub, submission(ALICE_USER)));
      expect(write.ok).toBe(false);
      expect(write.said).toMatch(/42501|permission denied/);
    }
  });

  it("leaves with the account: deleting the auth user erases its submissions and files and nobody else's", async () => {
    expect(db().sql(`select count(*) from public.venue_submissions where owner_user_id = '${BOB_USER}'`)).toBe("1");
    expect(db().sql(`select count(*) from public.venue_submission_files where owner_user_id = '${BOB_USER}'`)).toBe("1");
    const aliceBefore = db().sql(`select count(*) from public.venue_submissions where owner_user_id = '${ALICE_USER}'`);
    const aliceFilesBefore = db().sql(`select count(*) from public.venue_submission_files where owner_user_id = '${ALICE_USER}'`);

    const deleted = await db().attempt(`delete from auth.users where id = '${BOB_USER}'`);
    expect(deleted.ok, deleted.said).toBe(true);

    expect(db().sql(`select tombstoned_at is not null from public.profiles where id = '${BOB_PROFILE}'`)).toBe("t");
    expect(db().sql(`select count(*) from public.venue_submissions where owner_user_id = '${BOB_USER}'`)).toBe("0");
    expect(db().sql(`select count(*) from public.venue_submission_files where owner_user_id = '${BOB_USER}'`)).toBe("0");
    expect(db().sql(`select count(*) from public.venue_submissions where owner_user_id = '${ALICE_USER}'`)).toBe(aliceBefore);
    expect(db().sql(`select count(*) from public.venue_submission_files where owner_user_id = '${ALICE_USER}'`)).toBe(aliceFilesBefore);
  });

  it("deleting a submission takes its file rows with it", async () => {
    const own = folder(ALICE_USER, ALICE_SUBMISSION);
    expect(Number(db().sql(`select count(*) from public.venue_submission_files where object_key like '${own}/%'`))).toBe(2);
    db().sql(`delete from public.venue_submissions where id = '${ALICE_SUBMISSION}'`);
    expect(db().sql(`select count(*) from public.venue_submission_files where object_key like '${own}/%'`)).toBe("0");
  });

  it("ROLLBACK drops both tables, and the forward file applies again", () => {
    db().applyFile(ROLLBACK);
    expect(db().sql("select to_regclass('public.venue_submissions') is null")).toBe("t");
    expect(db().sql("select to_regclass('public.venue_submission_files') is null")).toBe("t");
    db().applyFile(ROLLBACK);
    db().applyFile(FORWARD);
    expect(db().sql("select count(*) from public.venue_submissions")).toBe("0");
    db().applyFile(FORWARD);
  });
});
