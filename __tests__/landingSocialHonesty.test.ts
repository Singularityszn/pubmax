import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// U2 — Landing Memory honesty while Social invite beta is off.
// Soft launch keeps SOCIAL_INVITE_BETA_ENABLED unset/off. The Memory beat
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
  it("reads the Social invite beta flag only on the landing RSC and threads it", () => {
    expect(pageTsx).toMatch(/isSocialInviteBetaEnabled/);
    expect(pageTsx).toMatch(/from "@\/lib\/socialAccess"/);
    expect(pageTsx).toMatch(/SOCIAL_INVITE_BETA_ENABLED/);
    expect(pageTsx).toMatch(
      /socialInviteBetaEnabled=\{socialInviteBetaEnabled\}/,
    );
    // Client must not interpret the env itself (same fence as Find my pint).
    expect(landingTsx).not.toMatch(/process\.env/);
    expect(landingTsx).not.toMatch(/SOCIAL_INVITE_BETA_ENABLED/);
  });

  it("defaults the Memory secondary CTA away from Open Social when beta is off", () => {
    expect(landingTsx).toMatch(/socialInviteBetaEnabled\s*=\s*false/);
    const memoryBlock = landingTsx.match(
      /lpMemoryActions[\s\S]*?<\/div>\s*<\/div>\s*<ol className="lpMemorySteps"/,
    )?.[0];
    expect(memoryBlock, "Memory actions block present").toBeTruthy();
    expect(memoryBlock).toMatch(
      /href="\/plan"[\s\S]*lpButtonPrimary[\s\S]*Start a plan/,
    );
    expect(memoryBlock).toMatch(
      /socialInviteBetaEnabled\s*\?\s*\([\s\S]*Open Social[\s\S]*:\s*\([\s\S]*Open Memories/,
    );
    expect(memoryBlock).toMatch(/href="\/u\/you#night-memories"/);
    expect(memoryBlock).toMatch(/href="\/social"/);
  });

  it("keeps nav and footer Social as a preview destination without Open Social", () => {
    const copy = landingCopy();
    // Nav + footer may still link to /social (preview page). They must not
    // use the open-product CTA wording reserved for the beta-on Memory path.
    expect(copy).toMatch(/href="\/social">Social</);
    const openSocialMatches = copy.match(/Open Social/g) ?? [];
    // Only the gated beta-on branch may say Open Social.
    expect(openSocialMatches).toHaveLength(1);
    expect(copy).toContain("Open Memories");
  });
});
