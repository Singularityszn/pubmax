let clearanceOwner: HTMLElement | null = null;

export function publishMapSheetClearance(owner: HTMLElement, clearance: number, active = true): void {
  if (!active && clearanceOwner !== null && clearanceOwner !== owner) return;
  clearanceOwner = owner;
  document.documentElement.style.setProperty("--map-sheet-clearance-h", `${Math.ceil(clearance)}px`);
}

export function releaseMapSheetClearance(owner: HTMLElement): void {
  if (clearanceOwner !== owner) return;
  clearanceOwner = null;
  document.documentElement.style.removeProperty("--map-sheet-clearance-h");
}
