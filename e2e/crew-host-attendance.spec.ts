import { expect, test, type Page, type Route } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// Oracle: design v5, host attendance. A host or co-host marks accepted guests Here
// or Not here with the revision they saw. A guest sees only their own mark. A
// failed read says it is unavailable, never an empty list. API doubles stand in
// for the protected crew and attendance routes only.

const CREW = "50000000-0000-4000-8000-000000000071";
const HOST = "30000000-0000-4000-8000-000000000071";
const ANA = "30000000-0000-4000-8000-000000000072";
const BEA = "30000000-0000-4000-8000-000000000073";
const path = `/social/crews/${CREW}`;
const api = `**/api/social/crews/${CREW}`;

function crew(role: "owner" | "member") {
  const viewer = role === "owner" ? HOST : ANA;
  return {
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

async function open(page: Page, role: "owner" | "member", attendance: (route: Route) => Promise<void>) {
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
  await page.route(api, (route) => route.fulfill({ json: crew(role) }));
  await page.goto(path);
  return page.getByRole("region", { name: "Who came" });
}

test("a host marks a guest with the revision they saw, and the page says what saved", async ({ page }, info) => {
  const posts: Array<{ body: unknown; key: string | null }> = [];
  const section = await open(page, "owner", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: hostRead });
    posts.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] ?? null });
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
  await expect(section.getByRole("status")).toHaveText("@bea marked here.");
  await expect(bea.getByRole("button", { name: "Here", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(posts).toEqual([{ body: { memberId: BEA, state: "attended", expectedRevision: 0 }, key: expect.stringMatching(/^crew-attendance-/) }]);
  await section.screenshot({ path: info.outputPath("host-after.png") });
});

test("a host whose revision is stale reads again and is told to check", async ({ page }) => {
  let reads = 0;
  const section = await open(page, "owner", async (route) => {
    if (route.request().method() === "POST") return route.fulfill({ status: 409, json: { error: "changed", code: "SOCIAL_CREW_CONFLICT" } });
    reads += 1;
    return route.fulfill({ json: reads === 1 ? hostRead : { ...hostRead, items: [hostRead.items[0],
      { memberId: BEA, state: "absent", revision: 1, recordedAt: "2026-11-17T21:00:00.000Z", recordedBy: "host" }] } });
  });
  await section.getByRole("group", { name: "Attendance for @bea" }).getByRole("button", { name: "Here", exact: true }).click();
  await expect(section.getByRole("status")).toHaveText("That changed while you were looking. Check the list and mark again.");
  await expect(section.getByText("Marked not here")).toBeVisible();
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

test("a guest sees only their own mark and no controls", async ({ page }, info) => {
  const section = await open(page, "member", (route) => route.fulfill({ json: { canAttest: false, ...night,
    items: [{ memberId: ANA, state: "attended", revision: 2, recordedAt: "2026-11-17T22:00:00.000Z", recordedBy: "moderator" }] } }));
  await expect(section.getByText("A moderator marked you here.")).toBeVisible();
  await expect(section.getByRole("button")).toHaveCount(0);
  await expect(section.getByText("@bea")).toHaveCount(0);
  await section.screenshot({ path: info.outputPath("guest.png") });
});
