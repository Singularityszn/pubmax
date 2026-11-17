type Insets = { top: number; right: number; bottom: number; left: number };

export function fairPintRouteInsets(container: HTMLElement, phone: boolean, padding: Insets): Insets {
  const form = document.querySelector("#fair-pint-lock-form, .fairPintResultFallback");
  if (!form) return padding;
  const sheet = form.closest<HTMLElement>(".mobileSharedSheet");
  const panel = form.closest<HTMLElement>(".fairPintResult");
  const box = container.getBoundingClientRect();
  if (phone && sheet) {
    const portalBottom = sheet.closest(".mobileSheetPortal")?.getBoundingClientRect().bottom ?? box.bottom;
    return { ...padding, bottom: Math.max(padding.bottom, box.bottom - portalBottom + sheet.offsetHeight + 24) };
  }
  if (!panel) return padding;
  const edge = panel.getBoundingClientRect();
  return phone
    ? { ...padding, bottom: Math.max(padding.bottom, box.bottom - edge.top + 24) }
    : { ...padding, right: Math.max(padding.right, box.right - edge.left + 24) };
}
