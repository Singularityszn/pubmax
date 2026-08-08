import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const pageTsx = readFileSync(join(process.cwd(), "app/we-are-out/page.tsx"), "utf8");
const clientTsx = readFileSync(
  join(process.cwd(), "app/we-are-out/WeAreOutClient.tsx"),
  "utf8",
);

/** Visible copy only — comments explain the rule and must not trip it. */
function clientCopy(): string {
  return clientTsx
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
}

describe("we-are-out Social honesty (crew tonight slice 4)", () => {
  it("reads the Social invite beta flag only on the RSC and threads it", () => {
    expect(pageTsx).toMatch(/isSocialInviteBetaEnabled/);
    expect(pageTsx).toMatch(/from "@\/lib\/socialAccess"/);
    expect(pageTsx).toMatch(/SOCIAL_INVITE_BETA_ENABLED/);
    expect(pageTsx).toMatch(
      /socialInviteBetaEnabled=\{socialInviteBetaEnabled\}/,
    );
    expect(clientTsx).not.toMatch(/process\.env/);
    expect(clientTsx).not.toMatch(/SOCIAL_INVITE_BETA_ENABLED/);
  });

  it("defaults the done-state CTA away from Open Social when beta is off", () => {
    expect(clientTsx).toMatch(/socialInviteBetaEnabled\s*=\s*false/);
    const doneBlock = clientTsx.match(
      /weAreOutDone[\s\S]*?<\/section>/,
    )?.[0];
    expect(doneBlock, "done-state block present").toBeTruthy();
    expect(doneBlock).toMatch(
      /socialInviteBetaEnabled\s*\?\s*\([\s\S]*Open Social[\s\S]*:\s*\([\s\S]*Open Memories/,
    );
    expect(doneBlock).toMatch(/href="\/u\/you#night-memories"/);
    expect(doneBlock).toMatch(/href="\/social"/);
  });

  it("keeps only the beta-on branch saying Open Social in visible copy", () => {
    const copy = clientCopy();
    const openSocialMatches = copy.match(/Open Social/g) ?? [];
    expect(openSocialMatches).toHaveLength(1);
    expect(copy).toContain("Open Memories");
  });
});
