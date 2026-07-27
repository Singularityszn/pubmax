import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Messages friction fence. Both message surfaces are behind sign-in, so a
// keyless run can never paint the thread's loading or failure frame — this
// reads their SOURCE instead, the way the map's loading fence does.
//
// Two rules are pinned here:
//   1. The loading line is a dry aside and both panes carry the SAME one; the
//      inbox and thread sit side by side, so a split would read as a jump.
//   2. A thread that will not open is a failure the reader has to act on, so
//      it gets the plain sentence and two exits (docs/VOICE.md: no joke beside
//      an error), and it is a state of its own — never the loading line
//      standing in for a load that already stopped.

const THREAD = "components/messages/MessageThread.tsx";
const INBOX = "app/messages/MessagesInboxClient.tsx";
const LOADING_LINE = "With you in a sec.";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

// The text nodes of the unreachable branch — what a reader actually reads,
// with attributes and the retry handler left out of it.
const failureCopy = (): string => {
  const source = read(THREAD);
  const block = source.slice(
    source.indexOf('state === "unreachable"'),
    source.indexOf('<div className="messageThread">'),
  );
  return (block.match(/>[^<>{}]+</g) ?? [])
    .map((node) => node.slice(1, -1).trim())
    .filter(Boolean)
    .join("\n");
};

describe("messages friction voice", () => {
  it("both panes carry the same loading line", () => {
    expect(read(INBOX)).toContain(LOADING_LINE);
    expect(read(THREAD)).toContain(LOADING_LINE);
  });

  it("an unreachable thread is its own state, not the loading line", () => {
    const source = read(THREAD);
    expect(source).toContain('"loading" | "ready" | "notfound" | "signedout" | "unreachable"');
    // The failure branch returns before the loading line can render.
    const failureAt = source.indexOf('state === "unreachable"');
    const loadingAt = source.indexOf(`>${LOADING_LINE}<`);
    expect(failureAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(failureAt);
  });

  it("the failure frame states the fact and hands over two exits", () => {
    const visible = failureCopy();
    expect(visible).toContain(
      "This conversation won&rsquo;t open right now. Your messages are safe.",
    );
    expect(visible).toContain("Try again");
    expect(visible).toContain("Back to inbox");
    expect(read(THREAD)).toContain('<Link href="/messages">Back to inbox</Link>');
  });

  it("the failure frame leaks no plumbing and cracks no joke", () => {
    const visible = failureCopy();
    for (const leak of ["fetch", "status", "500", "AbortError", "network", "error", "—", "!"]) {
      expect(visible.includes(leak), `"${leak}" leaked into the failure frame`).toBe(false);
    }
  });

  it("both surfaces stay em-dash free in the copy they show", () => {
    for (const file of [THREAD, INBOX]) {
      const literals = read(file).match(/"[^"\n]*"/g) ?? [];
      for (const literal of literals) {
        expect(literal.includes("—"), `em dash in ${file} literal ${literal}`).toBe(false);
      }
    }
  });
});
