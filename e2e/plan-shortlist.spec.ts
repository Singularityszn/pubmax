import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { londonDateTimeInputFromIso } from "@/lib/planIntake";

declare global {
  interface Window {
    recordShortlistBeacon: (payload: string) => Promise<void>;
  }
}

test.afterEach(async ({ page }, testInfo) => {
  if (process.env.PW_SHORTLIST_EVIDENCE && testInfo.status !== testInfo.expectedStatus) {
    await page.screenshot({ path: join(process.env.PW_SHORTLIST_EVIDENCE, `${testInfo.project.name}-${testInfo.line}-failure.png`), fullPage: true });
  }
});

test("organiser and guest agree on one pub using the same invite link", async ({ page, browser }, testInfo) => {
  const events: Record<string, unknown>[] = [];
  const accepted: number[] = [];
  async function observeBeacons(target: import("@playwright/test").Page) {
    await target.exposeFunction("recordShortlistBeacon", (payload: string) => {
      const event = JSON.parse(payload);
      if (event.name?.startsWith("plan_shortlist_")) events.push(event);
    });
    await target.addInitScript(() => {
      localStorage.setItem("pubmaxx:analytics-consent:v1", "granted");
      const original = navigator.sendBeacon.bind(navigator);
      // Observe the emitted beacon without replacing its real transport.
      navigator.sendBeacon = (url, data) => {
        if (new URL(String(url), location.href).pathname === "/api/events" && data instanceof Blob) {
          void data.text().then((payload) => window.recordShortlistBeacon(payload));
        }
        return original(url, data);
      };
    });
    target.on("response", (response) => {
      if (new URL(response.url()).pathname === "/api/events") accepted.push(response.status());
    });
  }
  await observeBeacons(page);
  await page.goto("/pubs");
  await page.getByRole("link", { name: "Shortlist pubs" }).click();
  await expect(page.getByRole("heading", { name: "Shortlist pubs" })).toBeVisible();
  await page.getByLabel("Meet in").selectOption("piccadilly-soho");
  await page.getByLabel("Whole outing budget per person").fill("25");
  const findPubs = page.getByRole("button", { name: "Find pubs" });
  await expect(async () => {
    await findPubs.click();
    await expect(page.getByRole("group", { name: "Suggested pubs" })).toBeVisible();
  }).toPass();
  const choices = page.getByRole("group", { name: "Suggested pubs" }).getByRole("checkbox");
  await expect(choices).toHaveCount(6);
  await choices.nth(0).check();
  await choices.nth(1).check();
  await page.getByRole("button", { name: "Create shortlist" }).click();
  const share = page.getByRole("link", { name: "Send on WhatsApp" });
  await expect(share).toBeVisible();
  const evidence = process.env.PW_SHORTLIST_EVIDENCE;
  if (evidence) await page.screenshot({ path: join(evidence, `${testInfo.project.name}-organiser.png`) });
  const href = await share.getAttribute("href");
  const inviteUrl = new URL(href!).searchParams.get("text")!;
  expect(inviteUrl).toMatch(/\/invite\/[0-9a-f]{32}$/);
  await expect(page.getByLabel("Invite link")).toHaveValue(inviteUrl);
  await page.getByRole("button", { name: "Copy invite link" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Invite link copied|Select the invite link to copy it/ })).toBeVisible();
  await page.context().route("https://wa.me/**", (route) => route.abort());
  const popup = page.waitForEvent("popup");
  await share.click();
  await (await popup).close();
  await expect(async () => expect(events.some((event) => event.name === "plan_shortlist_shared")).toBe(true)).toPass();
  expect(events.some((event) => event.name === "plan_shortlist_invite_opened")).toBe(false);
  const hostPath = new URL(page.url()).pathname;
  const token = new URL(inviteUrl).pathname.split("/").at(-1);
  const votePath = `/api/invite/${token}/vote`;
  const meeting = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const guestContext = await browser.newContext({ ...testInfo.project.use });
  try {
    const guest = await guestContext.newPage();
    await observeBeacons(guest);
    await guest.goto(inviteUrl);
    const names = await guest.getByRole("heading", { level: 2 }).allTextContents();
    expect(names).toHaveLength(2);
    await expect(guest.getByText(/Whole outing budget/)).toHaveCount(0);
    const forbidden = await guest.request.post(`/api${hostPath.replace("/plan/", "/plans/")}/shortlist`, {
      data: { venueId: "not-a-pub", startTime: meeting },
    });
    expect(forbidden.status()).toBe(403);

    const first = guest.getByRole("button", { name: `Vote for ${names[0]}`, exact: true });
    await expect(async () => {
      await first.click();
      await expect(first).toHaveAttribute("aria-pressed", "true");
    }).toPass();
    await guest.reload();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await first.click();
    const second = guest.getByRole("button", { name: `Vote for ${names[1]}`, exact: true });
    await second.click();
    await expect(second).toHaveAttribute("aria-pressed", "true");
    if (evidence) await guest.screenshot({ path: join(evidence, `${testInfo.project.name}-vote.png`) });
    await expect(guest.getByText("1 vote", { exact: true })).toHaveCount(1);

    await page.getByLabel("Pub to confirm").selectOption({ label: names[1] });
    await page.getByLabel("Meet at (London time)").fill(londonDateTimeInputFromIso(meeting)!);
    await page.getByRole("button", { name: "Confirm pub and time" }).click();
    await expect(page.getByText("Pub and time confirmed")).toBeVisible();
    const late = guest.waitForResponse((response) => response.url().endsWith(votePath) && response.request().method() === "POST");
    await first.click();
    expect((await late).status()).toBe(409);
    await expect(guest.getByRole("heading", { name: names[1], exact: true })).toBeVisible();
    await guest.reload();
    await expect(guest).toHaveURL(inviteUrl);
    await expect(guest.getByText(/London time/)).toBeVisible();
    await expect(guest.getByRole("link", { name: "Open directions" })).toHaveAttribute("href", /google\.com\/maps/);

    if (evidence) await guest.screenshot({ path: join(evidence, `${testInfo.project.name}-confirmed.png`) });
    await expect(async () => {
      for (const name of ["created", "shared", "invite_opened", "vote_submitted", "confirmed"]) {
        expect(events.some((event) => event.name === `plan_shortlist_${name}`)).toBe(true);
      }
    }).toPass();
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.every((status) => status === 204)).toBe(true);
    expect(events.filter((event) => event.name === "plan_shortlist_shared").some((event) => (event.props as { channel?: string }).channel === "whatsapp")).toBe(true);
    expect(JSON.stringify(events)).not.toContain(token);
    for (const event of events) expect(Object.keys(event.props as object).every((key) => key === "channel")).toBe(true);
    if (evidence) writeFileSync(join(evidence, `${testInfo.project.name}-analytics.json`), JSON.stringify({ events, accepted }, null, 2));

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Make new invite link" }).click();
    await expect(page.getByText("New invite link ready")).toBeVisible();
    await guest.reload();
    await expect(guest.getByRole("heading", { name: /invite link isn.t valid/i })).toBeVisible();
  } finally {
    await guestContext.close();
  }
});

