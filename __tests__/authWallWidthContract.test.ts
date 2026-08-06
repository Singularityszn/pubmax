import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("app-wide auth-wall width contract (post-766)", () => {
  const authCss = read("app/auth/auth.css");

  it("caps standalone .authOptions at 26rem and fills the host", () => {
    expect(authCss).toMatch(/\.authOptions\s*\{[\s\S]*?max-width:\s*26rem/);
    expect(authCss).toMatch(
      /\.authUser:not\(\.authUserNav\)\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*100%[\s\S]*?min-width:\s*0/,
    );
  });

  it("keeps host :has wrappers shrink-safe for padded cards", () => {
    expect(authCss).toMatch(
      /:where\(:has\(>\s*\.authUser:not\(\.authUserNav\)\)\)\s*\{[\s\S]*?min-width:\s*0/,
    );
  });
});

describe("messages thread eyebrow uses type token", () => {
  it("reads --text-2xs instead of a raw rem size", () => {
    const css = read("app/messages/messages.css");
    const rule = /\.messagesThreadEyebrow\s*\{([\s\S]*?)\}/.exec(css);
    expect(rule, ".messagesThreadEyebrow missing").not.toBeNull();
    expect(rule![1]).toMatch(/font-size:\s*var\(--text-2xs/);
    expect(rule![1]).not.toMatch(/font-size:\s*0\.\d+rem/);
  });
});
