import { test, expect, type Page } from '@playwright/test';
import { ACCOUNTS, AUTH_STORAGE_KEY, DEVICE_ACCOUNTS_KEY, accessJwt, installAuthDoubles, readDeviceAccounts, readDeviceIdentity } from './helpers/authDoubles';

// Oracle: G14 requires token refresh to preserve a draft and only banned refusals
// to show the ban notice. The browser runs the real app and Supabase client.
// Only external auth and owner-data responses use disposable fixture accounts.
const EVIDENCE = process.env.PUBMAX_TEST_EVIDENCE_DIR;
async function seed(page: Page, needed = false, width = 1440, theme = 'light') {
  await page.setViewportSize({ width, height: 1000 });
  await installAuthDoubles(page);
  await page.route('**/__g14_seed', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
  await page.goto('/__g14_seed');
  await page.evaluate(() => localStorage.setItem('__e2e_signed_in_account', 'A'));
  await page.addInitScript(({ accounts, key, theme }) => {
    localStorage.setItem('pubmax-theme', theme);
    localStorage.setItem('pubmax_onboarding_dismissed', '1');
    sessionStorage.setItem('pubmax_onboarding_dismissed', '1');
    localStorage.setItem('pubmax-tour-v1-done', '1');
    localStorage.setItem(key, JSON.stringify(Object.values(accounts).map(a => ({
      userId: a.id, refreshToken: a.refreshToken, email: a.email, handle: a.handle, lastActiveAt: Date.now(),
    }))));
  }, { accounts: ACCOUNTS, key: DEVICE_ACCOUNTS_KEY, theme });
  let reads = 0;
  await page.route('**/api/identity/onboarding', async route => {
    reads++;
    const isB = route.request().headers().authorization === `Bearer ${accessJwt(ACCOUNTS.B)}`;
    await route.fulfill({ json: { complete: !needed || isB, handle: needed && !isB ? null : (isB ? ACCOUNTS.B.handle : ACCOUNTS.A.handle) } });
  });
  if (needed) await page.route('**/api/identity/handle/current', route => route.fulfill({ json: { handle: null } }));
  await page.route('**/api/identity/handle/availability**', route => route.fulfill({ json: { available: true } }));
  await page.route('**/api/auth/session', route => route.fulfill({ json: { status: 'stored' } }));
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: "Let's get you in", exact: true });
  if (needed) await expect(dialog).toBeVisible();
  else await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  return { dialog, reads: () => reads };
}
async function refusal(page: Page, banned: boolean) {
  await page.route('https://pubmaxx-e2e.supabase.co/auth/v1/token**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    await route.fulfill({ status: banned ? 403 : 400, headers: { 'access-control-allow-origin': '*' }, json: { error_code: banned ? 'user_banned' : 'invalid_grant', msg: banned ? 'User is banned' : 'Refresh token expired' } });
  });
}
async function openMenu(page: Page) {
  const account = page.getByRole('region', { name: 'Signed-in account', exact: true });
  await expect(account).toBeVisible();
  return account;
}
async function switchB(surface: ReturnType<Page['locator']>) {
  await surface.getByRole('button', { name: 'Switch account', exact: true }).click();
  await surface.locator('button.authSwitcherRow').filter({ hasText: '@karansznx' }).click();
}
async function retired(page: Page) {
  await expect.poll(async () => (await readDeviceAccounts(page)).find(a => a.userId === ACCOUNTS.B.id)?.refreshToken).toBeNull();
}
async function shot(page: Page, name: string) { if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: true }); }

test('refresh keeps the typed handle and does not read onboarding again', async ({ page }) => {
  const state = await seed(page, true, 390);
  const input = state.dialog.locator('input').first();
  await input.fill('my_unfinished_handle');
  const before = state.reads();
  const refreshed = accessJwt(ACCOUNTS.A);
  const persisted = page.waitForRequest(r => r.url().endsWith('/api/auth/session') && r.method() === 'POST' && r.headers().authorization === `Bearer ${refreshed}`);
  await page.evaluate(({ key, token }) => {
    const session = JSON.parse(localStorage.getItem(key)!);
    session.access_token = token;
    localStorage.setItem(key, JSON.stringify(session));
    const channel = new BroadcastChannel(key);
    channel.postMessage({ event: 'TOKEN_REFRESHED', session });
    channel.close();
  }, { key: AUTH_STORAGE_KEY, token: refreshed });
  await persisted;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(input).toHaveValue('my_unfinished_handle');
  expect(state.reads()).toBe(before);
  await shot(page, 'refresh-preserves-handle-390');
  await switchB(state.dialog);
  await expect(state.dialog).toHaveCount(0);
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  expect(state.reads()).toBeGreaterThan(before);
  await shot(page, 'different-account-rereads-onboarding-390');
});

for (const [width, theme] of [[390, 'light'], [768, 'dark'], [1440, 'light']] as const) {
  test(`banned switch stays usable inside onboarding at ${width}px ${theme}`, async ({ page }) => {
    const { dialog } = await seed(page, true, width, theme);
    if (width === 768) await page.evaluate(() => document.documentElement.style.fontSize = '125%');
    await dialog.locator('input').first().fill('draft_kept_after_refusal');
    await refusal(page, true);
    await switchB(dialog);
    const alert = dialog.getByRole('alert').filter({ hasText: 'This account has been banned' });
    await expect(alert).toContainText('This account has been banned');
    await expect(page.getByRole('alert').filter({ hasText: 'This account has been banned' })).toHaveCount(1);
    const terms = alert.getByRole('link', { name: 'Community guidelines' });
    await expect(terms).toHaveAttribute('href', '/terms');
    await terms.focus();
    await expect(terms).toBeFocused();
    await terms.click({ trial: true });
    await retired(page);
    await expect(dialog.locator('input').first()).toHaveValue('draft_kept_after_refusal');
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).user.id, AUTH_STORAGE_KEY)).toBe(ACCOUNTS.A.id);
    await shot(page, `banned-onboarding-${width}-${theme}`);
    await alert.getByRole('button', { name: 'Dismiss' }).focus();
    await page.keyboard.press('Enter');
    await expect(alert).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });
}

for (const path of ['switch', 'handoff'] as const) {
  for (const banned of [true, false]) {
    test(`${path} ${banned ? 'banned' : 'expired'} remembered account`, async ({ page }) => {
      await seed(page);
      await refusal(page, banned);
      const menu = await openMenu(page);
      if (path === 'switch') await switchB(menu);
      else await menu.getByRole('button', { name: 'Sign out of @karan', exact: true }).click();
      await retired(page);
      if (banned) {
        const alert = page.getByRole('alert').filter({ hasText: 'This account has been banned' });
        await expect(alert).toBeVisible();
        await shot(page, `${path}-banned-global-notice`);
        await alert.getByRole('button', { name: 'Dismiss' }).click();
        await expect(alert).toHaveCount(0);
      } else {
        await expect(page.getByRole('alert').filter({ hasText: 'This account has been banned' })).toHaveCount(0);
        await shot(page, `${path}-expired-no-ban-notice`);
      }
      if (path === 'switch') {
        await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
        expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).user.id, AUTH_STORAGE_KEY)).toBe(ACCOUNTS.A.id);
      } else {
        await expect(page.getByRole('region', { name: 'Signed-in account', exact: true })).toHaveCount(0);
        expect(await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();
      }
    });
  }
}

test('successful remembered switch changes the owner without a ban notice', async ({ page }) => {
  await seed(page);
  await switchB(await openMenu(page));
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await expect(page.getByRole('alert').filter({ hasText: 'This account has been banned' })).toHaveCount(0);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).user.id, AUTH_STORAGE_KEY)).toBe(ACCOUNTS.B.id);
  await shot(page, 'successful-remembered-switch');
});

test('onboarding sign-out handoff shows the ban notice after closing the modal', async ({ page }) => {
  const { dialog } = await seed(page, true, 390);
  await refusal(page, true);
  await dialog.getByRole('button', { name: 'Sign out of this account', exact: true }).click();
  await retired(page);
  await expect(dialog).toHaveCount(0);
  const alert = page.getByRole('alert').filter({ hasText: 'This account has been banned' });
  await expect(alert).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();
  await shot(page, 'onboarding-signout-banned-handoff');
  await alert.getByRole('button', { name: 'Dismiss' }).click();
  await expect(alert).toHaveCount(0);
});

test('onboarding guidelines link opens readable community rules', async ({ page }) => {
  const { dialog } = await seed(page, true, 390);
  await dialog.locator('input').first().fill('draft_before_guidelines');
  await refusal(page, true);
  await switchB(dialog);
  await dialog.getByRole('alert').filter({ hasText: 'This account has been banned' })
    .getByRole('link', { name: 'Community guidelines', exact: true }).click();
  await expect(page).toHaveURL(/\/terms$/);
  const title = page.locator('h1.legalTitle');
  await expect(title).toBeAttached();
  await shot(page, 'onboarding-guidelines-destination');
  // The rules must be readable and usable after the reader follows their link.
  await title.click({ trial: true });
  await expect(dialog).toHaveCount(0);
  await page.goBack();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input').first()).toHaveValue('draft_before_guidelines');
  await shot(page, 'onboarding-guidelines-return-preserves-draft');
});
