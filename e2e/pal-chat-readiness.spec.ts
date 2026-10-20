import { expect, test } from '@playwright/test';

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
  await field.fill('cheap pint near Bank');
  release();
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeEnabled({ timeout: 20_000 });
  await expect(field).toHaveValue('cheap pint near Bank');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('.palChatRow--user')).toHaveCount(1);
  await expect.poll(() => posts).toBe(1);
  await expect(page.locator('.palChatBubble--pending')).toHaveCount(0);
});
