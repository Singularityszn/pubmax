import { buttonVariants } from "@/components/ui/button";

// The quiet text action on /today and on the quiet-pint card /tonight shares is
// the Button primitive's ghost. Today.module.css and QuietPintCard.module.css
// only place it; neither may paint it (site audit 13 Sep 2026, D7).
const GHOST = buttonVariants({ variant: "ghost" });

/** Build the text-button class string for a given CSS-module token. */
export function todayTextButtonClass(moduleClass: string): string {
  return `${moduleClass} ${GHOST}`;
}
