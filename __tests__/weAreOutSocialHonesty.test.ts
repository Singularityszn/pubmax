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
  it("reads the friends-launch flag only on the RSC and threads it", () => {
    expect(pageTsx).toMatch(/readTrustedHandoffFlag/);
    expect(pageTsx).toMatch(/socialFriendsLaunch/);
    expect(pageTsx).toMatch(
      /socialFriendsLaunchEnabled=\{socialFriendsLaunchEnabled\}/,
    );
    expect(clientTsx).not.toMatch(/process\.env/);
    expect(clientTsx).not.toMatch(/PUBMAX_SOCIAL_FRIENDS_LAUNCH/);
  });

  it("defaults the done-state CTA to the live Social surface", () => {
    expect(clientTsx).toMatch(/socialFriendsLaunchEnabled\s*=\s*true/);
    const doneBlock = clientTsx.match(
      /weAreOutDone[\s\S]*?<\/section>/,
    )?.[0];
    expect(doneBlock, "done-state block present").toBeTruthy();
    expect(doneBlock).toMatch(
      /socialFriendsLaunchEnabled\s*\?\s*\([\s\S]*Open Social[\s\S]*:\s*\([\s\S]*Open Memories/,
    );
    expect(doneBlock).toMatch(/href="\/u\/you#night-memories"/);
    expect(doneBlock).toMatch(/href="\/social"/);
  });

  it("keeps only the launch-on branch saying Open Social in visible copy", () => {
    const copy = clientCopy();
    const openSocialMatches = copy.match(/Open Social/g) ?? [];
    expect(openSocialMatches).toHaveLength(1);
    expect(copy).toContain("Open Memories");
  });
});
