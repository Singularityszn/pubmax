import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = (file: string) =>
  readFileSync(join(process.cwd(), file), "utf8");

describe("silent user action feedback fence", () => {
  it("keeps profile message open failures visible and retryable", () => {
    const file = source("components/messages/ProfileMessageButton.tsx");

    expect(file).toContain("errorMessageFrom");
    expect(file).toContain("Could not open messages. Try again.");
    expect(file).toContain("You look offline. Reconnect, then try again.");
    expect(file).toContain('role="status"');
    expect(file).not.toContain("best-effort - a failed open leaves the profile as-is");
  });

  it("keeps representative copy actions honest", () => {
    for (const fileName of [
      "components/crawl/CrawlStoryCopyButton.tsx",
      "components/map/ActiveRoundChip.tsx",
      "components/map/route/RouteHeader.tsx",
    ]) {
      const file = source(fileName);

      expect(file).toContain("Could not copy link. Try again.");
      expect(file).toContain('role="status"');
    }
  });

  it("surfaces failed user reports", () => {
    const thread = source("components/messages/MessageThread.tsx");
    const hook = source("components/map/useCommunityPrices.ts");
    const report = source("components/map/CommunityPriceReport.tsx");

    for (const file of [thread, hook]) {
      expect(file).toContain("errorMessageFrom");
      expect(file).toContain("You look offline. Reconnect, then try again.");
    }
    expect(report).toContain("reportErrors");
    expect(report).toContain('role="status"');
  });

  it("keeps browser actions visible when their platform handoff fails", () => {
    const train = source("components/map/LastTrainCard.tsx");
    const install = source("components/pwa/A2HSInstallPrompt.tsx");
    const photo = source("components/messages/MessagePhoto.tsx");

    expect(train).toContain('caught.name === "AbortError"');
    expect(train).toContain("Couldn&apos;t open the share. Try again.");
    expect(install).toContain("installError");
    expect(install).toContain("Could not start installation. Try again.");
    expect(photo).toContain("Could not open photo. Try again.");
    expect(photo).toContain('role="status"');
  });

  it("does not treat blocked external share windows as successful", () => {
    const shareBar = source("components/share/ShareBar.tsx");
    const recap = source("components/plan/RecapShareButton.tsx");

    for (const file of [shareBar, recap]) {
      expect(file).toContain("Could not open");
      expect(file).toContain("window.open");
    }
  });

  it("does not claim optional clipboard writes succeeded", () => {
    const agent = source("components/plan/TonightAgentPanel.tsx");
    const safeNight = source("components/night/SafeNightStrip.tsx");

    expect(agent).toContain("Could not copy invite draft. Try again.");
    expect(safeNight).toContain("clipboard unavailable");
    expect(safeNight).toContain("You look offline. Reconnect, then try again.");
  });

  it("keeps optimistic preference toggles honest when saving rolls back", () => {
    const pal = source("components/pal/PalExperience.tsx");

    expect(pal).toContain("Pal control update could not be saved.");
    expect(pal).toContain("You look offline. Reconnect, then try again.");
    expect(pal).toContain('setPalAnimationState("error")');
  });
});
