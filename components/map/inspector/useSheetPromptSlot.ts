import { useState } from "react";

/** The prompts on the overview sheet that take turns at one open slot. */
export type SheetPromptOwner = "list" | "night" | "presence" | "price";

/**
 * Which one of the overview sheet's sign-in or save prompts is open. Tapping a
 * second control hands the slot over, so two prompts never stack. The owner is
 * kept by venue id, so selecting another pub starts with none open.
 */
export function useSheetPromptSlot(venueId: string, onLogTonightPrice: () => void) {
  const [promptState, setPromptState] = useState<{
    venueId: string;
    owner: SheetPromptOwner | null;
  }>({ venueId, owner: null });
  const owner = promptState.venueId === venueId ? promptState.owner : null;
  const claim = (next: SheetPromptOwner | null) =>
    setPromptState({ venueId, owner: next });
  // A prompt may show when the slot is free or it already owns the slot.
  const allows = (candidate: SheetPromptOwner) =>
    owner === null || owner === candidate;
  return {
    owner,
    claim,
    allows,
    // The price door takes the slot too, so tapping it closes an open list
    // picker or check-in reply rather than stacking under them.
    logTonightPrice: () => {
      claim("price");
      onLogTonightPrice();
    },
    // The sign-in gate is one of the sheet's prompts: it folds away while the
    // list picker or the check-in reply owns the slot.
    priceGateOpen: (signInRequested: boolean) =>
      !signInRequested || allows("price"),
  };
}
