import { buttonVariants } from "@/components/ui/button";

// The quiet text action on /today and on the quiet-pint card /tonight shares is
// the Button primitive's ghost. today.css and quietPintCard.css only place it;
// neither may paint it (site audit 13 Sep 2026, D7).
export const TODAY_TEXT_BUTTON_CLASS = `todayTextButton ${buttonVariants({ variant: "ghost" })}`;
