import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, AUTH_STORAGE_KEY, DEVICE_ACCOUNTS_KEY, accessJwt, installAuthDoubles, seedSignedIn, switchRememberedAccount } from './helpers/authDoubles';
import { installDeterministicMapBasemap } from './helpers/mapNetworkFixtures';
import type { SpeechRecognitionLike } from '../lib/pintDropSpeech';

type HarnessWindow = typeof window & {
  g13Speech: { stopCount: number; deliver: (text: string) => void };
  g13AuthChannel: BroadcastChannel;
  SpeechRecognition: new () => SpeechRecognitionLike;
};

// G13 is the oracle: a new account must not inherit drafts or skipped missions.
// Only external auth, speech and mission data use doubles. The mounted app owns
// account transitions, rendering, draft persistence and dismissal filtering.
const VENUE = 'venue-16pnwmm';
const DRAFT = `pubmax_pint_drop_draft:${VENUE}`;
const MISSION = 'pubmaxx:price-mission-dismiss:v1';
const PLAN = 'pubmax:ask-plan-draft:v1';
const EVIDENCE = process.env.PUBMAX_TEST_EVIDENCE_DIR;

test.use({ serviceWorkers: 'block' });

async function shot(page: Page, name: string) {
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: true });
}

async function accountSurface(page: Page, account: 'A' | 'B' | null) {
  if ((page.viewportSize()?.width ?? 0) >= 768) {
    if (account) await expect(page.getByRole('button', {
      name: `Account options for ${ACCOUNTS[account].name}`, exact: true,
    })).toBeVisible();
    else await expect(page.getByRole('button', { name: /Account options/ })).toHaveCount(0);
    return;
  }
  await expect(page.getByRole('link', { name: 'You', exact: true }).filter({ visible: true }).first())
    .toHaveAttribute('href', account ? `/u/${ACCOUNTS[account].handle}` : '/u/you');
}

async function setup(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, 'A');
  await installDeterministicMapBasemap(page);
  await page.addInitScript(({ accounts, accountsKey, width }) => {
    if (sessionStorage.getItem('g13-seeded')) return;
    sessionStorage.setItem('g13-seeded', 'yes');
    localStorage.setItem('pubmax_account_owner', accounts.A.id);
    localStorage.setItem('pubmax-theme', width === 768 ? 'dark' : 'light');
    localStorage.setItem('pubmax-tour-v1-done', '1');
    localStorage.setItem('pubmax_onboarding_dismissed', '1');
    sessionStorage.setItem('pubmax_onboarding_dismissed', '1');
    localStorage.setItem('pubmax:map-first-visit-arrival:v1', 'dismissed');
    localStorage.setItem('pubmax:e2e-defer-shell:v1', 'now');
    localStorage.setItem(accountsKey, JSON.stringify(Object.values(accounts).map(a => ({
      userId: a.id, refreshToken: a.refreshToken, email: a.email, handle: a.handle, lastActiveAt: Date.now(),
    }))));
  }, { accounts: ACCOUNTS, accountsKey: DEVICE_ACCOUNTS_KEY, width });
  await page.addInitScript(() => {
    const state: HarnessWindow['g13Speech'] = { stopCount: 0, deliver: () => {} };
    (window as HarnessWindow).g13Speech = state;
    (window as HarnessWindow).SpeechRecognition = class implements SpeechRecognitionLike {
      lang = ''; interimResults = false; continuous = false;
      onresult: SpeechRecognitionLike['onresult'] = null;
      onerror: SpeechRecognitionLike['onerror'] = null;
      onend: SpeechRecognitionLike['onend'] = null;
      start() {
        const callback = this.onresult;
        state.deliver = text => callback?.({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal: true }] });
      }
      stop() { state.stopCount++; }
    };
  });
  await page.route('**/api/price-missions**', route => route.fulfill({ json: {
    status: 'ready', mission: { venueId: new URL(route.request().url()).searchParams.get('venueId') ?? VENUE,
      reason: 'stale', drinkCategory: 'beer' },
  } }));
  await page.route('**/api/price-submit**', route => {
    if (route.request().method() !== 'GET') return route.abort();
    return route.fulfill({ json: { prices: [], signals: [] } });
  });
  return auth;
}

test('an unverified pub sheet offers B the mission that A dismissed without remounting the sheet', async ({ page }) => {
  await setup(page, 1440);
  await page.goto('/map?sel=venue-uk-n352930271&at=51.5003,-0.0842');
  await accountSurface(page, 'A');
  const sheet = page.locator('.unverifiedPub').filter({ visible: true });
  await expect(sheet.locator('.unverifiedPubName')).toHaveText('The Leather Exchange');
  const mounted = await sheet.elementHandle();
  const slot = sheet.locator('.pemSlot');
  await expect(slot).toBeVisible();
  await slot.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(slot).toHaveCount(0);
  await shot(page, 'base-pub-a-dismissed');
  await switchRememberedAccount(page, 'A', 'B');
  if (await page.locator('.authAccountMenu').isVisible()) await page.keyboard.press('Escape');
  expect(await mounted!.evaluate(element => element.isConnected)).toBe(true);
  expect(await page.evaluate(key => sessionStorage.getItem(key), MISSION)).toBeNull();
  await expect(slot).toBeVisible();
  await expect(slot).toContainText('The Leather Exchange');
  await shot(page, 'base-pub-b-mission-returned');
});

async function provider(page: Page, account: 'A' | 'B' | null, event?: string) {
  const user = account ? ACCOUNTS[account] : null;
  await page.evaluate(({ key, user, jwt, event }) => {
    const session = user ? { access_token: jwt, refresh_token: user.refreshToken,
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer',
      user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated',
        app_metadata: {}, user_metadata: { full_name: user.name } },
    } : null;
    if (session) localStorage.setItem(key, JSON.stringify(session));
    else localStorage.removeItem(key);
    const channel = new BroadcastChannel(key);
    channel.postMessage({ event: event ?? (session ? 'SIGNED_IN' : 'SIGNED_OUT'), session });
    (window as HarnessWindow).g13AuthChannel = channel;
  }, { key: AUTH_STORAGE_KEY, user, jwt: user ? accessJwt(user) : null, event });
  await accountSurface(page, account);
}

async function seedOtherPrivateArtifacts(page: Page) {
  await page.evaluate(({ draft, plan }) => {
    sessionStorage.setItem(`${draft}-other`, JSON.stringify({ version: 2, form: { note: 'A other venue secret' } }));
    sessionStorage.setItem(plan, JSON.stringify({ query: 'A private Plan request', stopIds: ['venue-16pnwmm'],
      stopNames: ['Prospect of Whitby'], createdAt: new Date().toISOString(), origin: 'pal' }));
    sessionStorage.setItem('g13-unrelated', 'keep');
    sessionStorage.setItem('pubmax_pint_drop_draftish:keep', 'keep');
  }, { draft: DRAFT, plan: PLAN });
}

async function openComposer(page: Page, account: 'A' | 'B' = 'A', writeStory = true) {
  await page.goto(`/map?sel=${VENUE}`);
  await accountSurface(page, account);
  const inspector = page.locator('.venueInspector').filter({ visible: true });
  const expand = page.getByRole('button', { name: 'Expand sheet', exact: true });
  if (!(await inspector.isVisible()) && await expand.isVisible()) await expand.click();
  await expect(inspector).toBeVisible();
  await inspector.getByRole('tab', { name: 'Prices', exact: true }).click();
  await inspector.getByRole('button', { name: /log a pint drop/i }).click();
  const form = inspector.locator('form.dropComposer');
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: 'Add a photo or story' }).click();
  if (writeStory) {
    await form.getByRole('textbox', { name: 'Story', exact: true }).fill('A private typed story');
    await expect.poll(() => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!).form.note, DRAFT)).toBe('A private typed story');
  }
  return form;
}

async function assertPrivateArtifactsGone(page: Page) {
  await expect.poll(() => page.evaluate(({ draft, plan, mission }) => ({
    draft: sessionStorage.getItem(draft), other: sessionStorage.getItem(`${draft}-other`),
    plan: sessionStorage.getItem(plan), mission: sessionStorage.getItem(mission),
  }), { draft: DRAFT, plan: PLAN, mission: MISSION })).toEqual({ draft: null, other: null, plan: null, mission: null });
  expect(await page.evaluate(() => [sessionStorage.getItem('g13-unrelated'), sessionStorage.getItem('pubmax_pint_drop_draftish:keep')])).toEqual(['keep', 'keep']);
}

for (const [departure, width] of [['provider sign-out', 390], ['provider sign-out', 768], ['switch', 1440], ['explicit sign-out', 1440]] as const) {
  test(`${departure}: open typed story and late dictation cannot revive A drafts at ${width}px`, async ({ page }) => {
    await setup(page, width);
    const form = await openComposer(page);
    await seedOtherPrivateArtifacts(page);
    await page.evaluate(key => sessionStorage.setItem(key, '["old-mission"]'), MISSION);
    await form.getByRole('button', { name: 'Add note by voice' }).click();
    await page.evaluate(() => (window as HarnessWindow).g13Speech.deliver('A dictated secret'));
    await expect(form.getByRole('textbox', { name: 'Story', exact: true })).toHaveValue('A private typed story A dictated secret');
    await shot(page, `${width}-${departure}-a-story`);
    if (departure === 'switch') await switchRememberedAccount(page, 'A', 'B');
    else if (departure === 'provider sign-out') await provider(page, null);
    else {
      await page.getByRole('button', { name: /Account options/ }).first().click();
      await page.locator('.authAccountMenu').getByRole('button', { name: `Sign out of @${ACCOUNTS.A.handle}`, exact: true }).click();
      await expect(page.getByRole('button', { name: `Account options for ${ACCOUNTS.A.name}`, exact: true })).toHaveCount(0);
    }
    await page.evaluate(() => (window as HarnessWindow).g13Speech.deliver('LATE A SECRET'));
    await expect.poll(() => page.evaluate(() => (window as HarnessWindow).g13Speech.stopCount)).toBe(1);
    await assertPrivateArtifactsGone(page);
    if (departure === 'provider sign-out') await provider(page, 'B');
    await accountSurface(page, 'B');
    const menu = page.locator('.authAccountMenu');
    if (await menu.isVisible()) await page.keyboard.press('Escape');
    const newForm = page.locator('form.dropComposer').filter({ visible: true });
    await expect(newForm).toBeVisible();
    const extras = newForm.getByRole('button', { name: 'Add a photo or story' });
    if (await extras.isVisible()) await extras.click();
    const story = newForm.getByRole('textbox', { name: 'Story', exact: true });
    await expect(story).toHaveValue('');
    await story.fill('B own story');
    await expect.poll(() => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!).form.note, DRAFT)).toBe('B own story');
    await shot(page, `${width}-${departure}-b-story`);
  });
}

test('same-account refresh preserves the open story, Plan handoff and skipped mission', async ({ page }) => {
  await setup(page);
  const form = await openComposer(page);
  await seedOtherPrivateArtifacts(page);
  await page.evaluate(key => sessionStorage.setItem(key, '["old-mission"]'), MISSION);
  const before = await page.evaluate(() => ({ ...sessionStorage }));
  await provider(page, 'A', 'TOKEN_REFRESHED');
  await expect(form.getByRole('textbox', { name: 'Story', exact: true })).toHaveValue('A private typed story');
  expect(await page.evaluate(() => ({ ...sessionStorage }))).toEqual(before);
  await shot(page, 'same-account-preserves-story');
});

test('B sign-in after an expired-session reload clears A persisted drafts before opening the composer', async ({ page }) => {
  const auth = await setup(page);
  await openComposer(page);
  await seedOtherPrivateArtifacts(page);
  await page.evaluate(key => sessionStorage.setItem(key, '["old-mission"]'), MISSION);
  await auth.signedInAs(null);
  await page.goto('/today');
  await expect(page.getByRole('button', { name: /Account options/ })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('pubmax_account_owner'))).toBe(ACCOUNTS.A.id);
  expect(await page.evaluate(key => sessionStorage.getItem(key), DRAFT)).not.toBeNull();
  await provider(page, 'B');
  await assertPrivateArtifactsGone(page);
  await auth.signedInAs('B');
  const form = await openComposer(page, 'B', false);
  await expect(form.getByRole('textbox', { name: 'Story', exact: true })).toHaveValue('');
  await shot(page, 'reload-recovery-b-clean');
});

for (const departure of ['switch', 'provider sign-out', 'explicit sign-out'] as const) {
  test(`${departure}: a mounted skipped price mission returns for B on the same venue`, async ({ page }) => {
    await setup(page, 1440);
    await page.goto(`/map?sel=${VENUE}`);
    await expect(page.getByRole('button', { name: `Account options for ${ACCOUNTS.A.name}`, exact: true })).toBeVisible();
    const inspector = page.locator('.venueInspector').filter({ visible: true });
    const expand = page.getByRole('button', { name: 'Expand sheet', exact: true });
    if (!(await inspector.isVisible()) && await expand.isVisible()) await expand.click();
    await expect(inspector).toBeVisible();
    const slot = inspector.locator('.pemSlot').filter({ visible: true });
    await expect(slot).toBeVisible();
    await slot.getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(slot).toHaveCount(0);
    expect(await page.evaluate(key => sessionStorage.getItem(key), MISSION)).not.toBeNull();
    await shot(page, `mission-${departure}-a-dismissed`);
    if (departure === 'switch') await switchRememberedAccount(page, 'A', 'B');
    else if (departure === 'provider sign-out') { await provider(page, null); await provider(page, 'B'); }
    else {
      await page.getByRole('button', { name: /Account options/ }).first().click();
      await page.locator('.authAccountMenu').getByRole('button', { name: `Sign out of @${ACCOUNTS.A.handle}`, exact: true }).click();
    }
    const menu = page.locator('.authAccountMenu');
    if (await menu.isVisible()) await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: `Account options for ${ACCOUNTS.B.name}`, exact: true })).toBeVisible();
    expect(await page.evaluate(key => sessionStorage.getItem(key), MISSION)).toBeNull();
    await expect(slot).toBeVisible();
    await expect(slot).toContainText('Prospect of Whitby');
    await shot(page, `mission-${departure}-b-returned`);
  });
}
