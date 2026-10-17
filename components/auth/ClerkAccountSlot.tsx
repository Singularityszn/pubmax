"use client";

// Where Clerk account controls land inside the product tree, without Clerk
// wrapping the product tree.
//
// WHY A SLOT AND NOT <ClerkAccountControls /> IN PLACE:
// ClerkProvider loads after first paint (OptionalClerkProvider). Had it wrapped
// the product children, the element above them would change type when the
// chunk landed, and React would unmount and remount the whole app: the map and
// its WebGL context, the tab bar, every mount fetch and any typed input. So the
// provider mounts BESIDE the product tree, and the controls that need its
// context are portalled from there into these slots. A portal keeps the
// context of where it is rendered, so Clerk's hooks work inside it.
//
// This file imports nothing from @clerk, so the auth surfaces that host a slot
// stay off the Clerk chunk. With no Clerk tree mounted a slot stays empty.

import { useCallback, useId, useSyncExternalStore } from "react";

export type ClerkAccountSlotEntry = { key: string; node: HTMLElement };

const NO_SLOTS: readonly ClerkAccountSlotEntry[] = [];
let slots = NO_SLOTS;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readSlots(): readonly ClerkAccountSlotEntry[] {
  return slots;
}

function readServerSlots(): readonly ClerkAccountSlotEntry[] {
  return NO_SLOTS;
}

/** The mounted slots, for the Clerk tree that portals controls into them. */
export function useClerkAccountSlots(): readonly ClerkAccountSlotEntry[] {
  return useSyncExternalStore(subscribe, readSlots, readServerSlots);
}

/** An empty host for ClerkAccountControls. Its box is display: contents. */
export default function ClerkAccountSlot(): React.JSX.Element {
  const key = useId();
  const register = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const entry = { key, node };
      slots = [...slots, entry];
      emit();
      return () => {
        slots = slots.filter((slot) => slot !== entry);
        emit();
      };
    },
    [key],
  );

  return <div className="clerkAccountSlot" ref={register} />;
}
