"use client";

import { Button } from "@/components/ui/button";
import {
  themeSwitchLabel,
  toggleThemeChoice,
  useThemeChoice,
} from "@/lib/useThemeChoice";

// This device setting is available with or without an account.
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
