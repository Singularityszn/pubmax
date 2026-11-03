import { expect, test, type Page } from '@playwright/test';
import { storeThemeChoice } from './helpers/themeClock';
import { ACCOUNTS, installAuthDoubles, readDeviceIdentity, seedSignedIn, switchRememberedAccount } from './helpers/authDoubles';

const picker = (page: Page) => page.getByLabel('Night preview', { exact: true });

async function menu(page: Page) {
  const trigger = page.getByRole('button', { name: 'More pages', exact: true });
  await expect(async () => {
    await expect(trigger).toBeEnabled();
    await trigger.focus();
    if (await trigger.getAttribute('aria-expanded') !== 'true') await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: /^Round Rota/ })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20000 });
  return page.getByRole('menu', { name: 'More pages', exact: true });
}

// Oracle: B0 requires public device choices, one selection, and restored keyboard focus.
// This rejects a menu that removes its focused action and leaves focus on the body.
for (const host of [{ name: 'Home', path: '/' }, { name: 'Map', path: '/map' }, { name: 'Plan', path: '/plan' }]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${host.name} desktop ${theme} restores focus after every choice`, async ({ page }, info) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await storeThemeChoice(page, theme);
      await page.goto(`${host.path}?wild=1`);
      const trigger = page.getByRole('button', { name: 'More pages', exact: true });
      for (const [label, value] of [['Round Rota', 'round-rota'], ['Borough Bingo', 'borough-bingo'], ['Previews off', null]] as const) {
        const surface = await menu(page);
        await expect(surface.getByRole('menuitem').filter({ hasText: /Selected on this browser|Select this public preview/ })).toHaveCount(3);
        const choice = surface.getByRole('menuitem', { name: new RegExp(`^${label}`) });
        await choice.focus();
        await page.keyboard.press('Enter');
        await expect(surface).toHaveCount(0);
        await expect(trigger).toBeFocused();
        expect(await page.evaluate(() => localStorage.getItem('pubmax-wild-night-preview'))).toBe(value);
        const reopened = await menu(page);
        await expect(reopened.getByRole('menuitem', { name: new RegExp(`^${label}`) })).toContainText('Selected on this browser');
        if (value === 'borough-bingo') await page.screenshot({ path: info.outputPath('desktop-menu.png') });
        await page.keyboard.press('Escape');
        await expect(reopened).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
      await menu(page);
      await page.mouse.click(10, 700);
      await expect(page.getByRole('menu', { name: 'More pages', exact: true })).toHaveCount(0);
    });
  }
}

for (const host of [{ name: 'Home', path: '/', header: '.lpNav' }, { name: 'Map', path: '/map', header: '.mobileMapTopbar' }, { name: 'Plan', path: '/plan', header: '.siteNavBar' }]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${host.name} phone ${theme} captures 200 percent text and keyboard choice`, async ({ page }, info) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await storeThemeChoice(page, theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`${host.path}?wild=1`);
      const select = picker(page);
      await expect(select).toBeVisible();
      await expect(select).toHaveCount(1);
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await expect.poll(() => page.locator('html').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(32);
      await page.evaluate(() => document.fonts.ready);
      await expect(select).toHaveValue('off');
      await select.focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('b');
      await page.keyboard.press('Enter');
      await expect(select).toHaveValue('borough-bingo');
      if (host.name === 'Home') {
        await expect(page.locator(host.header).getByText('Sign in', { exact: true })).toBeVisible();
      }
      const nav = await page.locator(host.header).boundingBox();
      const box = await select.boundingBox();
      expect(nav).not.toBeNull();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height - 1);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      if (host.name === 'Home') {
        // Oracle: large text must preserve every header control, including Sign in.
        // Page width alone would miss controls clipped by the landing container.
        const header = page.locator(host.header);
        for (const control of await header.locator('a, button').all()) {
          if (!await control.isVisible()) continue;
          const bounds = await control.boundingBox();
          expect(bounds!.x).toBeGreaterThanOrEqual(nav!.x);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(nav!.x + nav!.width);
          expect(await control.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
          })).toBe(true);
        }
      }
      await page.screenshot({ path: info.outputPath('phone-picker-200.png') });
    });
  }
}

test('fresh browser and selected links remain hidden with the master off', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/map', '/plan']) {
    await page.goto(path);
    await expect(picker(page)).toHaveCount(0);
    await page.goto(`${path}?wildpreview=round-rota`);
    await expect.poll(() => new URL(page.url()).search).toBe('');
    await expect(picker(page)).toHaveCount(0);
  }
  await page.goto('/plan?wild=1&wildpreview=off');
  await expect(picker(page)).toHaveValue('off');
  await picker(page).selectOption('round-rota');
  await expect(picker(page)).toHaveValue('round-rota');
  await picker(page).selectOption('borough-bingo');
  await expect(picker(page)).toHaveValue('borough-bingo');
  await picker(page).selectOption('off');
  await expect(picker(page)).toHaveValue('off');
});

test('SPA selection scrubs only its query bytes and retains history state and length', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/plan?wild=1');
  await expect(picker(page)).toBeVisible();
  const before = await page.evaluate(() => {
    history.pushState({ proof: { retained: 'yes' } }, '', '/plan?keep=a%20b&wildpreview=round-rota&keep=a+b&empty=&encoded=%2f#detail%20one');
    return history.length;
  });
  await expect(picker(page)).toHaveValue('round-rota');
  await expect.poll(() => new URL(page.url()).search).toBe('?keep=a%20b&keep=a+b&empty=&encoded=%2f');
  expect(new URL(page.url()).hash).toBe('#detail%20one');
  expect(await page.evaluate(() => history.length)).toBe(before);
  expect(await page.evaluate(() => history.state.proof)).toEqual({ retained: 'yes' });
  await page.screenshot({ path: info.outputPath('spa-selected.png') });
  await page.evaluate(() => history.pushState({ off: true }, '', '/plan?keep=a%20b&wildpreview=off#off'));
  await expect(picker(page)).toHaveValue('off');
  await expect.poll(() => new URL(page.url()).search).toBe('?keep=a%20b');
  await page.evaluate(() => history.pushState(null, '', '/plan?wild=off&wildpreview=borough-bingo'));
  await expect(picker(page)).toHaveCount(0);
});

test('denied preview storage keeps selection usable for this document', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const original = { getItem: Storage.prototype.getItem, setItem: Storage.prototype.setItem, removeItem: Storage.prototype.removeItem };
    const check = (key: string) => { if (key === 'pubmax-wild-night-preview') throw new DOMException('Storage denied', 'SecurityError'); };
    Storage.prototype.getItem = function(key) { check(key); return original.getItem.call(this, key); };
    Storage.prototype.setItem = function(key, value) { check(key); original.setItem.call(this, key, value); };
    Storage.prototype.removeItem = function(key) { check(key); original.removeItem.call(this, key); };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/today?wild=1&wildpreview=round-rota');
  await expect(picker(page)).toHaveValue('round-rota');
  await picker(page).selectOption('borough-bingo');
  await expect(picker(page)).toHaveValue('borough-bingo');
  await picker(page).selectOption('off');
  await expect(picker(page)).toHaveValue('off');
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('denied-storage.png') });
  await page.reload();
  await expect(picker(page)).toHaveValue('off');
});

test('fully denied storage fails closed without a page error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage denied', 'SecurityError'); } });
  });
  await page.goto('/today?wild=1&wildpreview=borough-bingo');
  await expect.poll(() => new URL(page.url()).search).toBe('');
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More pages', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('mounted account switching retains a device preview and uses the new account identity', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stub = await installAuthDoubles(page);
  await seedSignedIn(page, 'A');
  await page.goto('/today?wild=1&wildpreview=round-rota');
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await stub.signedInAs('B');
  await page.goto('/today');
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await expect(picker(page)).toHaveValue('round-rota');
  await switchRememberedAccount(page, 'B', 'A');
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await expect(picker(page)).toHaveValue('round-rota');
  await page.screenshot({ path: info.outputPath('account-switch.png') });
});

test('another tab rejects an unknown stored idea and handles cleared storage', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/today?wild=1&wildpreview=round-rota');
  await expect(picker(page)).toHaveValue('round-rota');
  const other = await context.newPage();
  try {
    await other.goto('/today');
    await other.evaluate(() => localStorage.setItem('pubmax-wild-night-preview', 'pub-tarot'));
    await expect(picker(page)).toHaveValue('off');
    await other.evaluate(() => localStorage.setItem('pubmax-wild-night-preview', 'borough-bingo'));
    await expect(picker(page)).toHaveValue('borough-bingo');
    await other.evaluate(() => localStorage.clear());
    // Clearing storage must remove the preview. The existing master switch
    // owns whether the picker itself remains mounted.
    await expect.poll(async () => await picker(page).count() === 0 ? 'off' : await picker(page).inputValue()).toBe('off');
  } finally {
    await other.close();
  }
});
