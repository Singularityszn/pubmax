import { test, expect, type Page, type Route } from '@playwright/test';
import { ACCOUNTS, AUTH_STORAGE_KEY, DEVICE_ACCOUNTS_KEY, accessJwt, installAuthDoubles, seedSignedIn, switchRememberedAccount } from './helpers/authDoubles';
import { createPlanIntakeDraft, skipRemainingPlanIntake } from '../lib/planIntake';
import { DEFAULT_PAL_DRAFT } from '../lib/pubPal';

// Oracle: #2539 and the recorded account-departure decisions. A departing
// person's unpublished Plan must not survive, while their Pal survives a
// transient provider sign-out. Auth doubles replace only the external provider.
// Generation and creation below call the running app's real API. Delays hold
// real API responses to exercise cancellation at each asynchronous boundary.
test.describe.configure({ timeout: 120_000 });
test.use({ actionTimeout: 15_000, serviceWorkers: 'block' });
const EVIDENCE = process.env.PUBMAX_TEST_EVIDENCE_DIR;
const QUERY = '#plan-describe-first-query';
const STOPS = ['venue-1ufn31x', 'venue-1t8siin', 'venue-xiesdn'];
const REQUEST = 'Three pubs in Soho';

test.afterEach(async ({ page }, info) => {
  if (EVIDENCE && info.status !== info.expectedStatus && !page.isClosed()) {
    await page.screenshot({ path: `${EVIDENCE}/failed-${info.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 100)}.png`, fullPage: true });
  }
});

async function seed(page: Page, account: 'A' | null = 'A', recovery = false) {
  await installAuthDoubles(page);
  if (account) await seedSignedIn(page, account);
  const draft = skipRemainingPlanIntake(createPlanIntakeDraft({ kind: 'patch', id: 'soho' }));
  draft.answers.accessibilityNeeds = ['step-free'];
  draft.settledSteps = [...new Set([...draft.settledSteps, 'accessibility' as const])];
  draft.skippedSteps = draft.skippedSteps.filter(step => step !== 'accessibility');
  await page.addInitScript(({ accounts, accountsKey, pal, recovery, draft, stops }) => {
    if (sessionStorage.getItem('plan-boundary-seeded')) return;
    sessionStorage.setItem('plan-boundary-seeded', 'yes');
    for (const [key, value] of Object.entries({
      'pubmax-theme': 'light', 'pubmax-tour-v1-done': '1',
      'pubmax:map-first-visit-arrival:v1': 'dismissed', 'pubmax_onboarding_dismissed': '1',
    })) localStorage.setItem(key, value);
    localStorage.setItem(accountsKey, JSON.stringify(Object.values(accounts).map(a => ({
      userId: a.id, refreshToken: a.refreshToken, email: a.email, handle: a.handle, lastActiveAt: Date.now(),
    }))));
    if (!recovery) return;
    localStorage.setItem('pubmax_account_owner', accounts.A.id);
    localStorage.setItem('pubmax_pub_pal_v1', JSON.stringify(pal));
    localStorage.setItem('pubmax:plan-host-name:v1', 'A private remembered host');
    localStorage.setItem('pubmaxx.night-profile.v1:device', JSON.stringify({ source: 'account', profile: 'A retained profile' }));
    localStorage.setItem('pubmax:pal-quest-stamps:v1', JSON.stringify({ stamps: ['A saved stamp'] }));
    localStorage.setItem('pubmax:optimistic-spill-posts:v1', JSON.stringify([{ id: 'A pending Pint Drop' }]));
    localStorage.setItem('pubmax:plan-intake:v1', JSON.stringify({ storageVersion: 1,
      savedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), draft,
    }));
    localStorage.setItem('pubmaxx:plan-route-draft:v1', JSON.stringify({
      stops: stops.map(venueId => ({ venueId, venueName: venueId })),
    }));
    sessionStorage.setItem('pubmaxx:plan-draft:v1', JSON.stringify({
      title: 'A recovered title', creatorName: 'A private remembered host',
      startTime: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
      conciergeQuery: 'A recovered request',
      stops: stops.map((venueId, key) => ({ key, venueId, venueName: venueId })),
      requestIntake: draft,
    }));
  }, { accounts: ACCOUNTS, accountsKey: DEVICE_ACCOUNTS_KEY, draft, stops: STOPS, recovery,
    pal: { ...DEFAULT_PAL_DRAFT, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ownerId: ACCOUNTS.A.id, name: 'Retained Ripley' },
  });
}

async function shot(page: Page, name: string) {
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: true });
}
async function signedIn(page: Page, account: 'A' | 'B') {
  await expect(page.getByRole('button', { name: `Account options for ${ACCOUNTS[account].name}`, exact: true })).toBeVisible();
}
async function providerEvent(page: Page, account: 'A' | 'B' | null, event?: string) {
  const user = account ? ACCOUNTS[account] : null;
  await page.evaluate(({ key, user, jwt, event }) => {
    const session = user ? { access_token: jwt, refresh_token: user.refreshToken, expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer',
      user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated',
        app_metadata: {}, user_metadata: { full_name: user.name } },
    } : null;
    if (session) localStorage.setItem(key, JSON.stringify(session));
    else localStorage.removeItem(key);
    const channel = new BroadcastChannel(key);
    channel.postMessage({ event: event ?? (session ? 'SIGNED_IN' : 'SIGNED_OUT'), session });
    setTimeout(() => channel.close(), 100);
  }, { key: AUTH_STORAGE_KEY, user, jwt: user ? accessJwt(user) : null, event });
  if (account) await signedIn(page, account);
  else await expect(page.getByRole('button', { name: /Account options/ })).toHaveCount(0);
}
const savedQuery = (page: Page) => page.evaluate(() => {
  const raw = sessionStorage.getItem('pubmax:plan-draft:v2');
  return raw ? JSON.parse(raw).draft.conciergeQuery : null;
});

for (const departure of ['provider sign-out', 'account switch']) {
test(`${departure} clears the mounted recovered Plan and host before B starts clean`, async ({ page }) => {
  await seed(page, 'A', true);
  await page.goto('/plan');
  await signedIn(page, 'A');
  await expect(page.locator('.planStop')).toHaveCount(3);
  await expect(page.locator('#plan-name')).toHaveValue('A private remembered host');
  await page.locator('#plan-title').fill('A private title');
  await page.getByRole('button', { name: 'Tune details', exact: true }).click();
  await page.locator('#plan-concierge-query').fill('A private recovered request');
  await page.getByRole('dialog', { name: 'Tune details', exact: true }).getByRole('button', { name: /Close/ }).click();
  await expect.poll(() => savedQuery(page)).toBe('A private recovered request');
  const form = await page.locator('form.planComposer').elementHandle();
  const retained = await page.evaluate(() => Object.fromEntries([
    'pubmax_pub_pal_v1', 'pubmaxx.night-profile.v1:device', 'pubmax:pal-quest-stamps:v1', 'pubmax:optimistic-spill-posts:v1',
  ].map(key => [key, localStorage.getItem(key)])));
  await shot(page, `${departure}-recovered-plan-a`);
  if (departure === 'provider sign-out') await providerEvent(page, null);
  else await switchRememberedAccount(page, 'A', 'B');
  expect(await form!.evaluate(el => el.isConnected)).toBe(false);
  await expect(page.locator(QUERY)).toHaveValue('');
  await expect(page.locator('.planStop')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('pubmax:plan-host-name:v1'))).toBeNull();
  if (departure === 'provider sign-out') expect(await page.evaluate(() => Object.fromEntries([
    'pubmax_pub_pal_v1', 'pubmaxx.night-profile.v1:device', 'pubmax:pal-quest-stamps:v1', 'pubmax:optimistic-spill-posts:v1',
  ].map(key => [key, localStorage.getItem(key)])))).toEqual(retained);
  await shot(page, `${departure}-plan-cleared`);
  if (departure === 'provider sign-out') await providerEvent(page, 'B');
  await expect(page.locator(QUERY)).toHaveValue('');
  await page.locator(QUERY).fill('B own request');
  await expect.poll(() => savedQuery(page)).toBe('B own request');
  const storage = await page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }));
  expect(storage).not.toContain('A private title');
  expect(storage).not.toContain('A private recovered request');
  expect(storage).not.toContain('A private remembered host');
  expect(storage).not.toContain('step-free');
  await shot(page, `${departure}-plan-b`);
  await generate(page);
  await expect(page.locator('#plan-name')).toHaveValue(ACCOUNTS.B.handle);
  await page.getByRole('button', { name: 'Lock it in', exact: true }).click();
  await expect(page).toHaveURL(/\/plan\/[a-f0-9-]+#share/, { timeout: 30_000 });
  expect(await page.evaluate(() => localStorage.getItem('pubmax:plan-host-name:v1'))).toBe(ACCOUNTS.B.handle);
  await shot(page, `${departure}-b-published-own-name`);
});
}

for (const parameter of ['query', 'describe', 'occasion']) {
  test(`${parameter} URL handoff is consumed when the mounted account changes`, async ({ page }) => {
    await seed(page);
    let requests = 0;
    page.on('request', request => { if (request.url().endsWith('/api/plans/generate')) requests++; });
    await page.goto(`/plan?${parameter}=${encodeURIComponent(parameter === 'occasion' ? 'quiet' : REQUEST)}&from=pal#request`);
    await signedIn(page, 'A');
    if (parameter === 'query') {
      await expect.poll(() => requests).toBeGreaterThan(0);
      // Restoring the provider session can cancel the request started before
      // identity resolved. R7 requires cancellation and an available retry.
      await expect.poll(async () => (await page.locator('.planStop').count() === 3)
        || await page.getByRole('button', { name: 'Make a plan', exact: true }).isEnabled().catch(() => false)).toBe(true);
      if (await page.locator('.planStop').count() === 0) {
        await page.getByRole('button', { name: 'Make a plan', exact: true }).click();
      }
      await expect(page.locator('.planStop')).toHaveCount(3, { timeout: 30_000 });
    }
    const count = requests;
    await switchRememberedAccount(page, 'A', 'B');
    await expect(page.locator(QUERY)).toHaveValue('');
    await expect(page.locator('.planStop')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has(parameter)).toBe(false);
    expect(new URL(page.url()).searchParams.get('from')).toBe('pal');
    await page.locator(QUERY).fill('B own new request');
    await expect.poll(() => savedQuery(page)).toBe('B own new request');
    expect(requests).toBe(count);
    await shot(page, `url-${parameter}-b`);
  });
}

test('refreshing the same account preserves the mounted request and its saved draft', async ({ page }) => {
  await seed(page);
  await page.goto('/plan');
  await signedIn(page, 'A');
  await page.locator(QUERY).fill('A same-account request');
  await expect.poll(() => savedQuery(page)).toBe('A same-account request');
  const form = await page.locator('form.planComposer').elementHandle();
  await providerEvent(page, 'A', 'TOKEN_REFRESHED');
  expect(await form!.evaluate(el => el.isConnected)).toBe(true);
  await expect(page.locator(QUERY)).toHaveValue('A same-account request');
  expect(await savedQuery(page)).toBe('A same-account request');
  await shot(page, 'same-account-refresh-preserves-request');
});

async function generate(page: Page) {
  await page.locator(QUERY).fill(REQUEST);
  await page.getByRole('button', { name: 'Plan it', exact: true }).click();
  await expect(page.locator('.planStop')).toHaveCount(3, { timeout: 60_000 });
}

// Delay a genuine response, without replacing the generator or Plan store.
function holdResponse(page: Page, pattern: string, method: string) {
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  let responseState = 'waiting';
  const ready = async () => expect.poll(() => responseState, { timeout: 30_000 }).toBe('ready');
  let completed!: () => void;
  const done = new Promise<void>(resolve => { completed = resolve; });
  let intercepted = false;
  const install = page.route(pattern, async (route: Route) => {
    if (intercepted || route.request().method() !== method) return route.fallback();
    intercepted = true;
    try {
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBe(true);
      responseState = 'ready';
      await released;
      // The product aborts the browser request at the auth boundary.
      await route.fulfill({ response }).catch(() => undefined);
    } finally { completed(); }
  });
  return { install, ready, release, done };
}

test('explicit sign-out clears the open Plan before the cookie deletion finishes', async ({ page }) => {
  await seed(page);
  await page.goto('/plan');
  await signedIn(page, 'A');
  await page.locator(QUERY).fill('A private sign-out request');
  await expect.poll(() => savedQuery(page)).toBe('A private sign-out request');
  await page.evaluate(() => localStorage.setItem('pubmax:plan-host-name:v1', 'A remembered sign-out host'));
  const hold = holdResponse(page, '**/api/auth/session', 'DELETE');
  await hold.install;
  await page.getByRole('button', { name: /Account options/ }).first().click();
  await page.locator('.authAccountMenu').getByRole('button', { name: `Sign out of @${ACCOUNTS.A.handle}`, exact: true }).click();
  try {
    await hold.ready();
    await expect(page.locator(QUERY)).toHaveValue('');
    expect(await savedQuery(page)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('pubmax:plan-host-name:v1'))).toBeNull();
    await shot(page, 'explicit-signout-cookie-pending');
    hold.release();
    await hold.done;
    await signedIn(page, 'B');
    await expect(page.locator(QUERY)).toHaveValue('');
    await shot(page, 'explicit-signout-switched-b');
  } finally { hold.release(); }
});

test('sign-in during request-key hashing cancels the stale key and permits Lock retry', async ({ page }) => {
  await seed(page, null);
  await page.goto('/plan');
  // A supported manual route has no server-generated operation key. This
  // persisted input exercises the native hashing path used by manual Plans.
  await page.evaluate(stops => {
    sessionStorage.removeItem('pubmaxx:plan-draft:v1');
    sessionStorage.removeItem('pubmax:plan-draft:v2');
    localStorage.removeItem('pubmax:plan-intake:v1');
    localStorage.setItem('pubmaxx:plan-route-draft:v1', JSON.stringify({
      savedAt: new Date().toISOString(), routeStale: false,
      stops: stops.map((venueId, key) => ({ key, venueId, venueName: venueId })),
    }));
  }, STOPS);
  await page.reload();
  await expect(page.locator('.planStop')).toHaveCount(3);
  await page.locator('#plan-name').fill('Signed-out hashing host');
  const form = await page.locator('form.planComposer').elementHandle();
  await page.evaluate(() => {
    const original = crypto.subtle.digest.bind(crypto.subtle);
    const state = { started: false, release: () => {} };
    (window as unknown as { boundaryHash: typeof state }).boundaryHash = state;
    let first = true;
    crypto.subtle.digest = async (algorithm, data) => {
      if (first) {
        first = false;
        state.started = true;
        await new Promise<void>(resolve => { state.release = resolve; });
      }
      return original(algorithm, data);
    };
  });
  let creations = 0;
  page.on('request', request => {
    if (request.url().endsWith('/api/plans') && request.method() === 'POST') creations++;
  });
  await page.getByRole('button', { name: 'Lock it in', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { boundaryHash: { started: boolean } }).boundaryHash.started)).toBe(true);
  await providerEvent(page, 'B');
  await page.evaluate(() => (window as unknown as { boundaryHash: { release: () => void } }).boundaryHash.release());
  expect(await form!.evaluate(el => el.isConnected)).toBe(true);
  await expect(page.getByRole('button', { name: 'Lock it in', exact: true })).toBeEnabled();
  expect(creations).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('pubmaxx:plan-mutation:v1:create'))).toBeNull();
  await shot(page, 'signin-hashing-retry-ready');
  await page.getByRole('button', { name: 'Lock it in', exact: true }).click();
  await expect(page).toHaveURL(/\/plan\/[a-f0-9-]+#share/, { timeout: 30_000 });
  expect(creations).toBe(1);
  await shot(page, 'signin-hashing-retry-saved');
});

for (const stage of ['generation', 'creation', 'metadata'] as const) {
  test(`B draft survives A pending ${stage} completion`, async ({ page }) => {
    await seed(page);
    await page.goto('/plan');
    await signedIn(page, 'A');
    const hold = holdResponse(page, stage === 'generation' ? '**/api/plans/generate' : stage === 'creation' ? '**/api/plans' : '**/api/plans/*', stage === 'metadata' ? 'PATCH' : 'POST');
    await hold.install;
    if (stage === 'generation') {
      await page.locator(QUERY).fill(REQUEST);
      await page.getByRole('button', { name: 'Plan it', exact: true }).click();
    } else {
      await generate(page);
      await page.locator('#plan-name').fill('A delayed host');
      await page.getByRole('button', { name: 'Lock it in', exact: true }).click();
    }
    try {
      await hold.ready();
      await switchRememberedAccount(page, 'A', 'B');
      await page.locator(QUERY).fill('B pending-safe request');
      await expect.poll(() => savedQuery(page)).toBe('B pending-safe request');
      hold.release();
      await hold.done;
      await expect(page).toHaveURL(/\/plan$/);
      await expect(page.locator(QUERY)).toHaveValue('B pending-safe request');
      await expect(page.locator('.planStop')).toHaveCount(0);
      expect(await savedQuery(page)).toBe('B pending-safe request');
      expect(await page.evaluate(() => localStorage.getItem('pubmax:plan-host-name:v1'))).toBeNull();
      await shot(page, `cancel-${stage}-b`);
    } finally { hold.release(); }
  });
}

for (const stage of ['generation', 'creation', 'metadata'] as const) {
  test(`sign-in cancels signed-out ${stage}, retains the form, and permits retry`, async ({ page }) => {
    await seed(page, null);
    await page.goto('/plan');
    await expect(page.locator(QUERY)).toBeEnabled();
    const form = await page.locator('form.planComposer').elementHandle();
    const hold = holdResponse(page, stage === 'generation' ? '**/api/plans/generate' : stage === 'creation' ? '**/api/plans' : '**/api/plans/*', stage === 'metadata' ? 'PATCH' : 'POST');
    await hold.install;
    if (stage === 'generation') {
      await page.locator(QUERY).fill(REQUEST);
      await page.getByRole('button', { name: 'Plan it', exact: true }).click();
    } else {
      await generate(page);
      await page.locator('#plan-name').fill('Signed-out host');
      await page.getByRole('button', { name: 'Lock it in', exact: true }).click();
    }
    try {
      await hold.ready();
      await providerEvent(page, 'B');
      hold.release();
      await hold.done;
      expect(await form!.evaluate(el => el.isConnected)).toBe(true);
      await expect(page).toHaveURL(/\/plan$/);
      if (stage === 'generation') {
        const retry = page.getByRole('button', { name: 'Make a plan', exact: true });
        await expect(retry).toBeEnabled();
        await expect(page.locator('#plan-concierge-query')).toHaveValue(REQUEST);
        await retry.click();
        await expect(page.locator('.planStop')).toHaveCount(3, { timeout: 30_000 });
        await page.locator('#plan-name').fill('B retry host');
      } else {
        await expect(page.getByRole('button', { name: 'Lock it in', exact: true })).toBeEnabled();
        await expect(page.locator('#plan-name')).toHaveValue('Signed-out host');
      }
      await shot(page, `signin-${stage}-retry-ready`);
      await page.getByRole('button', { name: 'Lock it in', exact: true }).click();
      await expect(page).toHaveURL(/\/plan\/[a-f0-9-]+#share/, { timeout: 30_000 });
      expect(await page.evaluate(() => localStorage.getItem('pubmax:plan-host-name:v1'))).toBe(stage === 'generation' ? 'B retry host' : 'Signed-out host');
      await shot(page, `signin-${stage}-retry-saved`);
    } finally { hold.release(); }
  });
}
