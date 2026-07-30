import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

const profileClient = read("app/u/[handle]/ProfilePageClient.tsx");
const profileCss = read("app/u/[handle]/profile.css");
const accountHub = read("components/profile/PubmaxxAccountHub.tsx");
const siteNavMore = read("components/nav/SiteNavMore.tsx");

describe("desktop profile options", () => {
  it("reuses the portalled SiteNavMore control at the shared 44px height", () => {
    expect(profileClient).toContain("<SiteNavMore");
    expect(profileClient).toContain('label="Options"');
    expect(profileCss).toMatch(
      /\.profileOwnerUtilities[\s\S]*?min-height:\s*44px/,
    );
  });

  it("offers only working profile actions and honest destinations", () => {
    for (const label of [
      "Edit profile",
      "Analytics choices",
      "About",
      "Privacy",
      "Terms",
      "Sign out",
    ]) {
      expect(profileClient).toContain(`label: "${label}"`);
    }
    for (const href of ["/about", "/privacy", "/terms"]) {
      expect(profileClient).toContain(`href: "${href}"`);
    }
    expect(profileClient).toContain('getElementById("analytics-settings")');
    expect(profileClient).toContain(
      'replaceState(null, "", "#analytics-settings")',
    );
    expect(profileClient).toContain("signOut");
    expect(profileClient).not.toMatch(
      /label:\s*"Help"|href:\s*"\/(?:help|settings)"/,
    );
    expect(accountHub).toContain('id="analytics-settings"');
  });

  it("extends SiteNavMore itself for action items instead of adding another menu", () => {
    expect(siteNavMore).toContain("onSelect");
    expect(siteNavMore).toContain("<button");
    expect(profileClient).not.toMatch(/function ProfileOptionsMenu|<ProfileOptionsMenu/);
  });
});
