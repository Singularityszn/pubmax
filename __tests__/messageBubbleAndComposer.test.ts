// The thread a person actually types into, fenced at the two places it broke.
//
// 1. THE COLLAPSED BUBBLE. The first live DM on production rendered an outgoing
//    "Yo!!" as one character per line at 390px. The cause was one declaration:
//    `max-width: 78%` sat on `.messageBubble`, whose containing block was a
//    shrink-to-fit wrapper the bubble had just sized itself. So the percentage
//    resolved against the bubble's OWN natural width, every bubble was clamped
//    to 78% of itself, and `overflow-wrap: anywhere` broke mid-word to obey.
//    Measured in Chrome at 390: the bubble was 42px wide over three lines.
//
//    The limit belongs on `.messageLine`, which has the row's real width to
//    measure against, and `width: fit-content` is what keeps a short message
//    natural: `fit-content` floors on the AVAILABLE width, where a flex item's
//    automatic minimum floors on min-content - one character, under `anywhere`.
//    There is no layout engine in this suite, so the arithmetic is fenced on the
//    SHIPPED CSS and the markup that carries it; `e2e/messages-mobile.spec.ts`
//    measures the rendered boxes at 390px and 1280px.
//
// 2. THE COMPOSER. A message is somebody talking, so the field helps them the
//    way every other field on their phone does: sentence case, autocorrect on,
//    spelling checked. `autocorrect="off"` anywhere on this surface is the
//    defect, and the sweep below is tree-wide over components/messages.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MAX_MESSAGE_BODY } from "@/lib/messages";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const CSS = read("app/messages/messages.css");
const THREAD = read("components/messages/MessageThread.tsx");

/** One rule body out of the shipped stylesheet, by selector. */
function rule(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, `${selector} is missing from app/messages/messages.css`).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf("}", at));
}

describe("a bubble's width is the row's business, never the bubble's own", () => {
  it("puts the width limit on the line, with the row to measure against", () => {
    const line = rule(".messageLine");
    expect(line).toMatch(/max-width:\s*75%/);
    // Without this the line is a flex item whose automatic minimum size is
    // min-content, which `overflow-wrap: anywhere` makes one character wide.
    expect(line).toMatch(/width:\s*fit-content/);
    expect(line).toMatch(/min-width:\s*0/);
  });

  it("leaves the bubble no percentage width of its own", () => {
    const bubble = rule(".messageBubble");
    // THE DEFECT, exactly: a FRACTIONAL percentage max-width, resolved against
    // a parent the bubble had just sized. Filling its own line is the only
    // percentage a bubble may name.
    const percentages = [...bubble.matchAll(/max-width:\s*(\d+(?:\.\d+)?)%/g)].map((hit) =>
      Number(hit[1]),
    );
    expect(percentages).toEqual([100]);
  });

  it("still breaks a pasted link rather than pushing the page sideways", () => {
    expect(rule(".messageBubble")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("wraps every bubble in the line that carries the limit", () => {
    expect(THREAD).toContain('<div className="messageLine">');
    // One line per row, and the bubble is inside it.
    const line = THREAD.indexOf('<div className="messageLine">');
    const bubble = THREAD.indexOf("messageBubble messageBubbleMine");
    expect(bubble).toBeGreaterThan(line);
  });

  it("keeps an own message's meta under the bubble it belongs to", () => {
    // An outgoing message's meta is usually empty, which is why the collapse
    // showed up on that side first: nothing else held the line open.
    expect(rule(".messageRowMine .messageMeta")).toMatch(/justify-content:\s*flex-end/);
  });
});

describe("the composer is a field somebody can talk into", () => {
  it("leaves the phone keyboard's help switched ON", () => {
    expect(THREAD).toContain('autoCapitalize="sentences"');
    expect(THREAD).toContain('autoCorrect="on"');
    expect(THREAD).toContain("spellCheck");
  });

  it("never turns autocorrect, autocapitalise or spellcheck off anywhere here", () => {
    for (const file of [
      "components/messages/MessageThread.tsx",
      "components/messages/MessageVenuePicker.tsx",
      "components/messages/MessagePhoto.tsx",
      "components/messages/MessageVenueCard.tsx",
      "components/messages/ProfileMessageButton.tsx",
      "app/messages/MessagesInboxClient.tsx",
    ]) {
      const source = read(file);
      expect(source, `${file} turns autocorrect off`).not.toMatch(/autoCorrect=["{]?["']?off/i);
      expect(source, `${file} turns autocapitalise off`).not.toMatch(
        /autoCapitalize=["{]?["']?(off|none)/i,
      );
      expect(source, `${file} turns spellcheck off`).not.toMatch(/spellCheck=\{false\}/);
    }
  });

  it("grows with what is typed and stops where the CSS says", () => {
    expect(THREAD).toContain("rows={1}");
    // Measured off scrollHeight, because a row count cannot know how a line
    // wrapped.
    expect(THREAD).toContain("field.style.height = `${field.scrollHeight}px`");
    const input = rule(".composerInput");
    expect(input).toMatch(/resize:\s*none/);
    expect(input).toMatch(/max-height:\s*9rem/);
    expect(input).toMatch(/min-height:\s*44px/);
  });

  it("sends on Enter only where there is a modifier to spare", () => {
    expect(THREAD).toContain('window.matchMedia("(pointer: fine)")');
    // Shift+Enter is a new line on every device.
    expect(THREAD).toMatch(/if \(e\.key !== "Enter" \|\| e\.shiftKey\) return;/);
    expect(THREAD).toContain("if (!enterSends) return;");
    expect(THREAD).toContain('enterKeyHint={enterSends ? "send" : "enter"}');
  });

  it("refuses to send nothing, and counts what a person may actually send", () => {
    expect(THREAD).toContain("disabled={!canSend}");
    // A photo is a message: something to send is text, an attachment, or both.
    expect(THREAD).toContain(
      "const hasSomething = draft.trim().length > 0 || pending !== null;",
    );
    expect(THREAD).toContain("const canSend = hasSomething && !over && !sending;");
  });

  it("keeps the counter honest about the cap it is counting to", () => {
    // The field admits a little more than the cap so the over-count can be SEEN
    // and refused, rather than the browser silently swallowing the keystroke
    // that went past it.
    expect(THREAD).toContain("{draft.length}/{MAX_MESSAGE_BODY}");
    expect(THREAD).toContain("maxLength={MAX_MESSAGE_BODY + 100}");
    expect(THREAD).toContain("const over = draft.length > MAX_MESSAGE_BODY;");
    expect(MAX_MESSAGE_BODY).toBe(1000);
  });

  it("gives every control a 44px box", () => {
    for (const selector of [
      ".composerSend",
      ".composerAttach",
      ".composerPendingRemove",
      ".composerVenueSearch",
      ".composerVenueResult",
      ".messagePhotoViewerClose",
    ]) {
      expect(rule(selector), selector).toMatch(/min-height:\s*44px/);
    }
    for (const selector of [".composerSend", ".composerAttach", ".messagePhotoViewerClose"]) {
      expect(rule(selector), selector).toMatch(/min-width:\s*44px/);
    }
  });
});
