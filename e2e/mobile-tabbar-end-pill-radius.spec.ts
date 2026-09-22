import { test, expect, type Page, type TestInfo } from "@playwright/test";

const END_TABS = [
  { href: "/tonight", label: "Tonight", edge: "left" },
  { href: "/u/you", label: "You", edge: "right" },
] as const;

type PillGeometry = {
  edgeGap: number;
  outerRadius: number;
  pillRadius: number;
  minGap: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

async function pillGeometry(page: Page, edge: "left" | "right"): Promise<PillGeometry> {
  return page.evaluate((activeEdge) => {
    const row = document.querySelector<HTMLElement>(".mobileTabList");
    const pill = document.querySelector<HTMLElement>(".mobileTabHighlight");
    if (!row || !pill) throw new Error("Phone tab bar highlight is missing");

    const rowRect = row.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const rowStyle = getComputedStyle(row);
    const pillStyle = getComputedStyle(pill);
    const outerRadius = Number.parseFloat(
      activeEdge === "left" ? rowStyle.borderTopLeftRadius : rowStyle.borderTopRightRadius,
    );
    const pillRadius = Number.parseFloat(
      activeEdge === "left" ? pillStyle.borderTopLeftRadius : pillStyle.borderTopRightRadius,
    );

    return {
      edgeGap: activeEdge === "left" ? pillRect.left - rowRect.left : rowRect.right - pillRect.right,
      outerRadius,
      pillRadius,
      // The child's corner must have room to draw inside the parent's curved
      // edge. Less space means the row border/background cuts that corner.
      minGap: outerRadius - pillRadius,
      left: pillRect.left,
      right: pillRect.right,
      top: pillRect.top,
      bottom: pillRect.bottom,
    };
  }, edge);
}

test("phone tab highlight keeps rounded corners at both row ends in light and dark themes", async ({ page }, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const failures: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    await page.goto("/tonight");
    await page.evaluate((nextTheme) => localStorage.setItem("pubmax-theme", nextTheme), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    for (const tab of END_TABS) {
      if (new URL(page.url()).pathname !== tab.href) {
        await page.goto(tab.href);
      }

      const nav = page.getByRole("navigation", { name: "Primary" });
      await expect(nav).toBeVisible();
      const activeTab = nav.getByRole("link", { name: tab.label, exact: true });
      await expect(activeTab).toHaveAttribute("aria-current", "page");

      const geometry = await pillGeometry(page, tab.edge);
      await testInfo.attach(`pill-${theme}-${tab.label.toLowerCase()}`, {
        body: await nav.screenshot({ animations: "disabled" }),
        contentType: "image/png",
      });
      console.log(`${theme} ${tab.label} edge geometry: ${JSON.stringify(geometry)}`);

      if (geometry.edgeGap < geometry.minGap) {
        failures.push(
          `${theme} ${tab.label}: needs ${geometry.minGap}px curved-edge clearance, got ${geometry.edgeGap}px`,
        );
      }
    }
  }

  expect(failures, failures.join("\n")).toEqual([]);
});
