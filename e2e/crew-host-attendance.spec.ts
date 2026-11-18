import { expect, test, type Page, type Route } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// Oracle: design v5, host attendance. A host or co-host marks accepted guests Here
// or Not here with the revision they saw. A guest sees only their own mark. A
// failed read says it is unavailable, never an empty list. API doubles stand in
// for the protected crew and attendance routes only. They prove the page, not auth
// or the database; the PostgreSQL proofs cover those.

const CREW = "50000000-0000-4000-8000-000000000071";
const HOST = "30000000-0000-4000-8000-000000000071";
const ANA = "30000000-0000-4000-8000-000000000072";
const BEA = "30000000-0000-4000-8000-000000000073";
const path = `/social/crews/${CREW}`;
const api = `**/api/social/crews/${CREW}`;

function crew(role: "owner" | "member", arrival = false) {
  const viewer = role === "owner" ? HOST : ANA;
  return {
    // The real read always carries arrival, so focus and resume read the whole crew again.
    ...(arrival ? { arrival: { open: true, here: false, refreshAt: null } } : {}),
    kind: "member", crewId: CREW, title: "Thursday table", visibility: "open", phase: "live", nightArea: "Camden",
    startsAt: "2026-11-17T20:00:00.000Z", authorityRevision: 3,
    viewer: { memberId: viewer, role }, owner: { memberId: HOST, handle: "karan" },
    members: [
      { memberId: HOST, handle: "karan", role: "owner", joinedAt: "2026-11-10T12:00:00.000Z" },
      { memberId: ANA, handle: "ana_with_a_rather_long_handle", role: "member", joinedAt: "2026-11-11T12:00:00.000Z" },
      { memberId: BEA, handle: "bea", role: "member", joinedAt: "2026-11-12T12:00:00.000Z" },
    ],
    plan: { plan: { id: "60000000-0000-4000-8000-000000000071", title: "Thursday table", startTime: "2026-11-17T20:00:00.000Z",
      createdAt: "2026-11-10T12:00:00.000Z", status: "active" }, stops: [], context: null, actions: [], ending: null },
    openCrawl: null,
  };
}

const night = { open: true, opensAt: "2026-11-17T00:00:00.000Z", closesAt: "2026-11-18T08:00:00.000Z" };
const hostRead = { canAttest: true, ...night, items: [
  { memberId: ANA, state: "attended", revision: 1, recordedAt: "2026-11-17T20:15:00.000Z", recordedBy: "host" },
  { memberId: BEA, state: null, revision: 0, recordedAt: null, recordedBy: null },
] };

const deferred = () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  return { held, release };
};
const conflict = (reason: string) => ({ status: 409, json: { error: "Social Crew changed before this request.",
  code: "SOCIAL_CREW_CONFLICT", retryable: false, details: { reason } } });
const focusWindow = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));
const resumePage = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
const beaHere = { ...hostRead, items: [hostRead.items[0],
  { memberId: BEA, state: "attended", revision: 1, recordedAt: "2026-11-17T21:00:00.000Z", recordedBy: "host" }] };

/** Every attendance phrase the page ever rendered, so a flash that came and went is still caught. */
async function recordPhrases(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { attendanceSeen: string[] }).attendanceSeen = seen;
    const phrases = ["Checking attendance", "Attendance is unavailable", "Who came"];
    new MutationObserver(() => {
      const text = document.body?.textContent ?? "";
      for (const phrase of phrases) if (text.includes(phrase) && !seen.includes(phrase)) seen.push(phrase);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { attendanceSeen: string[] }).attendanceSeen);
}

async function open(page: Page, role: "owner" | "member", attendance: (route: Route) => Promise<void>,
  crewRead: (route: Route) => Promise<void> = (route) => route.fulfill({ json: crew(role) })) {
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await auth.signedInAs("A");
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.route("**/api/social/access", (route) => route.fulfill({ json: {
    state: "verified", viewerHandle: role === "owner" ? "karan" : "ana_with_a_rather_long_handle", draftScope: "a".repeat(43),
  } }));
  await page.route("**/api/profiles/*/lot", (route) => route.fulfill({ json: { handles: [] } }));
  await page.route(`${api}/join-requests`, (route) => route.fulfill({ json: { items: [], hasMore: false } }));
  await page.route(`${api}/attendance`, attendance);
  await page.route(api, crewRead);
  await page.goto(path);
  return page.getByRole("region", { name: "Who came" });
}

test("a host marks a guest with the revision they saw, and the page says what saved", async ({ page }, info) => {
  const posts: Array<{ body: unknown; key: string | null }> = [];
  const save = deferred();
  const section = await open(page, "owner", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: hostRead });
    posts.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] ?? null });
    await save.held;
    return route.fulfill({ json: { memberId: BEA, state: "attended", revision: 1 } });
  });
  await expect(section.getByText("It’s your word as host, not a check")).toBeVisible();
  const bea = section.getByRole("group", { name: "Attendance for @bea" });
  await expect(section.getByText("Not marked")).toBeVisible();
  await expect(section.getByRole("group", { name: /Attendance for @ana/ }).getByRole("button", { name: "Here", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await section.screenshot({ path: info.outputPath("host-before.png") });
  await bea.getByRole("button", { name: "Here", exact: true }).focus();
  await page.keyboard.press("Enter");
  const pressed = bea.getByRole("button", { name: "Saving…" });
  await expect(pressed).toBeFocused();
  await expect(section.getByRole("button", { name: "Saving…" })).toHaveCount(1);
  await expect(bea.getByRole("button", { name: "Not here", exact: true })).toBeVisible();
  save.release();
  await expect(section.getByRole("status")).toHaveText("@bea marked here.");
  await expect(bea.getByRole("button", { name: "Here", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(bea.getByRole("button", { name: "Here", exact: true })).toBeFocused();
  expect(posts).toEqual([{ body: { memberId: BEA, state: "attended", expectedRevision: 0 }, key: expect.stringMatching(/^crew-attendance-/) }]);
  await section.screenshot({ path: info.outputPath("host-after.png") });
});

test("a mark still saving when the page resumes keeps its button, and the list never reads ahead of it", async ({ page }, info) => {
  const save = deferred();
  let committed = false;
  let crewReads = 0;
  const section = await open(page, "owner", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: committed ? beaHere : hostRead });
    await save.held;
    committed = true;
    return route.fulfill({ json: { memberId: BEA, state: "attended", revision: 1 } });
  }, (route) => { crewReads += 1; return route.fulfill({ json: crew("owner", true) }); });
  const bea = section.getByRole("group", { name: "Attendance for @bea" });
  await expect(page.getByRole("button", { name: /I.m here/ })).toBeVisible();
  await bea.getByRole("button", { name: "Here", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(bea.getByRole("button", { name: "Saving…" })).toBeFocused();
  const before = crewReads;
  await resumePage(page);
  await expect.poll(() => crewReads).toBe(before + 1);
  await expect(page.getByRole("heading", { name: "Thursday table" })).toBeVisible();
  await expect(bea.getByRole("button", { name: "Saving…" })).toBeFocused();
  await section.screenshot({ path: info.outputPath("host-resume-saving.png") });
  save.release();
  await expect(section.getByRole("status")).toHaveText("@bea marked here.");
  await expect(bea.getByRole("button", { name: "Here", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(bea.getByRole("button", { name: "Here", exact: true })).toBeFocused();
  await expect(section.getByText("Not marked")).toHaveCount(0);
  await section.screenshot({ path: info.outputPath("host-resume-saved.png") });
});

test("a list read again while a mark is saving waits for it, even after the crew page failed and recovered", async ({ page }) => {
  const save = deferred();
  let committed = false;
  let failCrew = false;
  const section = await open(page, "owner", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: committed ? beaHere : hostRead });
    await save.held;
    committed = true;
    return route.fulfill({ json: { memberId: BEA, state: "attended", revision: 1 } });
  }, (route) => {
    if (!failCrew) return route.fulfill({ json: crew("owner", true) });
    failCrew = false;
    return route.fulfill({ status: 503, json: { error: "down" } });
  });
  const bea = section.getByRole("group", { name: "Attendance for @bea" });
  await bea.getByRole("button", { name: "Here", exact: true }).click();
  await expect(bea.getByRole("button", { name: "Saving…" })).toBeVisible();
  failCrew = true;
  await focusWindow(page);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(section.getByText("Checking attendance…")).toBeVisible();
  save.release();
  await expect(bea.getByRole("button", { name: "Here", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(section.getByText("Not marked")).toHaveCount(0);
});

test("a host whose revision is stale keeps the list and their place while it reads again", async ({ page }, info) => {
  let reads = 0;
  const second = deferred();
  const section = await open(page, "owner", async (route) => {
    if (route.request().method() === "POST") return route.fulfill(conflict("stale"));
    reads += 1;
    if (reads === 2) await second.held;
    return route.fulfill({ json: reads === 1 ? hostRead : { ...hostRead, items: [hostRead.items[0],
      { memberId: BEA, state: "absent", revision: 1, recordedAt: "2026-11-17T21:00:00.000Z", recordedBy: "host" }] } });
  });
  const here = section.getByRole("group", { name: "Attendance for @bea" }).getByRole("button", { name: "Here", exact: true });
  await here.focus();
  await page.keyboard.press("Enter");
  await expect(section.getByRole("status")).toHaveText("That changed while you were looking. Check the list and mark again.");
  await expect.poll(() => reads).toBe(2);
  await expect(section.getByText("Not marked")).toBeVisible();
  await expect(section.getByText("Checking attendance…")).toHaveCount(0);
  await expect(here).toBeFocused();
  second.release();
  await expect(section.getByText("Marked not here")).toBeVisible();
  await expect(here).toBeFocused();
  await expect(section.getByRole("status")).toHaveText("That changed while you were looking. Check the list and mark again.");
  await section.screenshot({ path: info.outputPath("host-stale-focus.png") });
});

test("a refusal says whether marking has closed or not opened yet", async ({ page }) => {
  const reasons = ["closed", "not_open"];
  const section = await open(page, "owner", async (route) => {
    if (route.request().method() === "POST") return route.fulfill(conflict(reasons.shift() as string));
    return route.fulfill({ json: hostRead });
  });
  const bea = section.getByRole("group", { name: "Attendance for @bea" });
  await bea.getByRole("button", { name: "Here", exact: true }).click();
  await expect(section.getByRole("status")).toHaveText("Marking closed before that saved. A moderator can still correct a mark.");
  await expect(bea.getByRole("button", { name: "Here", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  await bea.getByRole("button", { name: "Not here", exact: true }).click();
  await expect(section.getByRole("status")).toHaveText("Marking has not opened yet. It opens on the day.");
});

test("the list reads again when marking opens, without polling", async ({ page }) => {
  const opensAt = Date.parse("2026-11-17T12:00:00.000Z");
  await page.clock.install({ time: opensAt - 6_000 });
  let reads = 0;
  const section = await open(page, "owner", (route) => {
    reads += 1;
    return route.fulfill({ json: reads === 1 ? { ...hostRead, open: false, opensAt: new Date(opensAt).toISOString() }
      : { ...hostRead, opensAt: new Date(opensAt).toISOString() } });
  });
  await expect(section.getByText("Marking opens on the day.")).toBeVisible();
  await page.clock.runFor(3_000);
  expect(reads).toBe(1);
  await page.clock.runFor(4_000);
  await expect(section.getByText(/^Open until /)).toBeVisible();
  expect(reads).toBe(2);
});

test("a closed night keeps the marks and offers no change", async ({ page }) => {
  const section = await open(page, "owner", (route) => route.fulfill({ json: { ...hostRead, open: false } }));
  await expect(section.getByText("Marking has closed. A moderator can still correct a mark.")).toBeVisible();
  for (const button of await section.getByRole("button").all()) await expect(button).toBeDisabled();
});

test("a failed read is unavailable, never an empty list, and retry recovers", async ({ page }) => {
  let reads = 0;
  const section = await open(page, "owner", (route) => {
    reads += 1;
    return reads === 1 ? route.fulfill({ status: 503, json: { error: "down" } }) : route.fulfill({ json: hostRead });
  });
  await expect(section.getByText("Attendance is unavailable right now.")).toBeVisible();
  await expect(section.getByText("Not marked")).toHaveCount(0);
  await section.getByRole("button", { name: "Try again" }).click();
  await expect(section.getByText("Not marked")).toBeVisible();
});

test("a guest never sees a loading or failed block, and an unmarked guest sees nothing", async ({ page }, info) => {
  const seen = await recordPhrases(page);
  const first = deferred();
  let reads = 0;
  const own = { canAttest: false, ...night, items: [] as unknown[] };
  const section = await open(page, "member", async (route) => {
    reads += 1;
    if (reads === 1) { await first.held; return route.fulfill({ status: 503, json: { error: "down" } }); }
    if (reads === 2) return route.fulfill({ json: own });
    return route.fulfill({ json: { ...own, items: [{ memberId: ANA, state: "absent", revision: 1,
      recordedAt: "2026-11-17T22:00:00.000Z", recordedBy: "host" }] } });
  });
  await expect(page.getByRole("heading", { name: "Thursday table" })).toBeVisible();
  await expect.poll(() => reads).toBe(1);
  first.release();
  // A focus reads again only once the failed read has settled.
  await expect(async () => { await focusWindow(page); expect(reads).toBeGreaterThanOrEqual(2); }).toPass();
  await expect(async () => {
    await focusWindow(page);
    await expect(section.getByText("Your host marked you not here.")).toBeVisible();
  }).toPass();
  expect(await seen()).toEqual(["Who came"]);
  await page.screenshot({ path: info.outputPath("guest-page.png"), fullPage: true });
});

test("a guest reports their own mark from the panel, and the report names its revision", async ({ page }, info) => {
  const reports: unknown[] = [];
  const sent = deferred();
  const section = await open(page, "member", (route) => route.fulfill({ json: { canAttest: false, ...night,
    items: [{ memberId: ANA, state: "attended", revision: 2, recordedAt: "2026-11-17T22:00:00.000Z", recordedBy: "moderator" }] } }));
  await page.route(`${api}/attendance/report`, async (route) => {
    reports.push(route.request().postDataJSON());
    await sent.held;
    return route.fulfill({ status: 202, json: { code: "reported", revision: 2 } });
  });
  await expect(section.getByText("A moderator marked you here.")).toBeVisible();
  await expect(section.getByText("@bea")).toHaveCount(0);
  await expect(section.getByRole("button")).toHaveCount(1);
  await section.screenshot({ path: info.outputPath("guest.png") });
  const report = section.getByRole("button", { name: "Report this mark" });
  await report.focus();
  await page.keyboard.press("Enter");
  await expect(section.getByRole("button", { name: "Sending…" })).toBeFocused();
  sent.release();
  await expect(section.getByRole("status")).toHaveText("Reported. A moderator who wasn’t in this crew checks it.");
  await expect(section.getByRole("button", { name: "Reported" })).toBeFocused();
  await expect(section.getByRole("button", { name: "Reported" })).toHaveAttribute("aria-disabled", "true");
  await section.getByRole("button", { name: "Reported" }).press("Enter");
  expect(reports).toEqual([{ revision: 2 }]);
  await section.screenshot({ path: info.outputPath("guest-reported.png") });
});

test("a guest whose mark changed before the report reads it again and is told", async ({ page }) => {
  let changed = false;
  const section = await open(page, "member", (route) => route.fulfill({ json: { canAttest: false, ...night, items: [{ memberId: ANA,
    state: changed ? "attended" : "absent", revision: changed ? 2 : 1, recordedAt: "2026-11-17T22:00:00.000Z", recordedBy: "host" }] } }));
  await page.route(`${api}/attendance/report`, (route) => {
    changed = true;
    return route.fulfill(conflict("stale"));
  });
  await expect(section.getByText("Your host marked you not here.")).toBeVisible();
  await section.getByRole("button", { name: "Report this mark" }).click();
  await expect(section.getByText("Your host marked you here.")).toBeVisible();
  await expect(section.getByRole("status")).toHaveText("Your mark changed. Check it, then report it if it’s wrong.");
  await expect(section.getByRole("button", { name: "Report this mark" })).toBeVisible();
});
