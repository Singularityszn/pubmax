import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// L19 — Landing Find my pint hierarchy (flag-gated).
// Source + CSS locks: flag-off path keeps the shipped three-button hero;
// flag-on demotes Map/Plan to text; Pint Drop 8s fail-soft is untouched.

const landingTsx = readFileSync(
  join(process.cwd(), "components/landing/LandingPage.tsx"),
  "utf8",
);
const landingCss = readFileSync(
  join(process.cwd(), "components/landing/landing.css"),
  "utf8",
);
const pageTsx = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
const pintDropStrip = readFileSync(
  join(process.cwd(), "components/landing/PintDropStrip.tsx"),
  "utf8",
);

describe("L19 landing Find my pint hierarchy", () => {
  it("reads the flag only on the landing RSC and threads it as a prop", () => {
    expect(pageTsx).toMatch(/readTrustedHandoffFlags/);
    expect(pageTsx).toMatch(/trustedHandoffFlags\.server/);
    expect(pageTsx).toMatch(/landingFindMyPint=\{landingFindMyPint\}/);
    // Client must not interpret the env itself.
    expect(landingTsx).not.toMatch(/process\.env/);
    expect(landingTsx).not.toMatch(/PUBMAX_LANDING_FIND_MY_PINT/);
  });

  it("flag-off snapshot: three equal-slot hero buttons, Find my pint primary", () => {
    // Quiet-button branch still present for Map + Plan.
    expect(landingTsx).toMatch(/lpButtonQuiet[\s\S]*Open the map/);
    expect(landingTsx).toMatch(/lpButtonQuiet[\s\S]*Plan my night/);
    // Primary is always Find my pint → /near.
    expect(landingTsx).toMatch(
      /className="lpButton lpButtonPrimary" href="\/near"[\s\S]*Find my pint/,
    );
    // Final CTA still opens the map when the flag is off.
    expect(landingTsx).toMatch(
      /primaryCtaHref[\s\S]*lpButtonPrimary[\s\S]*Open the map/,
    );
  });

  it("flag-on: one primary action; Map and Plan stay visible as lower-weight text", () => {
    expect(landingTsx).toMatch(/lpHeroActions--findMyPint/);
    expect(landingTsx).toMatch(/lpHeroSecondaryRow/);
    expect(landingTsx).toMatch(/lp--findMyPint/);
    // Secondary row uses text links, not quiet buttons.
    const secondaryBlock = landingTsx.match(
      /lpHeroActions--findMyPint[\s\S]*?lpHeroSecondaryRow[\s\S]*?<\/div>\s*<\/div>/,
    )?.[0];
    expect(secondaryBlock, "flag-on secondary branch present").toBeTruthy();
    expect(secondaryBlock).toMatch(/lpTextLink/);
    expect(secondaryBlock).toMatch(/Open the map/);
    expect(secondaryBlock).toMatch(/Plan my night/);
    expect(secondaryBlock).not.toMatch(/lpButtonQuiet/);
    // Map + Plan never hidden.
    expect(landingTsx).toMatch(/href=\{primaryCtaHref\}[\s\S]*Open the map/);
    expect(landingTsx).toMatch(/href="\/plan"[\s\S]*Plan my night/);
  });

  it("CSS scopes dominant primary and high-contrast secondary text", () => {
    expect(landingCss).toMatch(/\.lpHeroActions--findMyPint\s*\{/);
    expect(landingCss).toMatch(/\.lpHeroSecondaryRow\s*\{/);
    expect(landingCss).toMatch(
      /\.lpHeroSecondaryRow \.lpTextLink\s*\{[\s\S]*?color:\s*var\(--ink\)/,
    );
    expect(landingCss).toMatch(
      /\.lpButtonPrimary\s*\{[\s\S]*?color:\s*var\(--color-on-accent\)/,
    );
    // Mobile: no equal-weight Map/Plan button pair under the flag-on stack.
    expect(landingCss).toMatch(
      /\.lpHeroActions--findMyPint\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
  });

  it("preserves Pint Drop eight-second fail-soft hang path (do not rework)", () => {
    expect(pintDropStrip).toMatch(/8_000|8000/);
    expect(pintDropStrip).toMatch(/hangTimer/);
    expect(pintDropStrip).toMatch(/current === "loading" \? "empty"/);
    expect(pintDropStrip).toMatch(/status === "hidden" \|\| status === "empty"/);
  });
});
