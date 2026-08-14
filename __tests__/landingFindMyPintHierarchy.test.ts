import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// One primary action is permanent; Map and Plan stay visible as text links.

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

describe("landing Find my pint hierarchy", () => {
  it("keeps the hierarchy permanent without a landing flag", () => {
    expect(pageTsx).not.toMatch(/readTrustedHandoffFlags/);
    expect(pageTsx).not.toMatch(/landingFindMyPint/);
    expect(landingTsx).not.toMatch(/landingFindMyPint/);
  });

  it("uses Find my pint as the only primary action", () => {
    expect(landingTsx).toMatch(
      /className="lpButton lpButtonPrimary"[\s\S]*?href="\/near\?locate=1"[\s\S]*?Find my pint/,
    );
    expect(landingTsx).not.toMatch(/lpHeroActions--mapFirst/);
    expect(landingTsx).not.toMatch(/lpHeroActions--findMyPint/);
  });

  it("keeps Map and Plan visible as lower-weight text links", () => {
    expect(landingTsx).toMatch(/className="lpHeroActions"/);
    expect(landingTsx).toMatch(/lpHeroSecondaryRow/);
    const secondaryBlock = landingTsx.match(
      /className="lpHeroActions"[\s\S]*?lpHeroSecondaryRow[\s\S]*?<\/div>\s*<\/div>/,
    )?.[0];
    expect(secondaryBlock, "secondary action row present").toBeTruthy();
    expect(secondaryBlock).toMatch(/lpTextLink/);
    expect(secondaryBlock).toMatch(/Open the map/);
    expect(secondaryBlock).toMatch(/Plan with friends/);
    expect(secondaryBlock).not.toMatch(/lpButtonQuiet/);
    expect(landingTsx).toMatch(/href=\{primaryCtaHref\}[\s\S]*Open the map/);
    expect(landingTsx).toMatch(/href="\/plan"[\s\S]*Plan with friends/);
  });

  it("CSS scopes dominant primary and high-contrast secondary text", () => {
    expect(landingCss).toMatch(/\.lpHeroActions\s*\{/);
    expect(landingCss).toMatch(/\.lpHeroSecondaryRow\s*\{/);
    expect(landingCss).toMatch(
      /\.lpHeroSecondaryRow \.lpTextLink\s*\{[\s\S]*?color:\s*var\(--ink\)/,
    );
    expect(landingCss).toMatch(
      /\.lpButtonPrimary\s*\{[\s\S]*?color:\s*var\(--color-on-accent\)/,
    );
    // Mobile: no equal-weight Map/Plan button pair.
    expect(landingCss).toMatch(
      /\.lpHeroActions\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
  });

  it("preserves Pint Drop eight-second fail-soft hang path (do not rework)", () => {
    expect(pintDropStrip).toMatch(/8_000|8000/);
    expect(pintDropStrip).toMatch(/hangTimer/);
    expect(pintDropStrip).toMatch(/current === "loading" \? "empty"/);
    expect(pintDropStrip).toMatch(/status === "hidden" \|\| status === "empty"/);
  });
});
