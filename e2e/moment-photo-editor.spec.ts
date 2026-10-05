import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROOF_PATH = "docs/proof/moment-photo-editor/moment-editor-390.png";
const PHOTO = readFileSync(resolve(process.cwd(), "docs/proof/night-mode-mid-crawl/after-390.png"));

async function momentPreviewDigest(page: Page): Promise<string> {
  return page.getByRole("img", { name: "Moment preview" }).evaluate(async (element) => {
    const image = element as HTMLImageElement;
    // Object URLs from the first-party picker can fail `fetch()` under the
    // production CSP even while the <img> paints. Hash the decoded pixels.
    if (!image.complete || image.naturalWidth === 0) {
      await new Promise<void>((resolve, reject) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => reject(new Error("Moment preview failed to paint.")), { once: true });
      });
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Moment preview could not be read.");
    context.drawImage(image, 0, 0);
    const digest = await crypto.subtle.digest("SHA-256", context.getImageData(0, 0, canvas.width, canvas.height).data);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  });
}

async function editorCanvasDigest(canvas: Locator): Promise<string> {
  return canvas.evaluate(async (element) => {
    const blob = await new Promise<Blob | null>((resolveBlob) => {
      (element as HTMLCanvasElement).toBlob(resolveBlob, "image/png");
    });
    if (!blob) throw new Error("Editor canvas could not be read.");
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  });
}

async function seedMomentGuest(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    // Consent docks after the product answers; a photo upload counts, so pin
    // the wait as already satisfied before the editor opens.
    window.sessionStorage.setItem("pubmax:consent-answer-moment:v1", "second-route");
  });
}

const MOMENT_URL = process.env.PW_MOMENT_BASE_URL
  ? `${process.env.PW_MOMENT_BASE_URL}/moment`
  : "/moment";

async function attachPhoto(page: Page): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles({
    name: "night.png",
    mimeType: "image/png",
    buffer: PHOTO,
  });
  await expect(page.getByRole("button", { name: "Edit night.png" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Edit photo" })).toHaveCount(0);
}

test.describe("Moment photo editor with the sign-in nudge armed", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a guest's first tap on Edit opens a usable editor, and the nudge waits for it to close", async ({ page }) => {
    await seedMomentGuest(page);
    // The first photo arms the "Own your memories" nudge, which then waits out
    // an 8 s first-paint grace or the first tap. Hold the page's clock so only
    // the Edit tap can end that grace, however slow the runner is.
    const start = Date.now();
    await page.clock.install({ time: start });
    await page.clock.pauseAt(start + 5_000);
    await page.goto(MOMENT_URL);
    await attachPhoto(page);
    // The draft save that arms the nudge is debounced by 300 ms.
    await page.clock.runFor(1_000);
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("pubmax:identityNudge:pending:v1")))
      .toBe("moment");
    await expect(page.getByRole("dialog", { name: "Own your memories" })).toHaveCount(0);

    await page.getByRole("button", { name: "Edit night.png" }).click();
    // The tap has ended the grace. The editor is a lazy chunk whose Suspense
    // reveal waits on timers, so let the page's time run again.
    await page.clock.resume();

    const editor = page.getByRole("dialog", { name: "Edit photo" });
    const nudge = page.getByRole("dialog", { name: "Own your memories" });
    await expect(editor).toBeVisible();
    // The tap ended the grace, but the nudge never opens over the editor: two
    // strict modals inert each other and neither could be reached.
    await expect(nudge).toHaveCount(0);
    expect(await editor.evaluate((node) => node.closest("[inert]") === null)).toBe(true);

    await page.getByRole("button", { name: "Close editor" }).click();
    await expect(editor).toBeHidden();
    await expect(nudge).toBeVisible();
  });
});

test.describe("Moment photo editor", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await seedMomentGuest(page);
    await page.addInitScript(() => {
      // A guest's first photo arms the "Own your memories" sign-in nudge, and
      // the nudge opens on the first tap or after 8 s, over whatever is on
      // screen. This journey is about the editor, so the guest has already
      // said "not now" this week (lib/identityNudge.ts cooldown).
      window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    });
  });

  test("edits with first-party crop, filter, text, and draw tools", async ({ page }) => {
    // Photo editing is private: after the editor opens, the journey may reach no
    // third-party origin and may make no external write. The explicit phase
    // boundary keeps a page-owned request that settles before or during the Edit
    // click out of the editor bucket without naming any provider.
    let captureEditorNetwork = false;
    const editorCrossOriginRequests: string[] = [];
    const editorExternalWrites: string[] = [];
    page.on("request", (request) => {
      const requestUrl = new URL(request.url());
      const appUrl = new URL(page.url());
      if (requestUrl.protocol === "blob:" || requestUrl.protocol === "data:") return;
      if (requestUrl.origin === appUrl.origin) return;
      if (!captureEditorNetwork) return;
      editorCrossOriginRequests.push(request.url());
      if (!["GET", "HEAD"].includes(request.method())) {
        editorExternalWrites.push(request.url());
      }
    });

    await page.goto(MOMENT_URL);
    await attachPhoto(page);
    const originalDigest = await momentPreviewDigest(page);

    await page.getByRole("button", { name: "Edit night.png" }).click();
    captureEditorNetwork = true;
    const dialog = page.getByRole("dialog", { name: "Edit photo" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: "Close editor" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use photo" })).toBeVisible();
    expect(editorCrossOriginRequests).toEqual([]);
    expect(editorExternalWrites).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("img", { name: "Moment preview" })).toBeVisible();

    await page.getByRole("button", { name: "Edit night.png" }).click();
    await expect(dialog).toBeVisible();
    const usePhoto = page.getByRole("button", { name: "Use photo" });
    await expect(usePhoto).toBeEnabled();
    await usePhoto.click();

    await expect(page.getByRole("group", { name: "Filter" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await momentPreviewDigest(page)).toBe(originalDigest);

    await page.getByRole("button", { name: "Edit night.png" }).click();
    await page.getByRole("button", { name: "Use photo" }).click();
    await expect(page.getByRole("group", { name: "Filter" })).toBeVisible();
    const canvas = page.getByRole("img", { name: "Edited photo preview" });
    await expect(canvas).toBeVisible();
    const originalCanvasDigest = await editorCanvasDigest(canvas);
    await page.getByRole("button", { name: "Warm" }).click();
    await expect(page.getByRole("button", { name: "Warm" })).toHaveAttribute("aria-pressed", "true");
    let filterCanvasDigest = originalCanvasDigest;
    await expect.poll(async () => {
      filterCanvasDigest = await editorCanvasDigest(canvas);
      return filterCanvasDigest;
    }).not.toBe(originalCanvasDigest);
    await page.getByRole("textbox", { name: "Text" }).fill("Friday detour");
    let textCanvasDigest = filterCanvasDigest;
    await expect.poll(async () => {
      textCanvasDigest = await editorCanvasDigest(canvas);
      return textCanvasDigest;
    }).not.toBe(filterCanvasDigest);
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      const start = { clientX: box.x + box.width * 0.25, clientY: box.y + box.height * 0.35 };
      const end = { clientX: box.x + box.width * 0.7, clientY: box.y + box.height * 0.55 };
      await canvas.dispatchEvent("pointerdown", { ...start, pointerId: 7, pointerType: "touch", isPrimary: true });
      await canvas.dispatchEvent("pointermove", { ...end, pointerId: 7, pointerType: "touch", isPrimary: true });
      await canvas.dispatchEvent("pointerup", { ...end, pointerId: 7, pointerType: "touch", isPrimary: true });
    }
    await expect(page.getByRole("button", { name: "Clear drawing" })).toBeEnabled();
    await expect.poll(() => editorCanvasDigest(canvas)).not.toBe(textCanvasDigest);
    await page.screenshot({ path: PROOF_PATH, fullPage: false });
    await page.getByRole("button", { name: "Use photo" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Edited photo ready.")).toBeVisible();
    expect(await momentPreviewDigest(page)).not.toBe(originalDigest);
    expect(editorCrossOriginRequests).toEqual([]);
    expect(editorExternalWrites).toEqual([]);
  });
});
