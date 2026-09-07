import { chromium, devices } from "playwright";
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 15 Pro"], colorScheme: "light" });
await context.addInitScript(() => {
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
});
const page = await context.newPage();
await page.goto("http://localhost:3811/tonight", { waitUntil: "networkidle" });
await page.waitForSelector('html[data-native-shell]', { timeout: 15000 });
const before = await page.evaluate(() => document.documentElement.dataset.theme);
await page.emulateMedia({ colorScheme: "dark" });
await page.waitForTimeout(300);
const afterDark = await page.evaluate(() => document.documentElement.dataset.theme);
await page.emulateMedia({ colorScheme: "light" });
await page.waitForTimeout(300);
const afterLight = await page.evaluate(() => document.documentElement.dataset.theme);
// A stored choice must win.
await page.evaluate(() => localStorage.setItem("pubmax-theme", "light"));
await page.emulateMedia({ colorScheme: "dark" });
await page.waitForTimeout(300);
const stored = await page.evaluate(() => document.documentElement.dataset.theme);
console.log(JSON.stringify({ before, afterDark, afterLight, storedLightUnderDarkOs: stored }));
await browser.close();
