import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// U2 — Landing Memory honesty while friends-launch is off.
// Soft launch keeps PUBMAX_SOCIAL_FRIENDS_LAUNCH unset/off. The Memory beat
// must not promise "Open Social" as if the product is open; primary path
// stays Plan, and the secondary CTA goes to private Memories on You.

const landingTsx = readFileSync(
  join(process.cwd(), "components/landing/LandingPage.tsx"),
  "utf8",
);
const pageTsx = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");

/** Visible copy only - comments explain the rule and must not trip it. */
function landingCopy(): string {
  return landingTsx
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
}

describe("landing Memory social honesty (U2)", () => {
  it("reads the friends-launch flag only on the landing RSC and threads it", () => {
    expect(pageTsx).toMatch(/readTrustedHandoffFlag/);
    expect(pageTsx).toMatch(/socialFriendsLaunch/);
    expect(pageTsx).toMatch(
      /socialFriendsLaunchEnabled=\{socialFriendsLaunchEnabled\}/,
    );
    // Client must not interpret the env itself (same fence as Find my pint).
    expect(landingTsx).not.toMatch(/process\.env/);
    expect(landingTsx).not.toMatch(/PUBMAX_SOCIAL_FRIENDS_LAUNCH/);
  });

  it("defaults the Memory secondary CTA away from Open Social when launch is off", () => {
    expect(landingTsx).toMatch(/socialFriendsLaunchEnabled\s*=\s*false/);
    const memoryBlock = landingTsx.match(
      /lpMemoryActions[\s\S]*?<\/div>\s*<\/div>\s*<ol className="lpMemorySteps"/,
    )?.[0];
    expect(memoryBlock, "Memory actions block present").toBeTruthy();
    expect(memoryBlock).toMatch(
      /href="\/plan"[\s\S]*lpButtonPrimary[\s\S]*Start a plan/,
    );
    expect(memoryBlock).toMatch(
      /socialFriendsLaunchEnabled\s*\?\s*\([\s\S]*Open Social[\s\S]*:\s*\([\s\S]*Open Memories/,
    );
    expect(memoryBlock).toMatch(/href="\/u\/you#night-memories"/);
    expect(memoryBlock).toMatch(/href="\/social"/);
  });

  it("keeps nav and footer Social as a preview destination without Open Social", () => {
    const copy = landingCopy();
    // Nav + footer may still link to /social (preview page). They must not
    // use the open-product CTA wording reserved for the launch-on Memory path.
    expect(copy).toMatch(/href="\/social">Social</);
    const openSocialMatches = copy.match(/Open Social/g) ?? [];
    // Only the gated launch-on branch may say Open Social.
    expect(openSocialMatches).toHaveLength(1);
    expect(copy).toContain("Open Memories");
  });
});
