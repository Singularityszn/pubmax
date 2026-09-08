import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', async (original) => ({
  ...await original<typeof import('@/lib/supabase')>(),
  isSupabaseConfigured: () => false,
  requiresSupabaseStore: () => false,
  getSupabaseAdmin: () => null,
  requireSupabaseAdmin: () => { throw new Error('Live database access prohibited in this fixture'); },
}));
vi.mock('@/lib/serverEnv', () => ({ assertServerEnv: () => {} }));
vi.mock('@/lib/authServer', async (original) => ({
  ...await original<typeof import('@/lib/authServer')>(),
  callerUserId: async (request: Request) => request.headers.get('x-fixture-user'),
}));
vi.mock('@/lib/venueIndex', () => ({
  lookupCanonicalVenue: async (id: string) => ({ status: 'found', canonicalId: id, venue: { id, name: 'Fixture pub', kind: 'pub' } }),
  getVenueIndex: async () => new Map(),
  venueMapUrl: (id: string) => `/map?sel=${id}`,
}));
import * as confirmation from '@/lib/pintDropConfirm.server';
import * as creationModule from '@/lib/pintDropCreate.server';
import { pintDropCreateRequest } from '@/lib/pintDropCreate.server';
import { __resetStepOutNudgeStore, __listMemoryStepOutNudgePrefs } from '@/lib/stepOutNudgeStore';
import { POST } from '@/app/api/pint-drops/route';
import { __resetPintDrops, addPintDrop, validatePintDrop } from '@/lib/pintDrops';
import { __resetMemoryProfiles, profileStore } from '@/lib/profileStore';
import { memoryPintDropStore, pintDropsStore } from '@/lib/pintDropsStore';
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const venue = 'venue-lost-response-fixture';
const key = 'fixture-retry-request-12345';
function request(priced: boolean, actor = alice, fields: Record<string, string | File> = {}, submissionKey: string | null = key): Request {
  const body = new FormData();
  body.set('venueId', venue);
  body.set('handle', 'fixturealice');
  body.set('drink', 'Lager');
  body.set('measure', 'pint');
  body.set('priceGbp', priced ? '5.80' : '');
  body.set('passedDownNote', priced ? '' : 'The old piano stood beside the door.');
  body.set('visibility', 'public');
  if (priced) body.set('receipt_photo', new File([new Uint8Array([255,216,255,42])], 'bill.jpg', { type: 'image/jpeg' }));
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return new Request('http://fixture.invalid/api/pint-drops', {
    method: 'POST', body,
    headers: { ...(actor ? { 'x-fixture-user': actor } : {}), ...(submissionKey !== null ? { 'Idempotency-Key': submissionKey } : {}) },
  });
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network access prohibited in this fixture'); }));
  __resetPintDrops();
  __resetMemoryProfiles();
  __resetStepOutNudgeStore();
  await profileStore().createOwned('fixturealice', alice);
  await profileStore().createOwned('fixturebob', bob);
  expect(pintDropsStore()).toBe(memoryPintDropStore);
});
it('replays a committed priced drop after losing its success body', async () => {
  const first = await POST(request(true));
  expect(first.status).toBe(201);
  await first.body?.cancel(); // The caller never receives the success body.
  const retry = await POST(request(true));
  const reply = await retry.json();
  const rows = await memoryPintDropStore.listVisible(venue);
  expect(retry.status).toBe(201);
  expect(rows).toHaveLength(1);
  expect(reply.drop.id).toBe(rows[0].id);
});
it('replays an unpriced note instead of creating another row', async () => {
  const first = await POST(request(false));
  expect(first.status).toBe(201);
  await first.body?.cancel();
  const retry = await POST(request(false));
  expect(retry.status).toBe(201);
  const rows = await memoryPintDropStore.listVisible(venue);
  expect(rows).toHaveLength(1);
  expect((await retry.json()).drop.id).toBe(rows[0].id);
});
it('replays concurrent priced submissions under the same key', async () => {
  const responses = await Promise.all([POST(request(true)), POST(request(true))]);
  const statuses = responses.map(response => response.status).sort();
  expect(statuses).toEqual([201,201]);
  expect(await memoryPintDropStore.listVisible(venue)).toHaveLength(1);
});
it('the verified actor overrides the body handle; another actor has a separate daily cap', async () => {
  expect((await POST(request(true))).status).toBe(201);
  const secondActor = await POST(request(true, bob));
  const reply = await secondActor.json();
  expect(secondActor.status).toBe(201);
  expect(reply.drop.handle).toBe('fixturebob');
  expect(await memoryPintDropStore.listVisible(venue)).toHaveLength(2);
});

it.each<Record<string, string | File>>([
  { priceGbp: '6.20' },
  { passedDownNote: 'A changed note.' },
  { visibility: 'friends' },
  { receipt_photo: new File([new Uint8Array([255,216,255,43])], 'bill.jpg', { type: 'image/jpeg' }) },
])('refuses changed content under the same key: %j', async (fields) => {
  const first = await (await POST(request(true))).json();
  const changed = await POST(request(true, alice, fields));
  expect(changed.status).toBe(409);
  const rows = await memoryPintDropStore.listVisible(venue);
  expect(rows.map(row => row.id)).toEqual([first.drop.id]);
  expect(rows[0].priceGbp).toBe(5.8);
});
it('includes the cleaned other-measure label in request identity', async () => {
  expect((await POST(request(true, alice, { measure: 'other', measureLabel: '330ml' }))).status).toBe(201);
  expect((await POST(request(true, alice, { measure: 'other', measureLabel: '  330ml  ' }))).status).toBe(201);
  expect((await POST(request(true, alice, { measure: 'other', measureLabel: '500ml' }))).status).toBe(409);
});
it('keeps an intentional second price under the daily cap', async () => {
  expect((await POST(request(true))).status).toBe(201);
  expect((await POST(request(true, alice, {}, 'another-submission-key'))).status).toBe(409);
});
it.each(['public', 'legacy'] as const)('counts an existing uncapped %s price', async (visibility) => {
  const validated = validatePintDrop({ venueId: venue, handle: 'fixturealice', priceGbp: '5.80', visibility });
  if (!validated.ok) throw new Error(validated.error);
  // The pairing lane does not request a day stamp.
  await memoryPintDropStore.create(validated.value, { pint: null, venue: null, receipt: null });
  expect((await POST(request(true))).status).toBe(409);
});
it('replays on the next London day without creating a new contribution', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-08T21:30:00Z'));
  const first = await (await POST(request(true))).json();
  vi.setSystemTime(new Date('2026-09-09T00:30:00Z'));
  const retry = await (await POST(request(true))).json();
  expect(retry.drop.id).toBe(first.drop.id);
  expect((await memoryPintDropStore.listVisible(venue))).toHaveLength(1);
});
it('keeps moderation on replay and does not publish hidden photos', async () => {
  const first = await (await POST(request(true))).json();
  await memoryPintDropStore.moderate(first.drop.id, 'hidden', 'Private moderation note');
  const replay = await POST(request(true));
  const body = await replay.json();
  expect(replay.status).toBe(201);
  expect(body.drop).toMatchObject({ id: first.drop.id, status: 'hidden', receiptPhotoUrl: null });
  expect(JSON.stringify(body)).not.toContain('Private moderation note');
  expect(await memoryPintDropStore.listVisible(venue)).toHaveLength(0);
});
it('refuses a key with no verified actor and rejects malformed keys', async () => {
  expect((await POST(request(false, ''))).status).toBe(401);
  expect((await POST(request(false, alice, {}, 'short'))).status).toBe(400);
  expect(await memoryPintDropStore.listVisible(venue)).toHaveLength(0);
});
it('keeps unkeyed note submissions distinct', async () => {
  expect((await POST(request(false, alice, {}, null))).status).toBe(201);
  expect((await POST(request(false, alice, {}, null))).status).toBe(201);
  expect(await memoryPintDropStore.listVisible(venue)).toHaveLength(2);
});
it('replays without spending the new-submission rate budget', async () => {
  const first = await (await POST(request(false))).json();
  for (let i = 0; i < 10; i++) {
    const response = await POST(request(false));
    expect(response.status).toBe(201);
    expect((await response.json()).drop.id).toBe(first.drop.id);
  }
  for (let i = 0; i < 7; i++) {
    expect((await POST(request(false, alice, {}, `new-submission-${i}-key`))).status).toBe(201);
  }
  expect((await POST(request(false, alice, {}, 'ninth-submission-key'))).status).toBe(429);
});

it('finishes a commit interrupted before confirmation and qualification, using original attribution', async () => {
  const form = await request(true, alice, { visibility: 'anonymous' }).formData();
  const parsed = validatePintDrop(Object.fromEntries(form));
  if (!parsed.ok) throw new Error(parsed.error);
  const original = { ...parsed.value, authorityKey: 'original-authority-key' };
  const photos = { pint: null, venue: null, receipt: form.get('receipt_photo') as File };
  const creation = await pintDropCreateRequest(alice, key, original, photos);
  addPintDrop({ ...original, id: randomUUID(), handle: 'fixturebob', visibility: 'public', authorityKey: 'second-account-authority' });
  // Commit directly, before the handler has any chance to finish its side effects.
  await memoryPintDropStore.create(original, photos, { underDailyPriceCap: true, request: creation });
  expect((await memoryPintDropStore.listConfirmationCandidates(venue)).every(row => !row.confirmation)).toBe(true);
  expect(__listMemoryStepOutNudgePrefs()).toHaveLength(0);
  const pass = vi.spyOn(confirmation, 'runSecondReporterPass');
  const ensure = vi.spyOn(profileStore(), 'ensure');
  const replay = await POST(request(true, alice, { visibility: 'anonymous' }));
  const result = await replay.json();
  expect(replay.status).toBe(201);
  expect(result.drop.id).toBe(original.id);
  expect(result.drop.authorityKey).toBeUndefined();
  expect(result.drop.handle).not.toBe(original.handle);
  expect(pass).toHaveBeenCalledWith(venue, expect.any(Number), original.authorityKey);
  expect(ensure).toHaveBeenCalledWith(original.handle);
  expect(result.drop.confirmation.basis).toBe('second_reporter');
  const owner = await profileStore().getByUserId(alice);
  await vi.waitFor(() => expect(__listMemoryStepOutNudgePrefs()).toEqual([
    expect.objectContaining({ ownerActor: `profile:${owner?.id}`, cheapPintQualified: true }),
  ]));
  const again = await (await POST(request(true, alice, { visibility: 'anonymous' }))).json();
  expect(again.drop.confirmation.confirmationId).toBe(result.drop.confirmation.confirmationId);
  expect(await memoryPintDropStore.listVisible(venue)).toHaveLength(2);
});
it('replays the original attribution when the same account now has another handle', async () => {
  const first = await (await POST(request(false))).json();
  __resetMemoryProfiles();
  await profileStore().createOwned('renamedalice', alice);
  const ensure = vi.spyOn(profileStore(), 'ensure');
  const replay = await POST(request(false, alice, { handle: 'renamedalice' }));
  const result = await replay.json();
  expect(replay.status).toBe(201);
  expect(result.drop).toMatchObject({ id: first.drop.id, handle: 'fixturealice' });
  expect(ensure).toHaveBeenCalledWith('fixturealice');
  expect(await memoryPintDropStore.listVisible(venue)).toHaveLength(1);
});

it('bounds an authenticated replay burst before hashing, projection, or settlement', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
  const digest = vi.spyOn(creationModule, 'pintDropCreateRequest');
  const read = vi.spyOn(memoryPintDropStore, 'findCreation');
  const settle = vi.spyOn(confirmation, 'runSecondReporterPass');
  const first = await (await POST(request(true))).json();
  for (let i = 1; i < 60; i++) {
    const replay = await POST(request(true));
    expect(replay.status).toBe(201);
    expect((await replay.json()).drop.id).toBe(first.drop.id);
  }
  const calls = { digest: digest.mock.calls.length, read: read.mock.calls.length, settle: settle.mock.calls.length };
  const refused = await POST(request(true));
  expect(refused.status).toBe(429);
  expect((await refused.json()).retryable).toBe(true);
  expect(digest).toHaveBeenCalledTimes(calls.digest);
  expect(read).toHaveBeenCalledTimes(calls.read);
  expect(settle).toHaveBeenCalledTimes(calls.settle);
  // Neither a changed asserted handle nor a rotated request key grants another account budget.
  expect((await POST(request(true, alice, { handle: 'differenthandle' }, 'rotated-submission-key'))).status).toBe(429);
  expect(digest).toHaveBeenCalledTimes(calls.digest);
  expect((await POST(request(true, bob))).status).toBe(201);
  vi.setSystemTime(new Date('2026-09-08T12:01:01Z'));
  const recovered = await POST(request(true));
  expect(recovered.status).toBe(201);
  expect((await recovered.json()).drop.id).toBe(first.drop.id);
});
