import { expect, test, type Page } from "@playwright/test";

import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// THE INBOX SAYS WHAT IT COULD NOT DO (adversarial review F-9 / F-10).
//
// The batched inbox reads threw all the way out of `listConversations`, so one
// statement timeout on the unread scan turned every conversation a person had
// into an empty inbox served with a 200, which the page drew as the empty
// state. A truncated scan was quieter still: the conversations it never reached
// printed a confident `unread: 0`.
//
// The read now carries its own `status`. This spec measures what a reader SEES
// in each of the three answers the surface must tell apart, on the shipped
// markup and stylesheet:
//
//   BEFORE  a degraded read with rows and NO status field - what main sent, and
//           what main's page drew: a plain list, no notice, unread badges over
//           counts nobody ran.
//   AFTER   the same rows with `status: "degraded"` - the list, and one line
//           saying the check did not run, with a way to try again.
//   EMPTY   a degraded read with NO rows - never the "Nobody in here yet"
//           empty state, because nothing answered.
//
// A keyless server cannot verify a bearer, so the inbox API is answered in the
// browser and the auth doubles sign the page in, the way every other messaging
// spec here does.

const WIDTHS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;

const ME = ACCOUNTS.A.handle;

type Conversation = {
  id: string;
  otherHandle: string;
  lastBody?: string;
  lastAt: string;
  lastFromMe: boolean;
  unread?: number;
};

function conversations(withCounts: boolean): Conversation[] {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return [
    {
      id: "c1",
      otherHandle: "karansznx",
      lastBody: "Sound, see you at the Lamb at 7",
      lastAt: at(3),
      lastFromMe: false,
      ...(withCounts ? { unread: 2 } : {}),
    },
    {
      id: "c2",
      otherHandle: "tom_the_lamb",
      lastBody: "£5.60 confirmed Tuesday, still good",
      lastAt: at(190),
      lastFromMe: true,
      ...(withCounts ? { unread: 0 } : {}),
    },
    {
      id: "c3",
      otherHandle: "maisie",
      lastBody: "Bring cash, card machine is dodgy",
      lastAt: at(60 * 26),
      lastFromMe: false,
      ...(withCounts ? { unread: 0 } : {}),
    },
  ];
}

async function installInbox(
  page: Page,
  body: { conversations: Conversation[]; status?: string },
): Promise<void> {
  const stub = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await stub.signedInAs("A");
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.addInitScript((handle) => {
    window.localStorage.setItem("pubmax_handle", handle);
  }, ME);
  await page.route("**/api/messages?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }),
  );
  await page.route("**/api/notifications**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [], unread: 0 }) }),
  );
}

const NOTICE = ".inboxStaleNotice";
const DEGRADED_LINE = "Couldn’t check for new messages. Your conversations are here.";

for (const size of WIDTHS) {
  test.describe(`inbox degraded read at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("BEFORE: rows with no status draw no notice at all", async ({ page }) => {
      // Exactly what main's route sent: the rows, and nothing about the read.
      await installInbox(page, { conversations: conversations(true) });
      await page.goto("/messages");
      await expect(page.locator(".conversationList li").first()).toBeVisible();

      await expect(page.locator(NOTICE)).toHaveCount(0);
      await page.screenshot({
        path: `docs/proof/dm-privacy/inbox-degraded-before-${size.name}.png`,
        fullPage: false,
      });
    });

    test("AFTER: the rows stay and one line says the check did not run", async ({ page }) => {
      await installInbox(page, { conversations: conversations(false), status: "degraded" });
      await page.goto("/messages");
      await expect(page.locator(".conversationList li").first()).toBeVisible();

      const notice = page.locator(NOTICE);
      await expect(notice).toHaveCount(1);
      await expect(notice).toContainText(DEGRADED_LINE);
      await expect(notice.getByRole("button", { name: "Try again" })).toBeVisible();
      // UNCOUNTED IS NOT ZERO: no unread badge is drawn over a count nobody ran.
      await expect(page.locator(".conversationUnread")).toHaveCount(0);

      await page.screenshot({
        path: `docs/proof/dm-privacy/inbox-degraded-after-${size.name}.png`,
        fullPage: false,
      });
    });

    test("a degraded read with NO rows is never the empty state", async ({ page }) => {
      await installInbox(page, { conversations: [], status: "degraded" });
      await page.goto("/messages");

      await expect(page.getByText("Couldn’t load your conversations.")).toBeVisible();
      await expect(page.getByText("Nobody in here yet.")).toHaveCount(0);

      await page.screenshot({
        path: `docs/proof/dm-privacy/inbox-degraded-empty-${size.name}.png`,
        fullPage: false,
      });
    });

    test("a ready read still draws the plain list and its unread badge", async ({ page }) => {
      await installInbox(page, { conversations: conversations(true), status: "ready" });
      await page.goto("/messages");
      await expect(page.locator(".conversationList li").first()).toBeVisible();

      await expect(page.locator(NOTICE)).toHaveCount(0);
      await expect(page.locator(".conversationUnread").first()).toHaveText("2");
    });
  });
}
