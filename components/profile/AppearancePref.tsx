"use client";

import { Button } from "@/components/ui/button";
import {
  themeSwitchLabel,
  toggleThemeChoice,
  useThemeChoice,
} from "@/lib/useThemeChoice";

/**
 * The light/dark choice on the You page. The theme left the primary header in
 * the Oct 2026 UX audit: it is a setting, so it sits with the other settings
 * here (and in the desktop More menu), for signed-in and signed-out readers
 * alike, because it is stored on this device rather than on an account.
 */
export default function AppearancePref(): React.JSX.Element {
  const theme = useThemeChoice();
  return (
    <div id="appearance-settings" data-testid="appearance-pref">
      <h3>Appearance</h3>
      <p className="accountHubConsentStatus">
        {theme === "dark" ? "Dark theme on this device." : "Light theme on this device."}{" "}
        <Button
          variant="secondary"
          type="button"
          className="accountHubConsentChange"
          onClick={toggleThemeChoice}
        >
          {themeSwitchLabel(theme)}
        </Button>
      </p>
    </div>
  );
}
