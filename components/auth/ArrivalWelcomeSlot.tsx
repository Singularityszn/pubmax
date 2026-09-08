"use client";

import { useSyncExternalStore } from "react";

let host: HTMLDivElement | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => host;
const serverSnapshot = () => null;

function registerHost(node: HTMLDivElement | null) {
  if (!node) return;
  host = node;
  listeners.forEach(listener => listener());
  return () => {
    if (host !== node) return;
    host = null;
    listeners.forEach(listener => listener());
  };
}

export function retainArrivalWelcomeSpace(content: HTMLElement) {
  if (!host || !host.contains(content)) return;
  // The slot owns its height, including after its greeting leaves.
  host.style.minHeight = `${Math.max(parseFloat(host.style.minHeight) || 0, Math.ceil(content.getBoundingClientRect().height))}px`;
}

export function useArrivalWelcomeHost() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export default function ArrivalWelcomeSlot() {
  return <div id="message-recipient-arrival" className="messageRecipientArrival" ref={registerHost} />;
}
