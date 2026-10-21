import { expect, test } from '@playwright/test';
import { uiUxChromiumProjectUse } from "../scripts/lib/uiUxBattleTestBrowser.mjs";

test.use(uiUxChromiumProjectUse(process.env.UI_UX_BROWSER_CHANNEL));
import { ACCOUNTS, accessJwt, installAuthDoubles } from './helpers/authDoubles';

test('an unresolved owner cannot accept a draft before a delayed account restore', async ({ page }) => {
  await installAuthDoubles(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let reading = false;
  let releaseOpening!: () => void;
  const pendingOpening = new Promise<void>(resolve => { releaseOpening = resolve; });
  await page.route('**/api/auth/session', async route => {
    if (route.request().method() === 'GET') {
      reading = true;
      await pending;
      return route.fulfill({ json: { hint: { maskedEmail: 'k***@example.test' } } });
    }
    if (route.request().postDataJSON()?.action === 'redeem') {
      return route.fulfill({ json: { status: 'restored', session: { access_token: accessJwt(ACCOUNTS.A), refresh_token: ACCOUNTS.A.refreshToken } } });
    }
    return route.fallback();
  });
  await page.route('**/api/pub-pal/chat', async route => {
    await pendingOpening;
    return route.fulfill({ json: { answer: 'Your saved night is ready.', cards: [], proposals: [], sources: [], conversationId: 'conv_readiness123' } });
  });
  await page.goto('/pal/chat');
  await expect.poll(() => reading).toBe(true);
  const field = page.getByRole('textbox', { name: 'Where, how many, what budget' });
  await expect(field).toBeDisabled();
  const chips = page.getByRole('group', { name: 'Pick a vibe' }).getByRole('button');
  await expect(chips).toHaveCount(7);
  for (const chip of await chips.all()) {
    await expect(chip).toBeDisabled();
  }
  await expect(page.getByRole('status').filter({ hasText: 'Checking your account' })).toBeVisible();
  release();
  await expect(field).toBeEnabled();
  await field.click();
  await field.fill('A quiet night in Soho');
  await expect(field).toHaveValue('A quiet night in Soho');
  releaseOpening();
  await expect(page.getByText('Your saved night is ready.', { exact: true })).toBeVisible();
  await expect(field).toHaveValue('A quiet night in Soho');
});

test('unavailable account readiness explains the disabled field and offers recovery', async ({ page }) => {
  await installAuthDoubles(page);
  await page.route('**/api/auth/session', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.goto('/pal/chat');
  await expect(page.getByRole('textbox', { name: 'Where, how many, what budget' })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Your account could not be checked' })).toBeVisible();
  const reload = page.waitForEvent('domcontentloaded');
  await page.getByRole('button', { name: 'Try account check again', exact: true }).click();
  await reload;
  await expect(page.getByRole('textbox', { name: 'Where, how many, what budget' })).toBeDisabled();
});

test('a single first draft survives delayed client loading and submits once', async ({ page }) => {
  let release!: () => void;
  const loading = new Promise<void>(resolve => { release = resolve; });
  let scripts = 0;
  await page.route(/\/_next\/static\/.*\.js(?:\?.*)?$/, async route => {
    scripts += 1;
    await loading;
    await route.continue();
  });
  let posts = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/pub-pal/chat' && request.method() === 'POST') posts += 1;
  });
  await page.goto('/pal/chat', { waitUntil: 'commit' });
  const field = page.getByRole('textbox', { name: 'Where, how many, what budget' });
  await expect(field).toBeVisible();
  await expect.poll(() => scripts).toBeGreaterThan(0);
  await expect(field).toBeDisabled();
  release();
  await expect(field).toBeEnabled();
  await field.click();
  await field.fill('cheap pint near Bank');
  release();
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeEnabled({ timeout: 20_000 });
  await expect(field).toHaveValue('cheap pint near Bank');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('.palChatRow--user')).toHaveCount(1);
  await expect.poll(() => posts).toBe(1);
  await expect(page.locator('.palChatBubble--pending')).toHaveCount(0);
});
