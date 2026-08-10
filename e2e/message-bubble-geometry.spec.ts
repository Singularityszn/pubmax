import { expect, test, type Page } from "@playwright/test";

// The bubble the first live DM on production drew wrong.
//
// An outgoing "Yo!!" rendered one character per line at 390px, because
// `max-width: 78%` sat on `.messageBubble`, whose containing block was a
// shrink-to-fit wrapper the bubble had just sized itself. Measured in Chrome
// before the fix: 42px wide, three lines, for four characters.
//
// The unit fence (`__tests__/messageBubbleAndComposer.test.ts`) pins the shipped
// CSS; only a browser can prove the arithmetic. The thread itself needs two
// signed-in accounts, so this loads the real `/messages` document - which pulls
// the real stylesheet - and measures the SAME markup the thread renders.

const VIEWPORTS = [
  { name: "phone 390", width: 390, height: 844 },
  { name: "desktop 1280", width: 1280, height: 800 },
] as const;

type Measured = {
  width: number;
  lines: number;
  rowWidth: number;
  right: number;
  rowRight: number;
};

/**
 * The thread's own markup, injected into the loaded document so it is measured
 * under the shipped stylesheet. Kept byte-identical in shape to
 * components/messages/MessageThread.tsx: row, line, bubble, meta.
 */
async function measureBubbles(page: Page): Promise<Record<string, Measured>> {
  return page.evaluate(() => {
    const host = document.querySelector(".messagesMain") ?? document.body;
    const list = document.createElement("ul");
    list.className = "threadMessages";
    list.id = "bubble-probe";
    const rows: Array<[string, string, boolean]> = [
      ["short-mine", "Yo!!", true],
      ["short-theirs", "Yo!!", false],
      [
        // Long enough to pass the 75% limit at 1280 as well as at 390, so the
        // wrap assertion below means the same thing at both widths.
        "long-mine",
        "Meeting you at the Coach and Horses at half seven, and do not be late again please, "
          + "because the last time we waited by the door for twenty five minutes in the rain "
          + "and the good table by the fire had gone to somebody else entirely by then.",
        true,
      ],
      [
        "url-mine",
        "https://pubmaxxing.com/map?sel=the-coach-and-horses-soho-w1&band=cheap&pubs=all",
        true,
      ],
    ];
    for (const [id, body, mine] of rows) {
      const row = document.createElement("li");
      row.id = id;
      row.className = mine ? "messageRow messageRowMine" : "messageRow";
      const line = document.createElement("div");
      line.className = "messageLine";
      const bubble = document.createElement("div");
      bubble.className = mine
        ? "messageBubble messageBubbleMine"
        : "messageBubble messageBubbleTheirs";
      const span = document.createElement("span");
      span.textContent = body;
      bubble.append(span);
      const meta = document.createElement("div");
      meta.className = "messageMeta";
      if (!mine) {
        const report = document.createElement("button");
        report.type = "button";
        report.className = "messageReportBtn";
        report.textContent = "Report";
        meta.append(report);
      }
      line.append(bubble, meta);
      row.append(line);
      list.append(row);
    }
    host.append(list);

    const out: Record<string, Measured> = {};
    for (const [id] of rows) {
      const row = document.getElementById(id) as HTMLElement;
      const bubble = row.querySelector(".messageBubble") as HTMLElement;
      const box = bubble.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      const style = getComputedStyle(bubble);
      const lineHeight = parseFloat(style.lineHeight);
      const chrome =
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth);
      out[id] = {
        width: Math.round(box.width),
        lines: Math.round((box.height - chrome) / lineHeight),
        rowWidth: Math.round(rowBox.width),
        right: Math.round(box.right),
        rowRight: Math.round(rowBox.right),
      };
    }
    return out;
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`message bubbles at ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript(() => {
        window.localStorage.setItem("pubmax-tour-v1-done", "1");
        window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      const response = await page.goto("/messages");
      expect(response?.status()).toBe(200);
      await expect(page.locator(".messagesMain")).toBeVisible();
    });

    test("a short message is one line, and a long one wraps at 75%", async ({ page }) => {
      const measured = await measureBubbles(page);

      // THE DEFECT: "Yo!!" over three lines in a 42px bubble.
      expect(measured["short-mine"].lines).toBe(1);
      expect(measured["short-theirs"].lines).toBe(1);
      // Natural sizing: four characters plus padding, nowhere near the limit.
      expect(measured["short-mine"].width).toBeLessThan(
        Math.round(measured["short-mine"].rowWidth * 0.4),
      );
      expect(measured["short-mine"].width).toBeGreaterThan(40);

      // A long message stops at the line's 75%, and wraps rather than growing.
      const limit = Math.round(measured["long-mine"].rowWidth * 0.75);
      expect(measured["long-mine"].width).toBeLessThanOrEqual(limit + 1);
      expect(measured["long-mine"].width).toBeGreaterThan(limit - 12);
      expect(measured["long-mine"].lines).toBeGreaterThan(1);

      // A pasted link breaks inside the bubble rather than pushing the page.
      expect(measured["url-mine"].width).toBeLessThanOrEqual(limit + 1);
    });

    test("an outgoing bubble sits on the right edge of its row", async ({ page }) => {
      const measured = await measureBubbles(page);
      expect(Math.abs(measured["short-mine"].right - measured["short-mine"].rowRight)).toBeLessThanOrEqual(1);
      expect(measured["short-theirs"].right).toBeLessThan(measured["short-theirs"].rowRight - 10);
    });

    test("the document never scrolls sideways with a link in the thread", async ({ page }) => {
      await measureBubbles(page);
      const overflow = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(overflow.scrollWidth).toBe(overflow.clientWidth);
    });
  });
}
